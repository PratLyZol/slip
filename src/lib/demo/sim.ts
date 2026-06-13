/**
 * Demo-mode primitives: deterministic latency + plausible fake tx hashes.
 *
 * Every adapter has a demo implementation (AGENTS.md). Simulated txs derive
 * their hashes from input via keccak so they're stable across runs, and their
 * explorer URLs point at the real ArcScan host even though the tx never
 * happened. Simulated txs are labeled clearly in dev; UI copy stays clean.
 */

import { keccak256, toHex, type Hex } from "viem";
import { txUrl } from "../adapters/arc";
import type { TxRef } from "../engine/types";

/** Realistic network latency for a simulated step (300–1500ms by default). */
export function simLatency(min = 300, max = 1500): number {
  const span = Math.max(0, max - min);
  return min + Math.floor(Math.random() * (span + 1));
}

/** Sleep helper for simulated work. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Deterministic 32-byte tx hash derived from a label + inputs via keccak.
 * Same inputs → same hash, so demo runs are reproducible.
 */
export function fakeTxHash(...parts: string[]): Hex {
  return keccak256(toHex(`slip:tx:${parts.join("|")}`));
}

/** Build a labeled simulated TxRef pointing at the real explorer host. */
export function simTx(...parts: string[]): TxRef {
  const hash = fakeTxHash(...parts);
  if (process.env.NODE_ENV !== "production") {
    // Loud in dev so we never mistake a simulation for a real settlement.
    console.warn(`[slip:demo] simulated tx ${hash} (${parts.join("|")})`);
  }
  return { hash, explorerUrl: txUrl(hash), simulated: true };
}
