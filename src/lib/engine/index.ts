/**
 * The engine — one pipeline, two surfaces (single send + batch). Batch is the
 * hero (PLAN §0): the privacy property is self-contained at N>1. The engine is
 * `recipients[]`-first — N=1 is the trivial case of the same code path.
 *
 * The pipeline is split into two independently-retriable legs so the UI can run
 * them as separate steps:
 *   - {@link runBridge}     (src/lib/engine/bridge.ts) — CCTP aggregation: burn Σ
 *                            on the origin chain, mint onto Arc, ONCE.
 *   - {@link runDistribute} (src/lib/engine/distribute.ts) — Resolve + Shield +
 *                            Settle + claim links, over funds ALREADY on Arc.
 *
 * {@link runBatchSend} / {@link runSend} are kept as thin wrappers (bridge then
 * distribute) so /batch and /private keep compiling with the old contract.
 *
 * The batch privacy model (PLAN §2):
 *  - ONE `batchSecret` derives the SENDER's Unlink account.
 *  - Bridge Σ(amounts) onto Arc ONCE (CCTP), then shield Σ ONCE into the sender's
 *    shielded balance (a wallet-funded deposit of the bridged USDC).
 *  - For EACH recipient: a fresh per-recipient `claimSecret` derives that
 *    recipient's claim account; a PRIVATE transfer moves their amount from the
 *    sender's shielded balance to their claim account (the leg where the amount +
 *    the sender↔recipient edge vanish on-chain).
 *  - N claim links, one per recipient.
 *
 * The whole batch shares ONE public deposit of Σ and produces N unlinkable
 * payouts — that is the unlinkability property (PLAN §1). The privacy path
 * degrades safely (PRD §8): if the shared shield throws, the send falls back to
 * per-recipient direct settle so it NEVER blocks.
 */

import { runBridge } from "./bridge";
import { buildClaimUrl } from "./claimLink";
import { runDistribute } from "./distribute";
import {
  type EngineResult,
  type SendRequest,
  type StepListener,
  type StepState,
} from "./types";

/**
 * Run a BATCH send through the engine — the true privacy fan-out.
 *
 * A thin wrapper over the two legs: {@link runBridge} (CCTP aggregation of Σ onto
 * Arc) then {@link runDistribute} (resolve + shield + private fan-out + claim
 * links). Emits the same {@link StepState} sequence the old monolith did, so
 * existing progress UIs read unchanged, and stamps the FULL Resolve→Settle (plus
 * Aggregate) step set onto every {@link EngineResult}.
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

  // Accumulate steps from BOTH legs so each result carries the complete
  // Aggregate + Resolve→Settle sequence the old single-call pipeline produced.
  const steps: StepState[] = [];
  const collect = (state: StepState) => {
    const idx = steps.findIndex((s) => s.step === state.step);
    if (idx >= 0) steps[idx] = state;
    else steps.push(state);
    onStep?.(state);
  };

  const total = req.recipients.reduce((sum, r) => sum + r.amountUsd, 0);

  // Leg 1 — bridge Σ onto Arc ONCE (CCTP aggregation). Throws honestly on
  // failure (insufficient USDC, unsupported network, no wallet) — no fallback.
  await runBridge(
    {
      amountUsd: total,
      senderAddress: req.senderAddress,
      originChainId: req.originChainId,
      getWalletClient: req.getWalletClient,
    },
    collect,
  );

  // Leg 2 — distribute over the Arc funds: resolve, shield Σ once, private
  // fan-out, claim links. Reads the wallet's Arc USDC fresh (switches to Arc
  // inside its shield step) — it does NOT depend on leg 1 in the same JS call.
  const results = await runDistribute(
    {
      recipients: req.recipients,
      senderName: req.senderName,
      senderAddress: req.senderAddress,
      getWalletClient: req.getWalletClient,
    },
    collect,
  );

  // Re-stamp each result with the FULL combined step set (Aggregate from leg 1 +
  // Resolve→Settle from leg 2), so receipts/UI carry the whole sequence.
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

export { runBridge } from "./bridge";
export { runDistribute } from "./distribute";
export { buildClaimUrl };
