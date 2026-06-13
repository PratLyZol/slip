/**
 * Batch payout parsing + run logic (PRD Phase 5, Surface B).
 *
 * Paste a list of `name, amount[, region]` rows (CSV with an optional header is
 * accepted too). Each VALID row runs the SAME single-send engine ({@link runSend})
 * — independent claim secret, independent claim link. Payees never see each
 * other: every link carries ONLY its own payload (true by construction — the
 * claim fragment is built from a single row's EngineResult).
 *
 * No DB (AGENTS.md / PRD §7). Batch state is React state; the page persists the
 * last batch to localStorage so a refresh doesn't eat the demo.
 *
 * Lenient, hand-rolled parser — no CSV lib (the spec forbids one and the grammar
 * is trivial): split on newlines, split each line on commas, trim, coerce.
 */

import { runSend } from "./index";
import { buildClaimUrl } from "./claimLink";
import { sentReceiptFromResult, saveSentReceipt } from "./sentStore";
import type { EngineResult, Region, SendRequest } from "./types";

/** A single parsed input row before it runs through the engine. */
export interface BatchRow {
  /** Stable id for React keys + status tracking (index-based, unique per parse). */
  id: string;
  /** Recipient handle (name / username / .eth). */
  name: string;
  /** Amount in USD. NaN when the cell couldn't be parsed. */
  amount: number;
  /** Raw amount text as typed (for echoing back in errors). */
  amountRaw: string;
  /** Recipient region (defaults to US when omitted/unrecognized). */
  region: Region;
  /** Validation errors for this row; empty array → valid. */
  errors: string[];
}

/** Lifecycle status of one batch row as the engine runs over it. */
export type BatchRowStatus =
  | "pending" // queued, not started
  | "resolving" // engine running (resolve/aggregate/counterfactual)
  | "shielding" // engine running the shield/settle legs
  | "ready" // settled — claim link is ready
  | "failed"; // engine threw

/** A row that has been (or is being) run through the engine. */
export interface BatchResultRow {
  row: BatchRow;
  status: BatchRowStatus;
  /** The engine result, once settled. */
  result?: EngineResult;
  /** Absolute claim URL (origin-qualified), once settled. */
  claimUrl?: string;
  /** Failure message, when status is "failed". */
  error?: string;
}

const KNOWN_HEADERS = new Set(["name", "amount", "region"]);

/** Normalize a region cell to a Region (default US). */
function parseRegion(cell: string | undefined): Region {
  const v = (cell ?? "").trim().toLowerCase();
  if (v === "eu" || v === "europe" || v === "eur" || v === "eurc") return "EU";
  return "US";
}

/**
 * Parse pasted text into rows. Accepts both bare `name, amount[, region]` lines
 * and CSV with a header row (the header is detected + skipped). Blank lines are
 * ignored. Every row gets validated; errors are attached, not thrown.
 */
export function parseBatchInput(text: string): BatchRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const rows: BatchRow[] = [];
  let idx = 0;

  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split(",").map((c) => c.trim());

    // Skip a header row (only meaningful on the FIRST line).
    if (i === 0 && looksLikeHeader(cells)) continue;

    const [name = "", amountRaw = "", regionCell] = cells;
    const errors: string[] = [];

    if (!name) errors.push("missing name");

    // Strip currency symbols / thousands separators leniently.
    const cleaned = amountRaw.replace(/[$,€\s]/g, "");
    const amount = Number(cleaned);
    if (!amountRaw) {
      errors.push("missing amount");
    } else if (!Number.isFinite(amount) || amount <= 0) {
      errors.push(`invalid amount "${amountRaw}"`);
    }

    rows.push({
      id: `row-${idx++}`,
      name,
      amount,
      amountRaw,
      region: parseRegion(regionCell),
      errors,
    });
  }

  return rows;
}

/** Heuristic: a first line whose cells are all known header words is a header. */
function looksLikeHeader(cells: string[]): boolean {
  if (cells.length === 0) return false;
  return cells.every((c) => KNOWN_HEADERS.has(c.trim().toLowerCase()));
}

/** Only the rows with no validation errors are runnable. */
export function validRows(rows: BatchRow[]): BatchRow[] {
  return rows.filter((r) => r.errors.length === 0);
}

/** Build the SendRequest for one row. */
export function rowToSendRequest(row: BatchRow, senderName?: string): SendRequest {
  return {
    recipient: row.name,
    amountUsd: row.amount,
    senderName,
    region: row.region,
  };
}

/**
 * Run the engine over many rows with bounded concurrency so the per-row step
 * animation stays legible (PRD: "sequentially or small-concurrency 2-3 at a
 * time"). Each row is independent — its own secret, its own link.
 *
 * @param rows        the VALID rows to run
 * @param origin      window.location.origin, for absolute claim URLs
 * @param senderName  optional sender display name embedded in each link
 * @param onUpdate    fired whenever a row's status/result changes (live UI)
 * @param concurrency max rows in flight at once (default 3)
 */
export async function runBatch(
  rows: BatchRow[],
  origin: string,
  senderName: string | undefined,
  onUpdate: (row: BatchResultRow) => void,
  concurrency = 3,
): Promise<BatchResultRow[]> {
  const out: BatchResultRow[] = rows.map((row) => ({ row, status: "pending" }));

  // Index queue consumed by a fixed pool of workers.
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= rows.length) return;
      const row = rows[i];

      const emit = (patch: Partial<BatchResultRow>) => {
        out[i] = { ...out[i], ...patch };
        onUpdate(out[i]);
      };

      emit({ status: "resolving" });
      try {
        const result = await runSend(
          rowToSendRequest(row, senderName),
          (s) => {
            // Surface a coarse phase from the engine's fine-grained steps.
            if (s.step === "shield" || s.step === "settle") {
              if (out[i].status !== "ready") emit({ status: "shielding" });
            }
          },
        );
        // Persist the send-side artifacts so /private can read any batch row too.
        saveSentReceipt(result.secret, sentReceiptFromResult(result));
        const claimUrl = origin
          ? buildClaimUrl(result.claimPayload, origin)
          : undefined;
        emit({ status: "ready", result, claimUrl });
      } catch (e) {
        emit({
          status: "failed",
          error: e instanceof Error ? e.message : "Send failed",
        });
      }
    }
  }

  const pool = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(pool);
  return out;
}

/**
 * Build the downloadable links CSV (the contractor-payout deliverable).
 * Columns: name,amount,region,claimUrl. Only settled rows are included.
 */
export function batchToCsv(results: BatchResultRow[]): string {
  const header = "name,amount,region,claimUrl";
  const lines = results
    .filter((r) => r.status === "ready" && r.claimUrl)
    .map((r) => {
      const amount = r.result?.claimPayload.amountUsdc ?? r.row.amount.toFixed(2);
      return [
        csvCell(r.row.name),
        csvCell(amount),
        csvCell(r.row.region),
        csvCell(r.claimUrl ?? ""),
      ].join(",");
    });
  return [header, ...lines].join("\n");
}

/** Quote a CSV cell if it contains a comma, quote, or newline. */
function csvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** ~8 realistic demo rows mixing US + EU for the "load sample list" affordance. */
export const SAMPLE_BATCH = [
  "name, amount, region",
  "alice.eth, 250, US",
  "Mateo Rossi, 180.50, EU",
  "priya, 320, US",
  "Sofia Müller, 210, EU",
  "jordan, 95, US",
  "Luca Bianchi, 140.75, EU",
  "wei.eth, 400, US",
  "Emma Dubois, 175, EU",
].join("\n");
