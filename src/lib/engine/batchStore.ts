/**
 * Last-batch persistence — hackathon-grade, NO server state (PRD §7).
 *
 * Persists the most recent batch run to localStorage so a refresh mid-demo
 * doesn't eat the results. Per-browser only. We store a slimmed snapshot (no
 * live status churn) sufficient to re-render the status table + re-export CSV.
 */

import type { BatchResultRow } from "./batch";
import type { Region } from "./types";

const STORAGE_KEY = "slip:batch:last";

/** A persisted batch row (slimmed from {@link BatchResultRow}). */
export interface StoredBatchRow {
  name: string;
  amount: number;
  region: Region;
  status: "ready" | "failed";
  claimUrl?: string;
  error?: string;
  /** The settled amount string (post-engine), for accurate CSV re-export. */
  amountUsdc?: string;
}

function hasStorage(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

/** Persist a completed batch (only terminal rows are worth saving). */
export function saveLastBatch(results: BatchResultRow[]): void {
  if (!hasStorage()) return;
  const stored: StoredBatchRow[] = results
    .filter((r) => r.status === "ready" || r.status === "failed")
    .map((r) => ({
      name: r.row.name,
      amount: r.row.amount,
      region: r.row.region,
      status: r.status === "ready" ? "ready" : "failed",
      claimUrl: r.claimUrl,
      error: r.error,
      amountUsdc: r.result?.claimPayload.amountUsdc,
    }));
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Quota / unavailable — non-fatal; the batch still ran in-memory.
  }
}

/** Load the last persisted batch, or null. */
export function loadLastBatch(): StoredBatchRow[] | null {
  if (!hasStorage()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed as StoredBatchRow[];
  } catch {
    return null;
  }
}

/** Clear the persisted batch. */
export function clearLastBatch(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
