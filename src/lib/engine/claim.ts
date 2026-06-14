/**
 * Step 7 — Claim: the recipient's side of the engine (PRD §2 step 7, Phase 2).
 *
 * Mirrors runSend's shape (req + onStep listener → terminal result). Where the
 * send pipeline ends with a funded-but-undeployed counterfactual account, the
 * claim pipeline takes that account live:
 *
 *   validate payload
 *     → reconstruct the claim account from the secret
 *     → relayer covers gas (Unlink's relayer submits the withdraw; recipient
 *       never holds a gas token — there is NO paymaster/AA)
 *     → withdraw (unshield) the money to the recipient's pregen payout address
 *     → FX into the recipient's local stablecoin (see fx.ts)
 *     → done
 *
 * Walletless + gasless is the whole point: the recipient never holds a gas
 * token (Unlink's relayer submits the withdraw) and the payout address rides in
 * the v2 claim payload (`recipientAddress` — a Dynamic pregen wallet the
 * recipient auto-associates by OTP login). Every leg is REAL: a leg that cannot
 * execute throws an honest error instead of simulating a fake success.
 */

import { isRealPayoutSafe } from "../config";
import { getShieldOps } from "../adapters/unlink";
import { addressFromSecret } from "./counterfactual";
import { decodeClaimFragment, encodeClaimFragment } from "./claimLink";
import { fxAtClaim } from "./fx";
import {
  ClaimStep,
  type ClaimPayload,
  type ClaimResult,
  type ClaimStepListener,
  type ClaimStepState,
  type PrivacyLeg,
  type TxRef,
} from "./types";

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Run a claim through the engine.
 *
 * @param payload  the decoded ClaimPayload (from the URL fragment)
 * @param onStep   optional listener fired as each claim step transitions
 *
 * REAL-ONLY: every leg executes for real. There is NO paymaster/AA — Unlink's
 * RELAYER submits the withdraw and covers gas, so the recipient pays nothing. On
 * any real-path failure the withdraw THROWS an honest error (surfaced as a failed
 * step) — the claim never reports success unless the withdraw really executed.
 */
export async function runClaim(
  payload: ClaimPayload,
  onStep?: ClaimStepListener,
  /**
   * Live payout override: the address of the Dynamic wallet the recipient JUST
   * logged into via OTP. When present we withdraw to it instead of the payload's
   * pregen address — so the funds always land in the wallet they actually
   * control, regardless of pregen-address stability. Falls back to the payload's
   * pregen address (e.g. the headless smoke run, which passes no live wallet).
   */
  payoutAddress?: string,
): Promise<ClaimResult> {
  const steps: ClaimStepState[] = [];
  const emit = (state: ClaimStepState) => {
    const idx = steps.findIndex((s) => s.step === state.step);
    if (idx >= 0) steps[idx] = state;
    else steps.push(state);
    onStep?.(state);
  };

  const { secret, amountUsdc, region } = payload;
  // Payout target: the wallet the recipient just logged into (payoutAddress),
  // else the pregen address from the v2 payload. Using the live logged-in wallet
  // guarantees the money lands in a wallet they control.
  const recipientAddress = (payoutAddress ??
    payload.recipientAddress) as `0x${string}`;

  // Step 1 — Validate the decoded payload. runClaim is also called headlessly
  // (smoke script) with a hand-built payload, so re-run it through the strict
  // codec to catch a malformed payload before any (simulated) chain work.
  emit({ step: ClaimStep.Validate, status: "running" });
  const revalidated = decodeClaimFragment(encodeClaimFragment(payload));
  if (!revalidated.ok) {
    emit({ step: ClaimStep.Validate, status: "failed", detail: revalidated.error });
    throw new Error(revalidated.error);
  }
  emit({
    step: ClaimStep.Validate,
    status: "done",
    detail: "Slip is valid",
  });

  // Step 2 — Reconstruct the claim account from the secret. This is the shielded
  // account the private transfer targeted; the recipient re-derives it here to
  // withdraw. The payout address (where the money lands) came in the payload.
  emit({ step: ClaimStep.Reconstruct, status: "running" });
  const counterfactualAddress = addressFromSecret(secret);
  emit({
    step: ClaimStep.Reconstruct,
    status: "done",
    detail: `Account ${shortAddr(counterfactualAddress)} reconstructed`,
  });

  // Step 3 — Relayer covers gas. There is NO paymaster/AA — Unlink's relayer
  // submits the withdraw and pays gas, so the recipient never holds a gas token.
  emit({ step: ClaimStep.SponsorGas, status: "running" });
  emit({
    step: ClaimStep.SponsorGas,
    status: "done",
    detail: "Relayer covers gas — recipient pays nothing (Unlink relayer)",
  });

  // Step 4 — Unshield (withdraw) from the claim's shielded balance into the
  // recipient's pregen payout address. PUBLIC "out" edge (destination + amount
  // visible, the shielded source is NOT). Relayer-submitted — recipient pays no
  // gas (no batched UserOp / 4337; Unlink's relayer handles submission).
  emit({ step: ClaimStep.Withdraw, status: "running" });
  let withdrawTx: TxRef;
  let unshield: PrivacyLeg;
  try {
    ({ withdrawTx, unshield } = await unshieldAndWithdraw(
      recipientAddress,
      amountUsdc,
      secret,
    ));
  } catch (err) {
    const reason =
      err instanceof Error ? err.message : "Withdraw from shielded balance failed";
    emit({ step: ClaimStep.Withdraw, status: "failed", detail: reason });
    throw err;
  }
  emit({
    step: ClaimStep.Withdraw,
    status: "done",
    detail: "Withdrawn from shielded balance — relayer-submitted",
    explorerUrl: withdrawTx.explorerUrl,
  });

  // Step 5 — FX into the recipient's local stablecoin (Phase 4 hook).
  emit({ step: ClaimStep.Convert, status: "running" });
  const fx = await fxAtClaim(amountUsdc, region, secret);
  emit({
    step: ClaimStep.Convert,
    status: "done",
    detail:
      fx.token === "USDC"
        ? "Delivered as USDC (no conversion)"
        : `Converted to ${fx.amount} ${fx.token}` +
          (fx.rateUsed && fx.rateUsed !== 1 ? ` @ ${fx.rateUsed}` : ""),
  });

  // Step 6 — Done.
  emit({ step: ClaimStep.Done, status: "done", detail: "Money's in" });

  return {
    counterfactualAddress,
    recipientAddress,
    withdrawTx,
    unshield,
    fx,
    steps,
    claimedAt: new Date().toISOString(),
  };
}

