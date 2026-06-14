/**
 * The DISTRIBUTE leg of the engine — Resolve + Shield + Settle + claim links,
 * operating on funds ALREADY on Arc.
 *
 * Extracted from the old monolithic `runBatchSend` (everything AFTER the
 * Aggregate step) so the UI can run bridge and distribute independently.
 *
 * CRITICAL (the whole point of the split): distribute does NOT bridge and does
 * NOT depend on {@link runBridge} having run in the same JS call. It reads the
 * connected wallet's Arc USDC fresh (via the shield's wallet-funded deposit) and
 * shields it. The Arc network switch — getWalletClient("5042002") — happens
 * INSIDE the Shield step here.
 *
 * The batch privacy model (PLAN §2):
 *  - ONE `batchSecret` derives the SENDER's Unlink account.
 *  - Shield Σ ONCE into the sender's shielded balance (a wallet-funded deposit
 *    of the bridged USDC already on Arc).
 *  - For EACH recipient: a fresh per-recipient `claimSecret` (carried in that
 *    recipient's link) derives that recipient's claim account; a PRIVATE transfer
 *    moves their amount from the sender's shielded balance to their claim account.
 *  - N claim links, one per recipient.
 *
 * The privacy path degrades safely ONLY into a REAL fallback: if the shared
 * shield throws, the send falls back to a per-recipient direct on-chain USDC
 * transfer (settle.ts). That fallback STILL moves real funds — if it also fails,
 * the whole distribute throws (a failed step), because a claim link must NEVER be
 * emitted when no money actually moved.
 */

import type { WalletClient } from "viem";
import { getShieldOps } from "../adapters/unlink";
import { deriveCounterfactual, generateClaimSecret } from "./counterfactual";
import { resolve } from "./resolve";
import { settle } from "./settle";
import {
  CLAIM_PAYLOAD_VERSION,
  EngineStep,
  type ClaimPayload,
  type DistributeRequest,
  type EngineResult,
  type PrivacyArtifacts,
  type PrivacyLeg,
  type Recipient,
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
 * Run the distribute leg — the privacy fan-out over funds already on Arc.
 *
 * Shields Σ ONCE under a single `batchSecret`, then privately transfers each
 * recipient's amount to its own claim account, emitting ONE {@link EngineResult}
 * per recipient. N=1 is the trivial case (identical to a single send).
 *
 * @param req     recipients[] + optional sender label + wallet-client accessor
 * @param onStep  optional listener fired as steps transition (live progress UI)
 */
export async function runDistribute(
  req: DistributeRequest,
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

  // Step 2 — Counterfactual. Surface the sender's shielded account as the shared
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

  // Step 3 — Shield Σ ONCE into the sender's shielded balance (a wallet-funded
  // deposit of the bridged USDC already on Arc, signed on Arc by the connected
  // wallet). This is the single PUBLIC deposit edge the whole batch shares.
  // The Arc network switch — getWalletClient("5042002") — happens HERE, so
  // distribute is independent of whether the bridge ran in the same JS call. The
  // SAME Arc wallet client funds the shielded deposit AND (on the degraded path)
  // signs the direct USDC transfer below — so the fallback also moves real funds.
  emit({ step: EngineStep.Shield, status: "running" });
  let senderUnlinkAddress: string | undefined;
  let shieldLeg: PrivacyLeg | undefined;
  let privacyEnabled = false;
  let skippedReason: string | undefined;
  // Resolved ONCE up front: required by both the shield (deposit) and the
  // degraded direct settle. If no wallet is connected we cannot move funds at
  // all, so this is a hard failure of the whole distribute — not a degrade.
  if (!req.getWalletClient) {
    emit({
      step: EngineStep.Shield,
      status: "failed",
      detail: "No wallet connected — cannot move funds.",
    });
    throw new Error(
      "No wallet connected — connect a wallet to fund the send.",
    );
  }
  const arcWalletClient: WalletClient | undefined =
    await req.getWalletClient("5042002");
  if (!arcWalletClient) {
    emit({
      step: EngineStep.Shield,
      status: "failed",
      detail: "Could not obtain an Arc wallet client.",
    });
    throw new Error(
      "Could not obtain an Arc wallet client — connect a wallet and allow the Arc network.",
    );
  }
  try {
    senderUnlinkAddress = await ops.senderAddress(batchSecret);
    // The shield is a WALLET-FUNDED deposit of the bridged USDC — it needs the
    // connected wallet's viem client on Arc (5042002) to sign the ERC-20
    // approve + deposit.
    shieldLeg = await ops.shieldSender(batchSecret, totalUsdc, arcWalletClient);
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
    // Degrade the PRIVACY leg only — NOT the money movement. We fall back to a
    // REAL direct USDC transfer below (settle.ts), which still moves funds; if
    // that also fails the whole distribute throws (no fake success). privacy is
    // marked disabled with an honest skippedReason for the proof view.
    skippedReason =
      err instanceof Error ? err.message : "Unlink shielded path unavailable";
    console.warn(
      `[slip] shield path failed — falling back to a REAL direct USDC transfer. (${skippedReason})`,
    );
    emit({
      step: EngineStep.Shield,
      status: "done",
      detail: "Privacy unavailable — transferring USDC directly",
    });
  }

  // Step 4 — Settle: per recipient, a PRIVATE transfer from the sender's shielded
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
      // privacyEnabled is only ever set true right after shieldLeg is assigned,
      // so it is guaranteed present here — assert it so the UI artifact below can
      // never silently fall back to a fake "0x"/simulated tx.
      if (!shieldLeg) {
        throw new Error(
          "Invariant violated — privacy enabled without a shield leg.",
        );
      }
      privacy.legs = [shieldLeg, transferLeg];
      // The "settle" artifact for the UI is the shared public deposit edge (a
      // REAL depositWithApproval tx) — there is no separate public USDC transfer
      // to the claim account. Carries the shield's real hash/simulated flag.
      settleTx = {
        hash: shieldLeg.txHash ?? ("0x" as `0x${string}`),
        explorerUrl: shieldLeg.explorerUrl ?? "",
        simulated: shieldLeg.simulated,
      };
      if (i + 1 < plans.length) await sleep(fanoutDelayMs());
    } else {
      // Degraded path: a REAL direct USDC transfer to this claim's account,
      // signed by the connected Arc wallet. settle() throws on any failure (no
      // simulation) — surface a FAILED Settle step and re-throw so we NEVER emit
      // a claim link for funds that did not move.
      try {
        const settled = await settle(
          claimCf.address,
          plan.recipient.amountUsd,
          arcWalletClient,
        );
        settleTx = settled.tx;
      } catch (err) {
        const reason =
          err instanceof Error ? err.message : "Direct USDC settle failed";
        emit({
          step: EngineStep.Settle,
          status: "failed",
          detail: `Settle failed — ${reason}`,
        });
        throw err;
      }
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
