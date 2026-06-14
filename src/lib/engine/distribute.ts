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
 * The privacy path is the ONLY path — there is NO direct-settle fallback. A
 * direct USDC transfer would send funds to a keyless EOA derived from the claim
 * secret, but the claim ALWAYS unshields from the Unlink pool to the pregen
 * recipient address, so a direct settle would strand the money. On shield failure
 * the distribute emits a FAILED Shield step and THROWS: no funds move and no claim
 * link is produced. A claim link is emitted ONLY after a real shielded transfer.
 */

import type { WalletClient } from "viem";
import { getShieldOps } from "../adapters/unlink";
import { deriveCounterfactual, generateClaimSecret } from "./counterfactual";
import { resolve } from "./resolve";
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
  // Resolved ONCE up front: the shield (deposit) needs the connected wallet's
  // Arc client to sign the ERC-20 approve + deposit. If no wallet is connected we
  // cannot move funds at all, so this is a hard failure of the whole distribute.
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
  // The privacy path is the ONLY path. There is NO degraded direct-settle
  // fallback: a direct USDC transfer would send funds to a keyless EOA derived
  // from the claim secret, but the claim ALWAYS unshields from the Unlink pool to
  // the pregen recipient address — so a direct settle would strand the money
  // (recipient could never claim it in-app). On shield failure we therefore emit
  // a FAILED Shield step and THROW: no funds move, no claim link is produced.
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
    // Shield failed → the send cannot proceed privately, and there is no safe
    // non-private fallback (see above). Fail honestly: no money has moved.
    const reason =
      err instanceof Error ? err.message : "Unlink shielded path unavailable";
    console.warn(`[slip] shield failed — aborting send (no funds moved). (${reason})`);
    emit({
      step: EngineStep.Shield,
      status: "failed",
      detail: `Shield failed — ${reason}`,
    });
    throw err;
  }

  // Step 4 — Settle (the PRIVATE transfer leg, now the ONLY path): per recipient,
  // a private transfer from the sender's shielded balance to that recipient's
  // claim account — the private middle. One EngineResult per recipient. We only
  // reach here when the shield succeeded (otherwise we threw above), so a claim
  // link is NEVER produced without a real shielded transfer.
  emit({ step: EngineStep.Settle, status: "running" });
  const results: EngineResult[] = [];

  // privacyEnabled is true and shieldLeg is present here (the shield catch throws
  // otherwise) — assert it once so the per-recipient artifacts below can never
  // fall back to a fake "0x"/simulated tx.
  if (!privacyEnabled || !shieldLeg) {
    throw new Error("Invariant violated — reached settle without a shield leg.");
  }

  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    // The claim account derived from this recipient's own secret — what the
    // recipient re-derives at claim time (the result's counterfactualAddress).
    const claimCf = await deriveCounterfactual(plan.claimSecret);

    const privacy: PrivacyArtifacts = {
      enabled: true,
      senderUnlinkAddress,
      legs: [shieldLeg],
    };

    // PRIVATE transfer: sender shielded balance → this claim's account.
    // Sequential with a small inter-call delay (heavy proofs; SDK retries 3×).
    const claimUnlinkAddress = await ops.claimAddress(plan.claimSecret);
    const transferLeg = await ops.privateTransfer(
      batchSecret,
      plan.claimSecret,
      plan.amountUsdc,
    );
    privacy.claimUnlinkAddress = claimUnlinkAddress;
    privacy.legs = [shieldLeg, transferLeg];
    // The "settle" artifact for the UI is the shared public deposit edge (a REAL
    // depositWithApproval tx) — there is no separate public USDC transfer to the
    // claim account. Carries the shield's real hash/simulated flag.
    const settleTx: EngineResult["settleTx"] = {
      hash: shieldLeg.txHash ?? ("0x" as `0x${string}`),
      explorerUrl: shieldLeg.explorerUrl ?? "",
      simulated: shieldLeg.simulated,
    };
    if (i + 1 < plans.length) await sleep(fanoutDelayMs());

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
  // Always the private-transfer leg now (the only path).
  emit({
    step: EngineStep.Settle,
    status: "done",
    detail: single
      ? "Parked in shielded balance until claim"
      : `${plans.length} private transfers — parked until claim`,
    explorerUrl: shieldLeg.explorerUrl || undefined,
  });

  // Re-stamp each result's steps with the FINAL shared step states (so every
  // recipient carries the completed Resolve→Settle sequence for receipts/UI).
  for (const r of results) r.steps = steps.map((s) => ({ ...s }));

  return results;
}
