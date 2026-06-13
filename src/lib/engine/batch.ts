/**
 * Batch payout parsing + run logic (PRD Phase 5, Surface B).
 *
 * Paste a list of `name, amount[, region]` rows (CSV with an optional header is
 * accepted too). All VALID rows run through the engine as ONE batch fan-out
 * ({@link runBatchSend}): a single Σ shield into the sender's private pool, then
 * N private transfers — one per recipient — to N independent claim accounts.
 * That shared single deposit is what makes the batch's unlinkability
 * self-contained (PLAN §1), NOT N separate single-sends.
 *
 * Each recipient still gets an INDEPENDENT claim secret + claim link, and payees
 * never see each other: every link carries ONLY its own payload (true by
 * construction — each fragment is built from one recipient's EngineResult).
 *
 * No DB (AGENTS.md / PRD §7). Batch state is React state; the page persists the
 * last batch to localStorage so a refresh doesn't eat the demo.
 *
 * Lenient, hand-rolled parser — no CSV lib (the spec forbids one and the grammar
 * is trivial): split on newlines, split each line on commas, trim, coerce.
 */

import { runBatchSend } from "./index";
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

/** Build the SendRequest for one row (a single-recipient send). */
export function rowToSendRequest(row: BatchRow, senderName?: string): SendRequest {
  return {
    recipients: [{ identifier: row.name, amountUsd: row.amount, region: row.region }],
    senderName,
  };
}

/** Build ONE SendRequest covering all rows — the batch fan-out (a single Σ shield). */
export function rowsToSendRequest(rows: BatchRow[], senderName?: string): SendRequest {
  return {
    recipients: rows.map((r) => ({
      identifier: r.name,
      amountUsd: r.amount,
      region: r.region,
    })),
    senderName,
  };
}

/**
 * Run all valid rows as ONE batch fan-out ({@link runBatchSend}): one shared Σ
 * shield into the sender's private pool, then N private transfers to N
 * independent claim accounts. This is what realises the single-deposit
 * unlinkability property (PLAN §1) — it is NOT N separate single-sends.
 *
 * Because the batch is one shared engine run, rows advance as a GROUP
 * (resolving → shielding → ready), and if the shared fan-out throws the batch
 * fails as a unit. Each recipient still gets its own secret + isolated claim link
 * (built from its own EngineResult).
 *
 * @param rows        the VALID rows to run (result order matches row order)
 * @param origin      window.location.origin, for absolute claim URLs
 * @param senderName  optional sender display name embedded in each link
 * @param onUpdate    fired whenever a row's status/result changes (live UI)
 * @param _concurrency accepted for call-site compatibility; the batch now runs as
 *                     a single fan-out, so there is no per-row concurrency.
 */
export async function runBatch(
  rows: BatchRow[],
  origin: string,
  senderName: string | undefined,
  onUpdate: (row: BatchResultRow) => void,
  _concurrency = 3,
): Promise<BatchResultRow[]> {
  const out: BatchResultRow[] = rows.map((row) => ({ row, status: "pending" }));
  if (rows.length === 0) return out;

  // The fan-out is ONE engine run with a SHARED step stream, so rows move
  // together. Advance every not-yet-terminal row to a coarse phase.
  const setAll = (status: BatchRowStatus) => {
    for (let i = 0; i < out.length; i++) {
      if (out[i].status === "ready" || out[i].status === "failed") continue;
      out[i] = { ...out[i], status };
      onUpdate(out[i]);
    }
  };

  setAll("resolving");

  try {
    const results = await runBatchSend(
      rowsToSendRequest(rows, senderName),
      (s) => {
        // Coarse phase from the shared steps: the single Σ deposit + the private
        // transfers are the "shielding" phase; resolution is "resolving".
        if (s.status !== "running") return;
        if (s.step === "shield" || s.step === "settle") setAll("shielding");
        else if (s.step === "resolve") setAll("resolving");
      },
    );

    // Map each EngineResult back to its row (same order) → ready + claim link.
    for (let i = 0; i < out.length; i++) {
      const result = results[i];
      if (!result) {
        out[i] = { ...out[i], status: "failed", error: "No result for this row." };
        onUpdate(out[i]);
        continue;
      }
      // Persist the send-side artifacts so /private can read any batch row too.
      saveSentReceipt(result.secret, sentReceiptFromResult(result));
      const claimUrl = origin
        ? buildClaimUrl(result.claimPayload, origin)
        : undefined;
      out[i] = { ...out[i], status: "ready", result, claimUrl };
      onUpdate(out[i]);
    }
  } catch (e) {
    // One Σ shield underlies the whole batch — if the shared fan-out throws, the
    // batch fails as a unit (mark every not-yet-ready row failed).
    const error = e instanceof Error ? e.message : "Batch send failed";
    for (let i = 0; i < out.length; i++) {
      if (out[i].status === "ready") continue;
      out[i] = { ...out[i], status: "failed", error };
      onUpdate(out[i]);
    }
  }

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
