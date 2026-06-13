"use client";

/**
 * Batch payout surface (PRD Phase 5, Surface B).
 *
 * Paste `name, amount[, region]` rows (CSV with header accepted) → preview with
 * inline validation → "Pay N people" → the engine runs over each row with small
 * concurrency → a status table with per-row claim links (copy + mini QR) →
 * "Download links CSV". Each link carries ONLY its own payload — payees never
 * see each other.
 *
 * No DB: batch state is React state; the last batch is persisted to localStorage
 * so a refresh doesn't eat the demo.
 */

import { useCallback, useMemo, useState } from "react";
import QRCode from "react-qr-code";
import {
  parseBatchInput,
  validRows,
  runBatch,
  SAMPLE_BATCH,
  type BatchResultRow,
  type BatchRow,
  type BatchRowStatus,
} from "@/lib/engine/batch";
import {
  saveLastBatch,
  loadLastBatch,
  clearLastBatch,
  type StoredBatchRow,
} from "@/lib/engine/batchStore";
import { useWallet } from "./WalletProvider";
import { useOrigin, useClientValue } from "@/lib/useClientValue";
import { formatUsd } from "@/lib/format";
import type { Region } from "@/lib/engine/types";

/** Unified row shape the status table renders, from live OR restored data. */
interface TableRow {
  id: string;
  name: string;
  amount: number;
  amountUsdc?: string;
  region: Region;
  status: BatchRowStatus;
  claimUrl?: string;
  error?: string;
}

type Phase = "compose" | "running" | "done";

