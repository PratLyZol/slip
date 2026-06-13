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
 *     → FX into the recipient's local stablecoin (Phase 4 hook — see fx.ts)
 *     → done
 *
 * Walletless + gasless is the whole point: in demo mode the recipient needs
 * ZERO credentials. No wallet UI, no seed phrase, no gas prompt. The payout
 * address rides in the v2 claim payload (`recipientAddress` — a Dynamic pregen
 * wallet the recipient auto-associates by OTP login).
 */

import { isDemoMode } from "../config";
import { simLatency, simTx, sleep } from "../demo/sim";
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
 * Demo mode (the contract): every leg is simulated with realistic latency and a
 * deterministic Arc-style tx hash. The recipient ends up with the amount in
 * their local stablecoin and a printable receipt. There is NO paymaster/AA on
 * the real path — Unlink's RELAYER submits the withdraw and covers gas, so the
 * recipient pays nothing. On any real-path failure the leg degrades to a labeled
 * simulation so the claim still completes (PRD §8).
 */
export async function runClaim(
  payload: ClaimPayload,
  onStep?: ClaimStepListener,
): Promise<ClaimResult> {
  const steps: ClaimStepState[] = [];
  const emit = (state: ClaimStepState) => {
    const idx = steps.findIndex((s) => s.step === state.step);
    if (idx >= 0) steps[idx] = state;
    else steps.push(state);
    onStep?.(state);
  };

  const { secret, amountUsdc, region } = payload;
  // The payout target rides in the v2 payload: the recipient's Dynamic pregen
  // address (resolved at send time). No more secret-derived recipient address.
  const recipientAddress = payload.recipientAddress;

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
  await sleep(simLatency(300, 700));
  const counterfactualAddress = addressFromSecret(secret);
  emit({
    step: ClaimStep.Reconstruct,
    status: "done",
    detail: `Account ${shortAddr(counterfactualAddress)} reconstructed`,
  });

  // Step 3 — Relayer covers gas. There is NO paymaster/AA — Unlink's relayer
  // submits the withdraw and pays gas, so the recipient never holds a gas token.
  emit({ step: ClaimStep.SponsorGas, status: "running" });
  await sleep(simLatency(400, 900));
  emit({
    step: ClaimStep.SponsorGas,
    status: "done",
    detail: isDemoMode()
      ? "Relayer covers gas — recipient pays nothing"
      : "Relayer covers gas — recipient pays nothing (Unlink relayer)",
  });

  // Step 4 — Unshield (withdraw) from the claim's shielded balance into the
  // recipient's pregen payout address. PUBLIC "out" edge (destination + amount
  // visible, the shielded source is NOT). Relayer-submitted — recipient pays no
  // gas (no batched UserOp / 4337; Unlink's relayer handles submission).
  emit({ step: ClaimStep.Withdraw, status: "running" });
  const { withdrawTx, unshield } = await unshieldAndWithdraw(
    counterfactualAddress,
    recipientAddress,
    amountUsdc,
    secret,
  );
  emit({
    step: ClaimStep.Withdraw,
    status: "done",
    detail: withdrawTx.simulated
      ? "Withdrawn from shielded balance — relayer-submitted (simulated)"
      : "Withdrawn from shielded balance — relayer-submitted",
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
 * Returns both a {@link TxRef} (the withdraw tx, for the existing receipt/UI)
 * and the {@link PrivacyLeg} for the proof view. On any real-path failure,
 * degrades to a labeled simulation so the claim still completes (PRD §8).
 */
async function unshieldAndWithdraw(
  counterfactual: string,
  recipient: string,
  amountUsdc: string,
  secret: ClaimPayload["secret"],
): Promise<{ withdrawTx: TxRef; unshield: PrivacyLeg }> {
  const ops = getShieldOps();
  try {
    const leg = await ops.unshield(secret, recipient, amountUsdc);
    const hash =
      leg.txHash ?? simTx("claim-batch", counterfactual, recipient, amountUsdc, secret).hash;
    const withdrawTx: TxRef = {
      hash,
      explorerUrl: leg.explorerUrl ?? simTx("claim-batch", counterfactual, recipient, amountUsdc, secret).explorerUrl,
      simulated: leg.simulated,
    };
    return { withdrawTx, unshield: leg };
  } catch (err) {
    // PRD §8: never block the claim on the privacy leg — fall back to a labeled
    // simulated batched op and a synthetic public unshield leg.
    const reason =
      err instanceof Error ? err.message : "Unlink withdraw unavailable";
    if (!isDemoMode()) {
      console.warn(
        `[slip] real unshield failed — simulating batched withdraw. (${reason})`,
      );
    }
    await sleep(simLatency(700, 1600));
    const tx = simTx("claim-batch", counterfactual, recipient, amountUsdc, secret);
    return {
      withdrawTx: tx,
      unshield: {
        kind: "unshield",
        label: "Withdraw from shielded balance",
        public: true,
        txHash: tx.hash,
        explorerUrl: tx.explorerUrl,
        simulated: true,
      },
    };
  }
}
