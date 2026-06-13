/**
 * The engine — one pipeline, two surfaces (single send + batch). Batch is the
 * hero (PLAN §0): the privacy property is self-contained at N>1. The engine is
 * `recipients[]`-first — N=1 is the trivial case of the same code path.
 *
 * The batch privacy model (PLAN §2):
 *  - ONE `batchSecret` derives the SENDER's Unlink account.
 *  - Bridge Σ(amounts) onto Arc ONCE (CCTP), then shield Σ ONCE into the sender's
 *    shielded balance (gasless faucet).
 *  - For EACH recipient: a fresh per-recipient `claimSecret` (carried in that
 *    recipient's link) derives that recipient's claim account; a PRIVATE transfer
 *    moves their amount from the sender's shielded balance to their claim account
 *    (the leg where the amount + the sender↔recipient edge vanish on-chain).
 *  - N claim links, one per recipient: `{ secret: claimSecret, recipientAddress,
 *    amountUsdc, senderLabel, region, ... }`. At claim each recipient re-derives
 *    its account from its secret and withdraws to its pregen address.
 *
 * The whole batch shares ONE public deposit of Σ and produces N unlinkable
 * payouts — that is the unlinkability property (PLAN §1).
 *
 * The privacy path degrades safely (PRD §8): if the shared shield throws, the
 * send falls back to per-recipient direct settle so it NEVER blocks.
 */

import { formatUsd } from "../format";
import { getShieldOps } from "../adapters/unlink";
import { aggregate, bridgeToArc } from "./aggregate";
import { buildClaimUrl } from "./claimLink";
import { deriveCounterfactual, generateClaimSecret } from "./counterfactual";
import { resolve } from "./resolve";
import { settle } from "./settle";
import {
  CLAIM_PAYLOAD_VERSION,
  EngineStep,
  type ClaimPayload,
  type EngineResult,
  type PrivacyArtifacts,
  type PrivacyLeg,
  type Recipient,
  type SendRequest,
  type StepListener,
  type StepState,
} from "./types";

/** Short address for human-readable step details (0x12…ab). */
function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Inter-transfer pacing so N sequential heavy proofs don't hammer the relayer
 * (the SDK auto-retries 3× / honors Retry-After; this just spaces calls out). */
