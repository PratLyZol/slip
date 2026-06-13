/**
 * Sender-side receipt store — persists the SEND privacy artifacts in
 * localStorage, keyed by the claim secret (mirrors claimedStore, AGENTS.md:
 * "Store send-side artifacts in localStorage receipts (sender side) like
 * claimedStore does").
 *
 * The Phase 5–7 agent builds the /private proof view on top of this: it reads
 * the send-side legs (deposit IN + the private transfer with NO readable middle)
 * here, and the claim-side withdraw (OUT) from claimedStore — together they tell
 * the "in, out, NO readable middle" story.
 *
 * Hackathon-grade, NO server state (PRD §7). Per-browser only.
 */

import type { EngineResult, PrivacyArtifacts } from "./types";
import type { Hex } from "viem";

const STORAGE_PREFIX = "slip:sent:";

/** The send receipt we persist per secret: the privacy story + settle ref. */
export interface SentReceipt {
  amountUsdc: string;
  region?: "US" | "EU";
  senderName?: string;
  counterfactualAddress: string;
  settleTxHash: string;
  settleExplorerUrl: string;
  /** The send-side privacy artifacts (shield + private transfer legs). */
  privacy: PrivacyArtifacts;
  sentAt: string;
}

function keyFor(secret: Hex): string {
  return `${STORAGE_PREFIX}${secret}`;
}

function hasStorage(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

/** Build a persistable send receipt from a fresh engine result. */
export function sentReceiptFromResult(result: EngineResult): SentReceipt {
  return {
    amountUsdc: result.claimPayload.amountUsdc,
    region: result.claimPayload.region,
    senderName: result.claimPayload.senderName,
    counterfactualAddress: result.counterfactualAddress,
    settleTxHash: result.settleTx.hash,
    settleExplorerUrl: result.settleTx.explorerUrl,
    privacy: result.privacy,
    sentAt: result.claimPayload.createdAt,
  };
}

/** Look up a previously stored send receipt for a secret, or null. */
export function getSentReceipt(secret: Hex): SentReceipt | null {
  if (!hasStorage()) return null;
  try {
    const raw = window.localStorage.getItem(keyFor(secret));
    if (!raw) return null;
    return JSON.parse(raw) as SentReceipt;
  } catch {
    return null;
  }
}

/** Persist a send receipt for a secret (idempotent: first write wins). */
export function saveSentReceipt(secret: Hex, receipt: SentReceipt): void {
  if (!hasStorage()) return;
  try {
    const existing = window.localStorage.getItem(keyFor(secret));
    if (existing) return;
    window.localStorage.setItem(keyFor(secret), JSON.stringify(receipt));
  } catch {
    // Storage unavailable / quota — non-fatal; the send itself still succeeded.
  }
}
