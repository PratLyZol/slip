/**
 * Claimed-state tracking — hackathon-grade, NO server state (AGENTS.md, PRD §7).
 *
 * A claim link is single-use in spirit. We can't enforce that on-chain in the
 * demo, but we can give a clean UX: once a secret is claimed in this browser, we
 * persist its receipt in localStorage. Re-opening the same link then shows
 * "Already claimed" with the ORIGINAL receipt instead of running the engine
 * again. This is per-browser only (PRD §7 explicitly scopes out cross-device
 * double-claim handling).
 *
 * Keyed by the secret so the lookup needs nothing but the link itself.
 */

import type { ClaimResult } from "./types";
import type { Hex } from "viem";

const STORAGE_PREFIX = "slip:claimed:";

/** The receipt we persist per claimed secret. */
export interface ClaimReceipt {
  recipientAddress: string;
  withdrawTxHash: string;
  withdrawExplorerUrl: string;
  withdrawSimulated: boolean;
  token: string;
  amount: string;
  rateUsed?: number;
  fxTxHash?: string;
  claimedAt: string;
}

function keyFor(secret: Hex): string {
  return `${STORAGE_PREFIX}${secret}`;
}

function hasStorage(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

/** Build a persistable receipt from a fresh claim result. */
export function receiptFromResult(result: ClaimResult): ClaimReceipt {
  return {
    recipientAddress: result.recipientAddress,
    withdrawTxHash: result.withdrawTx.hash,
    withdrawExplorerUrl: result.withdrawTx.explorerUrl,
    withdrawSimulated: result.withdrawTx.simulated,
    token: result.fx.token,
    amount: result.fx.amount,
    rateUsed: result.fx.rateUsed,
    fxTxHash: result.fx.txHash,
    claimedAt: result.claimedAt,
  };
}

/** Look up a previously stored receipt for a secret, or null. */
export function getClaimReceipt(secret: Hex): ClaimReceipt | null {
  if (!hasStorage()) return null;
  try {
    const raw = window.localStorage.getItem(keyFor(secret));
    if (!raw) return null;
    return JSON.parse(raw) as ClaimReceipt;
  } catch {
    return null;
  }
}

/** Persist a receipt for a secret (idempotent: first write wins). */
export function saveClaimReceipt(secret: Hex, receipt: ClaimReceipt): void {
  if (!hasStorage()) return;
  try {
    const existing = window.localStorage.getItem(keyFor(secret));
    if (existing) return; // first claim wins; keep the original receipt
    window.localStorage.setItem(keyFor(secret), JSON.stringify(receipt));
  } catch {
    // Storage unavailable / quota — non-fatal; the claim itself still succeeded.
  }
}

/** True if this secret has already been claimed in this browser. */
export function isAlreadyClaimed(secret: Hex): boolean {
  return getClaimReceipt(secret) !== null;
}