function fanoutDelayMs(): number {
  return 150 + Math.floor(Math.random() * 250); // ~150–400ms
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A single recipient's resolved + per-recipient state inside a batch run. */
interface RecipientPlan {
  recipient: Recipient;
  /** Resolved pregen payout address (where the claim ultimately lands). */
  recipientAddress: ClaimPayload["recipientAddress"];
  /** This recipient's own claim secret (carried in its link). */
  claimSecret: ClaimPayload["secret"];
  /** Amount as a human-units string ("50.00"). */
  amountUsdc: string;
}

/**
 * Run a BATCH send through the engine — the true privacy fan-out.
 *
 * Bridges + shields Σ ONCE under a single `batchSecret`, then privately transfers
 * each recipient's amount to its own claim account, emitting ONE
 * {@link EngineResult} per recipient. N=1 is the trivial case (identical to a
 * single send).
 *
 * @param req     the send request (recipients[], optional sender label)
 * @param onStep  optional listener fired as steps transition (live progress UI)
 */
export async function runBatchSend(
  req: SendRequest,
  onStep?: StepListener,
): Promise<EngineResult[]> {
  if (req.recipients.length === 0) {
    throw new Error("Send request has no recipients.");
  }

  const steps: StepState[] = [];
  const emit = (state: StepState) => {
    const idx = steps.findIndex((s) => s.step === state.step);
    if (idx >= 0) steps[idx] = state;
    else steps.push(state);
    onStep?.(state);
  };

  const ops = getShieldOps();

  // ONE batch secret derives the SENDER's Unlink account; Σ shields into it once.
  const batchSecret = generateClaimSecret();
  const total = req.recipients.reduce((sum, r) => sum + r.amountUsd, 0);
  const totalUsdc = total.toFixed(2);
  const single = req.recipients.length === 1;

  // Claim-side steps render as "queued" until each recipient taps their link.
  emit({ step: EngineStep.SponsorGas, status: "queued", detail: "Gas covered by relayer at claim" });
  emit({ step: EngineStep.Claim, status: "queued", detail: "Recipient claims via link" });

  // Step 1 — Resolve EVERY recipient → its pregen payout address.
  emit({ step: EngineStep.Resolve, status: "running" });
  const plans: RecipientPlan[] = [];
  for (const recipient of req.recipients) {
    const resolved = await resolve(recipient.identifier);
    plans.push({
      recipient,
      recipientAddress: resolved.address,
      claimSecret: generateClaimSecret(),
      amountUsdc: recipient.amountUsd.toFixed(2),
    });
    if (single) {
      const suffix =
        resolved.via === "ens"
          ? " (via ENS)"
          : resolved.note
            ? ` (${resolved.note})`
            : "";
      emit({
        step: EngineStep.Resolve,
        status: "done",
        detail: `${recipient.identifier} → ${shortAddr(resolved.address)}${suffix}`,
      });
    }
  }
  if (!single) {
    emit({
      step: EngineStep.Resolve,
      status: "done",
      detail: `Resolved ${plans.length} recipients`,
    });
  }

  // Step 2 — Aggregate. (a) verify the sender holds enough USDC for Σ, then (b)
  // the REAL aggregation — a Circle CCTP bridge of Σ ONCE (burn on Base Sepolia,
  // mint on Arc, forwarder mode). PLAN §4: CCTP genuinely IS "aggregation" here.
  emit({ step: EngineStep.Aggregate, status: "running" });
  // Check the sender's USDC across all CCTP chains (not just Arc) — the funds are
  // bridged from whichever testnet holds them, so an Arc-only check is wrong.
  const agg = await aggregate(total, req.senderAddress);
  if (!agg.sufficient) {
    emit({
      step: EngineStep.Aggregate,
      status: "failed",
      detail: `Insufficient USDC (have ${formatUsd(agg.availableUsdc)})`,
    });
    throw new Error(
      `Insufficient USDC balance: have ${formatUsd(agg.availableUsdc)}, need ${formatUsd(total)}.`,
    );
  }

  // Bridge Σ onto Arc ONCE (mint to the connected sender's Arc address, where
  // the funds land before the shield). A live CCTP burn+mint; on failure it
  // throws honestly (no silent fallback) and the send aborts at this step.
  if (!req.senderAddress) {
    emit({
      step: EngineStep.Aggregate,
      status: "failed",
      detail: "Connect a wallet to receive the aggregated USDC on Arc",
    });
    throw new Error("No sender wallet connected — connect a wallet before sending.");
  }
  const bridge = await bridgeToArc({
    amountUsdc: totalUsdc,
    recipientAddress: req.senderAddress,
  });
  emit({
    step: EngineStep.Aggregate,
    status: "done",
    detail: bridge.simulated
      ? `Bridged ${formatUsd(total)} onto Arc via CCTP (simulated)`
      : `Bridged ${formatUsd(total)} onto Arc via CCTP`,
    // The mint on Arc is the readable artifact of the aggregation step.
    explorerUrl: bridge.mintTx.explorerUrl,
  });

  // Step 3 — Counterfactual. Surface the sender's shielded account as the shared
  // staging account (the batch's privacy hub). For N=1 this matches the old
  // single-send UX (one account derived for the send).
  emit({ step: EngineStep.Counterfactual, status: "running" });
  const cf = await deriveCounterfactual(batchSecret);
  emit({
    step: EngineStep.Counterfactual,
    status: "done",
    detail: single
      ? `Account ${shortAddr(cf.address)} (undeployed)`
      : `Shared shielded account ${shortAddr(cf.address)}`,
  });

  // Step 4 — Shield Σ ONCE into the sender's shielded balance (gasless faucet).
  // This is the single PUBLIC deposit edge the whole batch shares. Degrades
  // safely (PRD §8): on failure we fall back to per-recipient direct settle.
  emit({ step: EngineStep.Shield, status: "running" });
  let senderUnlinkAddress: string | undefined;
  let shieldLeg: PrivacyLeg | undefined;
  let privacyEnabled = false;
  let skippedReason: string | undefined;
  try {
    senderUnlinkAddress = await ops.senderAddress(batchSecret);
    shieldLeg = await ops.shieldSender(batchSecret, totalUsdc);
    privacyEnabled = true;
    emit({
      step: EngineStep.Shield,
      status: "done",
      detail: shieldLeg.simulated
        ? "Shielded Σ — amounts & graph hidden (simulated)"
        : "Shielded Σ — amounts & graph hidden",
      // The PUBLIC deposit edge is the only readable artifact of this step.
      explorerUrl: shieldLeg.explorerUrl,
    });
  } catch (err) {
    // PRD §8: never block the send on the privacy leg.
    skippedReason =
      err instanceof Error ? err.message : "Unlink shielded path unavailable";
    console.warn(
      `[slip] shield path failed — falling back to direct settle. (${skippedReason})`,
    );
    emit({
      step: EngineStep.Shield,
      status: "done",
      detail: "Skipped — settling directly",
    });
  }

  // Step 5 — Settle: per recipient, a PRIVATE transfer from the sender's shielded
  // balance to that recipient's claim account (the private middle). When the
  // shared shield degraded, fall back to a per-recipient direct USDC settle so
  // the send still completes. Either way, build one EngineResult per recipient.
  emit({ step: EngineStep.Settle, status: "running" });
  const results: EngineResult[] = [];

  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    // The claim account derived from this recipient's own secret. Always the
    // result's counterfactualAddress (what the recipient re-derives at claim
    // time); also the direct-settle target when the privacy path degraded.
    const claimCf = await deriveCounterfactual(plan.claimSecret);

    let settleTx: EngineResult["settleTx"];
    const privacy: PrivacyArtifacts = privacyEnabled
      ? {
          enabled: true,
          senderUnlinkAddress,
          legs: shieldLeg ? [shieldLeg] : [],
        }
      : { enabled: false, skippedReason, legs: [] };

    if (privacyEnabled) {
      // PRIVATE transfer: sender shielded balance → this claim's account.
      // Sequential with a small inter-call delay (heavy proofs; SDK retries 3×).
      const claimUnlinkAddress = await ops.claimAddress(plan.claimSecret);
      const transferLeg = await ops.privateTransfer(
        batchSecret,
        plan.claimSecret,
        plan.amountUsdc,
      );
      privacy.claimUnlinkAddress = claimUnlinkAddress;
      privacy.legs = shieldLeg ? [shieldLeg, transferLeg] : [transferLeg];
      // The "settle" artifact for the UI is the shared public deposit edge —
      // there is no separate public USDC transfer to the claim account.
      settleTx = {
        hash: shieldLeg?.txHash ?? ("0x" as `0x${string}`),
        explorerUrl: shieldLeg?.explorerUrl ?? "",
        simulated: shieldLeg?.simulated ?? true,
      };
      if (i + 1 < plans.length) await sleep(fanoutDelayMs());
    } else {
      // Degraded path: direct USDC settle to this claim's counterfactual account.
      const settled = await settle(claimCf.address, plan.recipient.amountUsd, plan.claimSecret);
      settleTx = settled.tx;
    }

    const claimPayload: ClaimPayload = {
      v: CLAIM_PAYLOAD_VERSION,
      secret: plan.claimSecret,
      amountUsdc: plan.amountUsdc,
      // Real pregen payout address resolved in step 1 (where the claim lands).
      recipientAddress: plan.recipientAddress,
      senderLabel: req.senderName,
      region: plan.recipient.region,
      createdAt: new Date().toISOString(),
    };

    results.push({
      secret: plan.claimSecret,
      counterfactualAddress: claimCf.address,
      settleTx,
      privacy,
      claimPayload,
      // Re-stamped with the FINAL shared step sequence after the loop completes.
      steps: [],
    });
  }

  // Settle step done — coarse for a batch (the batch screen renders its own
  // per-row table); precise for N=1 so the single-send progress UI still reads.
  if (privacyEnabled) {
    emit({
      step: EngineStep.Settle,
      status: "done",
      detail: single
        ? "Parked in shielded balance until claim"
        : `${plans.length} private transfers — parked until claim`,
      explorerUrl: shieldLeg?.explorerUrl || undefined,
    });
  } else {
    emit({
      step: EngineStep.Settle,
      status: "done",
      detail: single ? "Settled directly" : `Settled ${plans.length} directly`,
    });
  }

  // Re-stamp each result's steps with the FINAL shared step states (so every
  // recipient carries the completed Resolve→Settle sequence for receipts/UI).
  for (const r of results) r.steps = steps.map((s) => ({ ...s }));

  return results;
}

/**
 * Run a SINGLE send through the engine — the trivial N=1 case of
 * {@link runBatchSend}. KEPT as the single-EngineResult contract that
 * SendScreen / PrivateScreen / batch.ts (`runBatch` loops it per row) depend on.
 *
 * @param req     the send request (recipients[], optional sender label)
 * @param onStep  optional listener fired as each step transitions (live UI)
 */
export async function runSend(
  req: SendRequest,
  onStep?: StepListener,
): Promise<EngineResult> {
  return (await runBatchSend(req, onStep))[0];
}

export { buildClaimUrl };
