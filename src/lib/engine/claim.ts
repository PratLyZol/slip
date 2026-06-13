/**
 * Step 7 — Claim: the recipient's side of the engine (PRD §2 step 7, Phase 2).
 *
 * Mirrors runSend's shape (req + onStep listener → terminal result). Where the
 * send pipeline ends with a funded-but-undeployed counterfactual account, the
 * claim pipeline takes that account live:
 *
 *   validate payload
 *     → reconstruct the counterfactual account from the secret
 *     → sponsor gas (paymaster; recipient never holds a gas token)
 *     → deploy + withdraw in ONE batched UserOp into the recipient's walletless
 *       embedded account
 *     → FX into the recipient's local stablecoin (Phase 4 hook — see fx.ts)
 *     → done
 *
 * Walletless + gasless is the whole point: in demo mode the recipient needs
 * ZERO credentials. No wallet UI, no seed phrase, no gas prompt — an embedded
 * account is silently derived for them (recipientAddressFromSecret).
 */

import { isDemoMode } from "../config";
import { simLatency, simTx, sleep } from "../demo/sim";
import {
  addressFromSecret,
  recipientAddressFromSecret,
} from "./counterfactual";
import { decodeClaimFragment, encodeClaimFragment } from "./claimLink";
import { fxAtClaim } from "./fx";
import {
  ClaimStep,
  type ClaimPayload,
  type ClaimResult,
  type ClaimStepListener,
  type ClaimStepState,
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
 * their local stablecoin and a printable receipt. Real 4337 infra is NOT
 * available on Arc (no published EntryPoint; ZeroDev not confirmed on Arc — see
 * docs/research), so the real sponsor/withdraw legs are honest stubs.
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

  // Step 2 — Reconstruct the counterfactual account from the secret.
  emit({ step: ClaimStep.Reconstruct, status: "running" });
  await sleep(simLatency(300, 700));
  const counterfactualAddress = addressFromSecret(secret);
  // Silently derive the recipient's walletless embedded account. No UI, no seed.
  const recipientAddress = recipientAddressFromSecret(secret);
  emit({
    step: ClaimStep.Reconstruct,
    status: "done",
    detail: `Account ${shortAddr(counterfactualAddress)} reconstructed`,
  });

  // Step 3 — Sponsor gas (paymaster). Demo simulates sponsorship.
  emit({ step: ClaimStep.SponsorGas, status: "running" });
  await sleep(simLatency(400, 900));
  if (isDemoMode()) {
    emit({
      step: ClaimStep.SponsorGas,
      status: "done",
      detail: "Gas sponsored — recipient pays nothing",
    });
  } else {
    // NOT YET WIRED — real paymaster sponsorship.
    // Real 4337 infra isn't available on Arc per research (no published
    // EntryPoint; ZeroDev not confirmed on Arc). PRD §8 fallback: a funded
    // relayer covers gas so the user never sees a gas prompt. Until that relayer
    // / paymaster exists, fall back to a labeled simulation.
    console.warn(
      "[slip] real gas sponsorship (paymaster/relayer) not wired yet — simulating.",
    );
    emit({
      step: ClaimStep.SponsorGas,
      status: "done",
      detail: "Gas sponsored (simulated)",
    });
  }

  // Step 4 — Deploy + withdraw in ONE batched UserOp.
  emit({ step: ClaimStep.Withdraw, status: "running" });
  const withdrawTx = await deployAndWithdraw(
    counterfactualAddress,
    recipientAddress,
    amountUsdc,
    secret,
  );
  emit({
    step: ClaimStep.Withdraw,
    status: "done",
    detail: withdrawTx.simulated
      ? "1 batched transaction (simulated)"
      : "1 batched transaction",
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
        : `Converted to ${fx.token}`,
  });

  // Step 6 — Done.
  emit({ step: ClaimStep.Done, status: "done", detail: "Money's in" });

  return {
    counterfactualAddress,
    recipientAddress,
    withdrawTx,
    fx,
    steps,
    claimedAt: new Date().toISOString(),
  };
}

/**
 * Deploy the counterfactual account and withdraw its USDC into the recipient's
 * account — modeled as ONE batched UserOp (PRD §2 step 7: "deploys the account
 * and withdraws in one batched UserOp").
 *
 * Demo: a single deterministic simulated tx hash represents the batched op.
 * Real path: a stub (see below) until 4337 infra is available on Arc.
 */
async function deployAndWithdraw(
  counterfactual: string,
  recipient: string,
  amountUsdc: string,
  secret: ClaimPayload["secret"],
): Promise<TxRef> {
  if (isDemoMode()) {
    await sleep(simLatency(700, 1600));
    return simTx("claim-batch", counterfactual, recipient, amountUsdc, secret);
  }

  // NOT YET WIRED — real batched deploy-and-withdraw UserOp.
  // Real path (later agent): build a 4337 UserOp with the account's initCode
  // (CREATE2 deploy) batched with the USDC withdraw/transfer to `recipient`,
  // sign it with the key derived from the secret, sponsor via paymaster, and
  // submit through the bundler. Needs an EntryPoint + bundler + paymaster on Arc
  // (not published — get from the AA provider). PRD §8 fallback: pre-deploy the
  // account on claim and keep gasless via a funded relayer. Until that infra
  // exists, fall back to a labeled simulation so the demo claim still completes.
  console.warn(
    "[slip] real deploy-and-withdraw UserOp not wired yet — simulating batched op.",
  );
  await sleep(simLatency(700, 1600));
  return simTx("claim-batch", counterfactual, recipient, amountUsdc, secret);
}
