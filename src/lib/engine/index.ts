/**
 * The engine — one pipeline, two surfaces (single send + batch).
 *
 * Phase 1 scope: steps 1,2,3,5 run for real (demo-simulated where no chain
 * creds). Steps 4 (Shield), 6 (SponsorGas), and 7 (Claim) are surfaced as
 * "queued" — later agents wire them. The seven-step shape is preserved so the
 * progress UI and the architecture reveal read correctly from day one.
 */

import { formatUsd } from "../format";
import { aggregate } from "./aggregate";
import { buildClaimUrl } from "./claimLink";
import { deriveCounterfactual, generateClaimSecret } from "./counterfactual";
import { resolve } from "./resolve";
import { settle } from "./settle";
import {
  CLAIM_PAYLOAD_VERSION,
  EngineStep,
  type ClaimPayload,
  type EngineResult,
  type SendRequest,
  type StepListener,
  type StepState,
} from "./types";

/** Short address for human-readable step details (0x12…ab). */
function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Run a single send through the engine.
 *
 * @param req       the send request (recipient, amount, optional sender/region)
 * @param onStep    optional listener fired as each step transitions (live UI)
 */
export async function runSend(
  req: SendRequest,
  onStep?: StepListener,
): Promise<EngineResult> {
  const steps: StepState[] = [];
  const emit = (state: StepState) => {
    const idx = steps.findIndex((s) => s.step === state.step);
    if (idx >= 0) steps[idx] = state;
    else steps.push(state);
    onStep?.(state);
  };

  // Steps wired by later agents start as "queued" so they render honestly.
  emit({ step: EngineStep.Shield, status: "queued", detail: "Privacy leg — wires next" });
  emit({ step: EngineStep.SponsorGas, status: "queued", detail: "Gas sponsored at claim" });
  emit({ step: EngineStep.Claim, status: "queued", detail: "Recipient claims via link" });

  // Step 1 — Resolve.
  emit({ step: EngineStep.Resolve, status: "running" });
  const resolved = await resolve(req.recipient);
  emit({
    step: EngineStep.Resolve,
    status: "done",
    detail: `${req.recipient} → ${shortAddr(resolved.address)}`,
  });

  // Step 2 — Aggregate (honest pass-through; verifies USDC balance).
  emit({ step: EngineStep.Aggregate, status: "running" });
  const agg = await aggregate(req.amountUsd);
  if (!agg.sufficient) {
    emit({
      step: EngineStep.Aggregate,
      status: "failed",
      detail: `Insufficient USDC (have ${formatUsd(agg.availableUsdc)})`,
    });
    throw new Error(
      `Insufficient USDC balance: have ${formatUsd(agg.availableUsdc)}, need ${formatUsd(req.amountUsd)}.`,
    );
  }
  emit({
    step: EngineStep.Aggregate,
    status: "done",
    detail: `${formatUsd(agg.availableUsdc)} USDC available`,
  });

  // Step 3 — Counterfactual account from a fresh claim secret.
  emit({ step: EngineStep.Counterfactual, status: "running" });
  const secret = generateClaimSecret();
  const cf = await deriveCounterfactual(secret);
  emit({
    step: EngineStep.Counterfactual,
    status: "done",
    detail: `Account ${shortAddr(cf.address)} (undeployed)`,
  });

  // Step 5 — Settle USDC to the counterfactual address.
  emit({ step: EngineStep.Settle, status: "running" });
  const settled = await settle(cf.address, req.amountUsd, secret);
  emit({
    step: EngineStep.Settle,
    status: "done",
    detail: settled.tx.simulated ? "Settled (simulated)" : "Settled",
    explorerUrl: settled.tx.explorerUrl,
  });

  const claimPayload: ClaimPayload = {
    v: CLAIM_PAYLOAD_VERSION,
    secret,
    amountUsdc: req.amountUsd.toFixed(2),
    senderName: req.senderName,
    region: req.region,
    createdAt: new Date().toISOString(),
  };

  return {
    secret,
    counterfactualAddress: cf.address,
    settleTx: settled.tx,
    claimPayload,
    steps,
  };
}

export { buildClaimUrl };