export default function BatchScreen() {
  const wallet = useWallet();
  const origin = useOrigin();

  // Restore the last batch (browser-only) without a setState-in-effect: read it
  // once via useClientValue (server snapshot is null; client reads localStorage).
  const restoredRows = useClientValue<TableRow[] | null>(() => {
    const last = loadLastBatch();
    return last && last.length > 0 ? last.map(storedToTableRow) : null;
  }, null);

  const [text, setText] = useState("");
  // null override → fall through to the restored snapshot (or empty compose).
  const [override, setOverride] = useState<{
    phase: Phase;
    rows: TableRow[];
    restored: boolean;
  } | null>(null);

  const phase: Phase = override?.phase ?? (restoredRows ? "done" : "compose");
  const rows: TableRow[] = override?.rows ?? restoredRows ?? [];
  const restored = override ? override.restored : restoredRows !== null;

  // Mutate the live (override) row set during a run.
  const setRows = useCallback(
    (updater: (prev: TableRow[]) => TableRow[]) => {
      setOverride((o) => {
        const base = o?.rows ?? restoredRows ?? [];
        return {
          phase: o?.phase ?? "running",
          rows: updater(base),
          restored: false,
        };
      });
    },
    [restoredRows],
  );

  const parsed = useMemo(() => parseBatchInput(text), [text]);
  const valid = useMemo(() => validRows(parsed), [parsed]);
  const invalidCount = parsed.length - valid.length;

  const onUpdate = useCallback(
    (r: BatchResultRow) => {
      setRows((prev) =>
        prev.map((tr) => (tr.id === r.row.id ? resultToTableRow(r) : tr)),
      );
    },
    [setRows],
  );

  async function handlePay() {
    if (valid.length === 0) return;
    // Seed the table with all valid rows as pending, in the running phase.
    setOverride({
      phase: "running",
      rows: valid.map(rowToPendingTableRow),
      restored: false,
    });
    const results = await runBatch(valid, origin, wallet.name, onUpdate, 3);
    setOverride((o) => ({
      phase: "done",
      rows: o?.rows ?? results.map(resultToTableRow),
      restored: false,
    }));
    saveLastBatch(results);
  }

  function loadSample() {
    setText(SAMPLE_BATCH);
  }

  function startOver() {
    clearLastBatch();
    setText("");
    setOverride({ phase: "compose", rows: [], restored: false });
  }

  function downloadCsv() {
    const readyRows = rows.filter((r) => r.status === "ready" && r.claimUrl);
    const csv = [
      "name,amount,region,claimUrl",
      ...readyRows.map((r) =>
        [
          csvCell(r.name),
          csvCell(r.amountUsdc ?? r.amount.toFixed(2)),
          csvCell(r.region),
          csvCell(r.claimUrl ?? ""),
        ].join(","),
      ),
    ].join("\n");
    triggerDownload(csv, "slip-payout-links.csv");
  }

  const readyCount = rows.filter((r) => r.status === "ready").length;
  const failedCount = rows.filter((r) => r.status === "failed").length;

  return (
    <div className="flex flex-1 flex-col">
      <header className="rise pb-5 pt-2">
        <span className="rounded-full border border-volt/25 bg-volt/[0.06] px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-volt">
          Batch payout
        </span>
        <h1 className="display mt-3 text-[26px] font-semibold">
          Pay a whole list
        </h1>
        <p className="mt-2 text-[14px] leading-snug text-text-dim">
          Paste names and amounts. Each row runs the same engine — independent,
          isolated claim links. Payees never see each other; your treasury is
          never doxxed.
        </p>
      </header>

      {phase === "compose" && (
        <ComposeView
          text={text}
          setText={setText}
          parsed={parsed}
          validCount={valid.length}
          invalidCount={invalidCount}
          onLoadSample={loadSample}
          onPay={handlePay}
        />
      )}

      {(phase === "running" || phase === "done") && (
        <StatusView
          rows={rows}
          phase={phase}
          restored={restored}
          readyCount={readyCount}
          failedCount={failedCount}
          onDownloadCsv={downloadCsv}
          onStartOver={startOver}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compose view: textarea + live preview + Pay button.
// ---------------------------------------------------------------------------

function ComposeView({
  text,
  setText,
  parsed,
  validCount,
  invalidCount,
  onLoadSample,
  onPay,
}: {
  text: string;
  setText: (v: string) => void;
  parsed: BatchRow[];
  validCount: number;
  invalidCount: number;
  onLoadSample: () => void;
  onPay: () => void;
}) {
  const total = parsed
    .filter((r) => r.errors.length === 0)
    .reduce((sum, r) => sum + r.amount, 0);

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between">
        <label
          htmlFor="batch-input"
          className="kicker"
        >
          Your list
        </label>
        <button
          onClick={onLoadSample}
          className="focus-volt rounded-lg border border-[var(--hair)] bg-ink-850 px-2.5 py-1 text-[11px] font-medium text-text-dim transition-colors hover:text-text"
        >
          Load sample list
        </button>
      </div>

      <textarea
        id="batch-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"name, amount, region\nalice.eth, 250, US\nMateo Rossi, 180.50, EU"}
        rows={7}
        className="focus-volt mt-2 w-full resize-y rounded-2xl border border-[var(--hair)] bg-ink-850 px-4 py-3 font-mono text-[13px] leading-relaxed text-text outline-none placeholder:text-text-faint"
      />
      <p className="mt-2 text-[11px] text-text-faint">
        One per line: <span className="font-mono">name, amount, region</span>.
        Region is <span className="font-mono">US</span> or{" "}
        <span className="font-mono">EU</span> (defaults to US). A CSV header row
        is detected and skipped.
      </p>

      {parsed.length > 0 && (
        <div className="card animate-slip-rise mt-4 p-3">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="kicker">
              Preview
            </span>
            <span className="text-[11px] text-text-faint">
              {validCount} ready
              {invalidCount > 0 && (
                <span className="text-danger"> · {invalidCount} to fix</span>
              )}
            </span>
          </div>
          <ul className="flex flex-col gap-1">
            {parsed.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-[13px]"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={`truncate ${r.errors.length ? "text-text-faint" : "text-text"}`}
                  >
                    {r.name || "—"}
                  </span>
                  {r.errors.length === 0 && (
                    <RegionTag region={r.region} />
                  )}
                </span>
                {r.errors.length === 0 ? (
                  <span className="shrink-0 font-medium text-text">
                    {formatUsd(r.amount)}
                  </span>
                ) : (
                  <span className="shrink-0 text-[11px] text-danger">
                    {r.errors.join(", ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex-1" />

      <button
        onClick={onPay}
        disabled={validCount === 0}
        className="btn-volt focus-volt mt-6 w-full rounded-2xl py-4 text-[16px] font-bold disabled:cursor-not-allowed disabled:opacity-30"
      >
        {validCount === 0
          ? "Add at least one valid row"
          : `Pay ${validCount} ${validCount === 1 ? "person" : "people"} · ${formatUsd(total)}`}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status view: per-row table with link copy + mini QR, CSV download.
// ---------------------------------------------------------------------------

function StatusView({
  rows,
  phase,
  restored,
  readyCount,
  failedCount,
  onDownloadCsv,
  onStartOver,
}: {
  rows: TableRow[];
  phase: Phase;
  restored: boolean;
  readyCount: number;
  failedCount: number;
  onDownloadCsv: () => void;
  onStartOver: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between">
        <p className="kicker">
          {phase === "running"
            ? "Paying…"
            : restored
              ? "Last batch"
              : "Done"}
        </p>
        <p className="text-[11px] text-text-faint">
          {readyCount} ready
          {failedCount > 0 && (
            <span className="text-danger"> · {failedCount} failed</span>
          )}
        </p>
      </div>

      <ul className="mt-3 flex flex-col gap-2">
        {rows.map((r) => (
          <BatchRowCard key={r.id} row={r} />
        ))}
      </ul>

      <div className="flex-1" />

      {phase === "done" && (
        <div className="mt-6 flex flex-col gap-3">
          <button
            onClick={onDownloadCsv}
            disabled={readyCount === 0}
            className="btn-volt focus-volt w-full rounded-2xl py-3.5 text-[15px] font-bold disabled:opacity-30"
          >
            Download links CSV
          </button>
          <button
            onClick={onStartOver}
            className="focus-volt text-[14px] font-medium text-text-dim transition-colors hover:text-text"
          >
            Start a new batch
          </button>
        </div>
      )}
    </div>
  );
}

function BatchRowCard({ row }: { row: TableRow }) {
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!row.claimUrl) return;
    try {
      await navigator.clipboard.writeText(row.claimUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard unavailable
    }
  }

  return (
    <li className="card animate-slip-rise p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[14px] font-medium text-text">
            {row.name}
          </span>
          <RegionTag region={row.region} />
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="text-[14px] font-semibold text-text">
            {formatUsd(Number(row.amountUsdc ?? row.amount))}
          </span>
          <BatchStatusTag status={row.status} />
        </span>
      </div>

      {row.status === "failed" && row.error && (
        <p className="mt-2 text-[11px] text-danger">{row.error}</p>
      )}

      {row.status === "ready" && row.claimUrl && (
        <>
          <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-[var(--hair)] bg-ink-950/60 p-1.5 pl-3">
            <span className="flex-1 hash truncate text-text-dim">
              {row.claimUrl}
            </span>
            <button
              onClick={copy}
              className="btn-volt focus-volt shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-bold"
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              onClick={() => setShowQr((v) => !v)}
              className="focus-volt shrink-0 rounded-lg border border-[var(--hair)] px-2.5 py-1 text-[11px] font-medium text-text-dim transition-colors hover:text-text"
            >
              QR
            </button>
          </div>

          {showQr && (
            <div className="mt-2.5 grid place-items-center">
              <div className="rounded-xl bg-white p-2.5">
                <QRCode
                  value={row.claimUrl}
                  size={132}
                  bgColor="#ffffff"
                  fgColor="#07080a"
                  level="M"
                />
              </div>
            </div>
          )}
        </>
      )}
    </li>
  );
}

function RegionTag({ region }: { region: Region }) {
  return (
    <span className="shrink-0 rounded-md border border-[var(--hair)] px-1.5 py-0.5 text-[10px] font-medium text-text-faint">
      {region === "EU" ? "🇪🇺 EURC" : "🇺🇸 USDC"}
    </span>
  );
}

function BatchStatusTag({ status }: { status: BatchRowStatus }) {
  const map: Record<BatchRowStatus, { label: string; cls: string }> = {
    pending: { label: "pending", cls: "text-text-faint" },
    resolving: { label: "resolving", cls: "text-volt" },
    shielding: { label: "shielding", cls: "text-cool" },
    ready: { label: "link ready", cls: "text-text-faint" },
    failed: { label: "failed", cls: "text-danger" },
  };
  const t = map[status];
  const animate = status === "resolving" || status === "shielding";
  return (
    <span
      className={`rounded-full border border-[var(--hair)] bg-ink-850 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.1em] ${t.cls} ${animate ? "animate-slip-pulse" : ""}`}
    >
      {t.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function rowToPendingTableRow(r: BatchRow): TableRow {
  return {
    id: r.id,
    name: r.name,
    amount: r.amount,
    region: r.region,
    status: "pending",
  };
}

function resultToTableRow(r: BatchResultRow): TableRow {
  return {
    id: r.row.id,
    name: r.row.name,
    amount: r.row.amount,
    amountUsdc: r.result?.claimPayload.amountUsdc,
    region: r.row.region,
    status: r.status,
    claimUrl: r.claimUrl,
    error: r.error,
  };
}

function storedToTableRow(s: StoredBatchRow, i: number): TableRow {
  return {
    id: `restored-${i}`,
    name: s.name,
    amount: s.amount,
    amountUsdc: s.amountUsdc,
    region: s.region,
    status: s.status,
    claimUrl: s.claimUrl,
    error: s.error,
  };
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function triggerDownload(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
