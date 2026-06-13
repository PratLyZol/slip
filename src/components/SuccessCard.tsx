"use client";

/**
 * Post-send success state: "Sent $X to name", the claim link, a QR of the
 * absolute URL, and a copy button. The claim secret lives only in the URL
 * fragment (built client-side from window.location.origin).
 */

import { useMemo, useState } from "react";
import QRCode from "react-qr-code";
import { buildClaimUrl } from "@/lib/engine/claimLink";
import { useOrigin } from "@/lib/useClientValue";
import { formatUsd } from "@/lib/format";
import type { EngineResult } from "@/lib/engine/types";

interface Props {
  result: EngineResult;
  recipient: string;
  onSendAnother: () => void;
}

export default function SuccessCard({ result, recipient, onSendAnother }: Props) {
  const origin = useOrigin();
  const [copied, setCopied] = useState(false);

  const claimUrl = useMemo(
    () => (origin ? buildClaimUrl(result.claimPayload, origin) : ""),
    [origin, result.claimPayload],
  );

  const amount = formatUsd(Number(result.claimPayload.amountUsdc));

  async function copy() {
    if (!claimUrl) return;
    try {
      await navigator.clipboard.writeText(claimUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard may be unavailable; the field is selectable as a fallback.
    }
  }

  return (
    <div className="flex flex-col items-center text-center">
      <span className="rise relative mt-2 grid h-16 w-16 place-items-center rounded-full bg-volt text-ink-950 shadow-[0_0_48px_-8px_var(--volt)]">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
          <path
            d="m5 12.5 4.5 4.5L19 7"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>

      <h2 className="rise display mt-5 text-[28px] font-semibold">
        Sent <span className="amount-figure">{amount}</span>
      </h2>
      <p className="rise mt-1 text-[15px] text-text-dim">
        to <span className="font-semibold text-text">{recipient}</span>
      </p>

      <div className="card card-pop rise mt-7 w-full p-5">
        <p className="kicker text-left">Their claim link</p>

        <div className="mt-4 grid place-items-center">
          {claimUrl ? (
            <div className="rounded-2xl bg-white p-3.5 shadow-[0_0_0_1px_var(--hair-strong),0_16px_48px_-16px_#000c]">
              <QRCode
                value={claimUrl}
                size={168}
                bgColor="#ffffff"
                fgColor="#060708"
                level="M"
              />
            </div>
          ) : (
            <div className="h-[192px] w-[192px] animate-slip-pulse rounded-2xl bg-ink-700" />
          )}
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-xl border border-[var(--hair)] bg-ink-950/60 p-2 pl-3">
          <span className="hash flex-1 truncate text-left text-[12px] text-text-dim">
            {claimUrl || "preparing link…"}
          </span>
          <button
            onClick={copy}
            disabled={!claimUrl}
            className="btn-volt focus-volt shrink-0 rounded-lg px-3.5 py-1.5 text-[12px] font-bold disabled:opacity-40"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        <p className="mt-3 text-left text-[11px] leading-snug text-text-faint">
          The secret stays in the link fragment — it never touches a server.
          Whoever opens it claims the money in their local currency, no wallet
          needed.
        </p>
      </div>

      <p className="rise mt-4 text-[12.5px] font-semibold text-text-dim">
        They&apos;ll tap once. No wallet, no gas.
      </p>

      <button
        onClick={onSendAnother}
        className="focus-volt rise mt-6 rounded-xl border border-[var(--hair)] px-5 py-2.5 text-[14px] font-semibold text-text-dim transition-colors hover:border-[var(--hair-strong)] hover:text-text"
      >
        Send another
      </button>
    </div>
  );
}
