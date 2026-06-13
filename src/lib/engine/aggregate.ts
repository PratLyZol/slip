/**
 * Step 2 — Aggregate: bring the sender's USDC onto Arc via Circle CCTP.
 *
 * Two parts, in order:
 *   1. {@link aggregate} — verify the sender holds enough USDC (honest
 *      pass-through; "Dynamic chain abstraction / swap-everything-to-USDC" was
 *      NOT a verifiable first-class Dynamic product — docs/research/dynamic.md
 *      §5; PLAN §4: Dynamic has no aggregate product).
 *   2. {@link bridgeToArc} — the REAL aggregation: a Circle CCTP bridge that
 *      burns Σ(amount) USDC on Base Sepolia and mints it on Arc (forwarder mode,
 *      no recipient Arc gas). PLAN §4: CCTP fills the aggregation role. Bridges
 *      the TOTAL ONCE — never per-recipient.
 *
 * Both branch on the GLOBAL demo mode only (no per-adapter flag): demo mode
 * simulates; real mode runs the live bridge and surfaces honest errors.
 */

import type { Address } from "viem";
import { getUsdcBalance } from "../adapters/balance";
import {
  getBridgeOps,
  type BridgeToArcParams,
  type BridgeToArcResult,
} from "../adapters/bridge";
import { simLatency, sleep } from "../demo/sim";
import type { AggregateResult } from "./types";

/**
 * Verify (and conceptually consolidate) the sender's assets into spendable USDC.
 * Pass-through fallback: read USDC balance, confirm it covers `amountUsd`.
 */
export async function aggregate(
  amountUsd: number,
  senderAddress?: Address,
): Promise<AggregateResult> {
  await sleep(simLatency(400, 900));
  const availableUsdc = await getUsdcBalance(senderAddress);
  return {
    availableUsdc,
    sufficient: availableUsdc + 1e-9 >= amountUsd,
  };
}

/**
 * Aggregate the funds onto Arc via Circle CCTP (the real aggregation leg).
 * Burns Σ on Base Sepolia, mints on Arc, awaits the mint, returns both edges.
 * Throws an honest error in real mode on failure (no silent sim fallback).
 */
export async function bridgeToArc(
  params: BridgeToArcParams,
): Promise<BridgeToArcResult> {
  return getBridgeOps().bridgeToArc(params);
}