/**
 * Pull the money out of the claim's Unlink shielded balance into the
 * recipient's public payout address (PRD §2 step 7 + Phase 3). This is the
 * public "out" edge of the privacy path: the Unlink `withdraw` reveals
 * destination + amount but NOT the shielded source. Relayer-submitted — the
 * recipient pays no gas (no paymaster/AA).
 *
 * REAL-ONLY (Task #2): there is NO simulation fallback. The withdraw either
 * executes on-chain (returns the real {@link TxRef} + {@link PrivacyLeg}) or
 * THROWS an honest error that the caller surfaces as a failed Withdraw step. The
 * keyless-recipient safety refusal is a real thrown error too — never a sim.
 */
async function unshieldAndWithdraw(
  recipient: string,
  amountUsdc: string,
  secret: ClaimPayload["secret"],
): Promise<{ withdrawTx: TxRef; unshield: PrivacyLeg }> {
  const ops = getShieldOps();

  // CRITICAL SAFETY GUARD (Task #2), enforced a second time at the engine layer
  // (the adapter's real `unshield` also guards — defense in depth). If the live
  // Unlink path is selected but the recipient payout address is NOT a
  // verified-real Dynamic pregen wallet (DYNAMIC_API_TOKEN absent → the address
  // is the KEYLESS `demoAddressFor(identifier)`), refuse with a REAL thrown
  // error: real shielded USDC must never land in an address nobody controls. The
  // claim fails honestly rather than reporting a fake success.
  if (ops.real && !isRealPayoutSafe()) {
    throw new Error(
      "Real payout blocked — recipient address is not a verified-real Dynamic " +
        "pregen wallet (keyless demo address); refusing to send real funds.",
    );
  }

  const leg = await ops.unshield(secret, recipient, amountUsdc);
  if (!leg.txHash) {
    // A public withdraw edge MUST carry a real on-chain tx hash. No hash means we
    // cannot prove the money moved — fail honestly rather than invent one.
    throw new Error(
      "Unlink withdraw reported no transaction hash — cannot confirm the funds moved.",
    );
  }
  const withdrawTx: TxRef = {
    hash: leg.txHash,
    explorerUrl: leg.explorerUrl ?? "",
    simulated: leg.simulated,
  };
  return { withdrawTx, unshield: leg };
}
