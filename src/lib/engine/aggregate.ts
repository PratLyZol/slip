/**
 * Step 2 — Aggregate: sender's holdings → USDC.
 *
 * NOTE: "Dynamic chain abstraction / swap-everything-to-USDC" was NOT verifiable
 * as a first-class Dynamic SDK product (docs/research/dynamic.md §5). Per the PRD
 * fallback (§8: "sender already holds USDC; aggregation becomes a code-path
 * talking point"), this is implemented as an HONEST pass-through that simply
 * verifies the sender's USDC balance covers the amount. If a real aggregation
 * SDK surface is confirmed later, it slots in here behind the same interface.
 */

import type { Address } from "viem";
import { getUsdcBalance } from "../adapters/balance";
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
