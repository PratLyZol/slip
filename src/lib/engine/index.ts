/**
 * The engine — one pipeline, two surfaces (single send + batch).
 *
 * Phase 1 scope: steps 1,2,3,5 run for real (demo-simulated where no chain
 * creds). Steps 4 (Shield), 6 (SponsorGas), and 7 (Claim) are surfaced as
 * "queued" — later agents wire them. The seven-step shape is preserved so the
 * progress UI and the architecture reveal read correctly from day one.
 */

import { DEMO_SENDER } from "../config";
import { formatUsd } from "../format";
import { aggregate, bridgeToArc } from "./aggregate";
import { buildClaimUrl } from "./claimLink";
import { deriveCounterfactual, generateClaimSecret } from "./counterfactual";
import { resolve } from "./resolve";
import { settle } from "./settle";
import { shield } from "./shield";
import {
  CLAIM_PAYLOAD_VERSION,
  EngineStep,
  type ClaimPayload,
  type EngineResult,
  type PrivacyArtifacts,
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

  // Claim-side steps render as "queued" until the recipient taps the link.
  emit({ step: EngineStep.SponsorGas, status: "queued", detail: "Gas sponsored at claim" });
  emit({ step: EngineStep.Claim, status: "queued", detail: "Recipient claims via link" });

  // Step 1 — Resolve.
  emit({ step: EngineStep.Resolve, status: "running" });
  const resolved = await resolve(req.recipient);
  const resolveSuffix =
    resolved.via === "ens"
      ? " (via ENS)"
      : resolved.note
        ? ` (${resolved.note})`
        : "";
  emit({
    step: EngineStep.Resolve,
    status: "done",
    detail: `${req.recipient} → ${shortAddr(resolved.address)}${resolveSuffix}`,
  });

  // Step 2 — Aggregate. Two parts: (a) verify the sender holds enough USDC,
  // then (b) the REAL aggregation — a Circle CCTP bridge that burns Σ on Base
  // Sepolia and mints it onto Arc (forwarder mode, no recipient Arc gas). PLAN
  // §4: Dynamic has no aggregate product, so CCTP genuinely IS "aggregation"
  // here. We bridge the TOTAL once and await the mint before shielding.
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

  // Bridge Σ onto Arc (mint to the sender's Arc address, where the funds land
  // before the shield). In real mode this is a live CCTP burn+mint; on failure
  // it throws honestly (no silent fallback) and the send aborts at this step.
  const bridge = await bridgeToArc({
    amountUsdc: req.amountUsd.toFixed(2),
    recipientAddress: DEMO_SENDER.address,
  });
  emit({
    step: EngineStep.Aggregate,
    status: "done",
    detail: bridge.simulated
      ? `Bridged ${formatUsd(req.amountUsd)} onto Arc via CCTP (simulated)`
      : `Bridged ${formatUsd(req.amountUsd)} onto Arc via CCTP`,
    // The mint on Arc is the readable artifact of the aggregation step.
    explorerUrl: bridge.mintTx.explorerUrl,
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

  const amountUsdc = req.amountUsd.toFixed(2);

  // Step 4 — Shield: route settlement through an Unlink shielded balance.
  // Deposit USDC into the sender's private balance, then privately transfer it
  // to the claim's unlink address. The private transfer is the leg where the
  // amount and the sender↔recipient edge vanish on-chain.
  emit({ step: EngineStep.Shield, status: "running" });
  const { privacy } = await shield(amountUsdc, secret);
  if (privacy.enabled) {
    emit({
      step: EngineStep.Shield,
      status: "done",
      detail: privacy.legs.some((l) => l.simulated)
        ? "Shielded — amount & graph hidden (simulated)"
        : "Shielded — amount & graph hidden",
      // The PUBLIC deposit edge is the only readable artifact of this step.
      explorerUrl: privacy.legs.find((l) => l.kind === "shield")?.explorerUrl,
    });
  } else {
    emit({
      step: EngineStep.Shield,
      status: "done",
      detail: "Skipped (flag) — settling directly",
    });
  }

  // Step 5 — Settle. When shielded, the value already moved privately into the
  // claim's shielded balance; the "settle" artifact for the UI is the public
  // deposit edge (no separate public USDC transfer to the counterfactual). When
  // the privacy path degraded, fall back to a direct USDC settle.
  emit({ step: EngineStep.Settle, status: "running" });
  let settleTx;
  if (privacy.enabled) {
    const depositLeg = privacy.legs.find((l) => l.kind === "shield");
    settleTx = {
      hash: depositLeg?.txHash ?? ("0x" as `0x${string}`),
      explorerUrl: depositLeg?.explorerUrl ?? "",
      simulated: depositLeg?.simulated ?? true,
    };
    emit({
      step: EngineStep.Settle,
      status: "done",
      detail: "Parked in shielded balance until claim",
      explorerUrl: settleTx.explorerUrl || undefined,
    });
  } else {
    const settled = await settle(cf.address, req.amountUsd, secret);
    settleTx = settled.tx;
    emit({
      step: EngineStep.Settle,
      status: "done",
      detail: settled.tx.simulated ? "Settled (simulated)" : "Settled",
      explorerUrl: settled.tx.explorerUrl,
    });
  }

  const claimPayload: ClaimPayload = {
    v: CLAIM_PAYLOAD_VERSION,
    secret,
    amountUsdc,
    senderName: req.senderName,
    region: req.region,
    createdAt: new Date().toISOString(),
  };

  const privacyArtifacts: PrivacyArtifacts = privacy;

  return {
    secret,
    counterfactualAddress: cf.address,
    settleTx,
    privacy: privacyArtifacts,
    claimPayload,
    steps,
  };
}

export { buildClaimUrl };
