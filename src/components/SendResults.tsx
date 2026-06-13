"use client";

/**
 * Multi-recipient send result: one claim link per recipient row. Shown after a
 * send with >1 recipient (N=1 keeps the single-ticket SuccessCard). Each row is
 * labelled by the sender's arbitrary name; the money path is keyed off the
 * email/phone behind it.
 */

import { useState } from "react";
import QRCode from "react-qr-code";
import { buildClaimUrl } from "@/lib/engine/claimLink";
import { useOrigin } from "@/lib/useClientValue";
import { formatUsd } from "@/lib/format";
import type { EngineResult } from "@/lib/engine/types";

export interface SentRow {
  id: string;
  name: string;
  contact: string;
  amount: string;
}

export default function SendResults({
  results,
  rows,
  onSendAnother,
}: {
  results: EngineResult[];
  rows: SentRow[];
  onSendAnother: () => void;
}) {
  const origin = useOrigin();
  const total = results.reduce(
    (sum, r) => sum + Number(r.claimPayload.amountUsdc),
    0,
  );

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex flex-col items-center pt-4 text-center">
        <span className="rise grid h-14 w-14 place-items-center rounded-full bg-volt text-[#07130b] shadow-[0_10px_28px_-10px_var(--volt)]">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
            <path
              d="m5 12.5 4.5 4.5L19 7"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <h2 className="serif rise mt-4 text-[28px]">
          Sent to {results.length} {results.length === 1 ? "person" : "people"}
        </h2>
        <p className="amount-figure rise mt-1 text-[15px] text-text-dim">
          {formatUsd(total)} total
        </p>
      </header>

      <p className="kicker rise mt-7">Their claim links</p>
      <ul className="mt-2 flex flex-col gap-2">
        {results.map((res, i) => (
          <ResultRow
            key={res.secret}
            label={rows[i]?.name?.trim() || rows[i]?.contact || `Recipient ${i + 1}`}
            amount={res.claimPayload.amountUsdc}
            url={origin ? buildClaimUrl(res.claimPayload, origin) : ""}
          />
        ))}
      </ul>

      <div className="flex-1" />

      <button
        onClick={onSendAnother}
        className="focus-volt rise mt-6 w-full rounded-2xl border border-[var(--hair)] py-3.5 text-[14px] font-semibold text-text-dim transition-colors hover:border-[var(--hair-strong)] hover:text-text"
      >
        Send another
      </button>
    </div>
  );
}

function ResultRow({
  label,
  amount,
  url,
}: {
  label: string;
  amount: string;
  url: string;
}) {
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard unavailable
    }
  }

  return (
    <li className="card rise p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-[14px] font-semibold text-text">
          {label}
        </span>
        <span className="amount-figure shrink-0 text-[14px] font-semibold text-text">
          {formatUsd(Number(amount))}
        </span>
      </div>

      <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-[var(--hair)] bg-ink-900 p-1.5 pl-3">
        <span className="hash flex-1 truncate text-text-dim">
          {url || "preparing…"}
        </span>
        <button
          onClick={copy}
          disabled={!url}
          className="btn-volt focus-volt shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-bold disabled:opacity-40"
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          onClick={() => setShowQr((v) => !v)}
          disabled={!url}
          className="focus-volt shrink-0 rounded-lg border border-[var(--hair)] px-2.5 py-1 text-[11px] font-semibold text-text-dim transition-colors hover:text-text disabled:opacity-40"
        >
          QR
        </button>
      </div>

      {showQr && url && (
        <div className="mt-2.5 grid place-items-center">
          <div className="rounded-xl border border-[var(--hair)] bg-white p-2.5">
            <QRCode value={url} size={132} bgColor="#ffffff" fgColor="#16130a" level="M" />
          </div>
        </div>
      )}
    </li>
  );
}
