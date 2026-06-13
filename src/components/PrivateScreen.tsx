"use client";

/**
 * "You can't read it" proof view (PRD Phase 7) — the demo kill-shot for judges.
 *
 * Built from REAL receipt data (sentStore + claimedStore): pick the most recent
 * send (or a ?secret= focus) and render the on-chain story as three parts:
 *
 *   [deposit edge]  PUBLIC  — tx hash + explorer link (funding source visible)
 *   [private middle] HIDDEN — big "nothing readable here"; opaque proof bytes;
 *                             an explicit list of what an observer CANNOT see
 *   [withdraw edge] PUBLIC  — tx hash + explorer link (destination visible)
 *
 * Plus the line "Even the builder can't read this." and a small comparison
 * against a normal transfer (which leaks from / to / $amount).
 *
 * Simulated artifacts are labeled honestly (AGENTS.md): demo tx hashes 404 on
 * the real explorer, so a caption says so.
 */

import { useState } from "react";
import { runSend } from "@/lib/engine";
import {
  mostRecentSentReceipt,
  getSentReceipt,
  sentReceiptFromResult,
  saveSentReceipt,
  type SentReceipt,
} from "@/lib/engine/sentStore";
import { getClaimReceipt } from "@/lib/engine/claimedStore";
import { useClientValue } from "@/lib/useClientValue";
import { formatUsd, shortAddress } from "@/lib/format";
import type { Hex } from "viem";

type View =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "ready"; secret: Hex; receipt: SentReceipt };

/** Read ?secret= from the URL (proof view can focus a specific send). */
function useSecretParam(): Hex | null {
  return useClientValue(() => {
    try {
      const p = new URLSearchParams(window.location.search).get("secret");
      return p && /^0x[0-9a-fA-F]{64}$/.test(p) ? (p as Hex) : null;
    } catch {
      return null;
    }
  }, null);
}

export default function PrivateScreen() {
  const focusSecret = useSecretParam();

  // Compute the initial view from localStorage WITHOUT a setState-in-effect:
  // useClientValue returns the server snapshot ("loading") on first paint, then
  // the client read. A handler override takes over after a demo send.
  const computed = useClientValue<View>(() => {
    if (focusSecret) {
      const receipt = getSentReceipt(focusSecret);
      if (receipt) return { kind: "ready", secret: focusSecret, receipt };
    }
    const recent = mostRecentSentReceipt();
    if (recent) {
      return { kind: "ready", secret: recent.secret, receipt: recent.receipt };
    }
    return { kind: "empty" };
  }, { kind: "loading" });

  const [override, setOverride] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const view = override ?? computed;

  /** Empty-state one-tap: fire a $50 demo send headlessly and populate the view. */
  async function runDemoSend() {
    setBusy(true);
    try {
      const res = await runSend({
        recipients: [{ identifier: "alice.eth", amountUsd: 50, region: "EU" }],
        senderName: "Demo Sender",
      });
      const receipt = sentReceiptFromResult(res);
      saveSentReceipt(res.secret, receipt);
      setOverride({ kind: "ready", secret: res.secret, receipt });
    } finally {
      setBusy(false);
    }
  }

  if (view.kind === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-10 w-10 animate-slip-pulse rounded-full border-2 border-volt border-t-transparent" />
      </div>
    );
  }

  if (view.kind === "empty") {
    return <EmptyState busy={busy} onRun={runDemoSend} />;
  }

  return <ProofView secret={view.secret} receipt={view.receipt} />;
}

// ---------------------------------------------------------------------------

function EmptyState({ busy, onRun }: { busy: boolean; onRun: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <span className="grid h-14 w-14 place-items-center rounded-full border border-[var(--hair)] bg-ink-850 text-text-faint">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 3 5 6v5c0 4 3 6.5 7 8 4-1.5 7-4 7-8V6l-7-3Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <h1 className="serif mt-4 text-[26px]">Send something first</h1>
      <p className="mt-2 max-w-[300px] text-[14px] leading-snug text-text-dim">
        This view proves a real send is unreadable on-chain. Run a quick demo
        send and we&apos;ll show you what the explorer can — and can&apos;t — see.
      </p>
      <button
        onClick={onRun}
        disabled={busy}
        className="btn-volt focus-volt mt-6 rounded-2xl px-6 py-3.5 text-[15px] font-bold disabled:opacity-50"
      >
        {busy ? "Sending…" : "Run a demo send"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ProofView({ secret, receipt }: { secret: Hex; receipt: SentReceipt }) {
  const claim = getClaimReceipt(secret);
  const privacy = receipt.privacy;

  const depositLeg = privacy.legs.find((l) => l.kind === "shield");
  const transferLeg = privacy.legs.find((l) => l.kind === "transfer");
  const amount = formatUsd(Number(receipt.amountUsdc));

  // Any leg we render simulated → show the honest "demo hashes 404" caption.
  const anySimulated =
    (depositLeg?.simulated ?? true) ||
    (claim?.unshield?.simulated ?? claim?.withdrawSimulated ?? true);

  return (
    <div className="flex flex-1 flex-col">
      <header className="rise pb-5 pt-2">
        <span className="rounded-full border border-cool/30 bg-cool/[0.06] px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.14em] text-cool">
          On-chain proof
        </span>
        <h1 className="serif mt-3 text-[32px]">You can&apos;t read it</h1>
        <p className="mt-2 text-[14px] leading-snug text-text-dim">
          This is a real {amount} send. The money goes in one public door and
          out another — but the middle, where the amount and the
          sender→recipient link live, is invisible on-chain.
        </p>
      </header>

      {!privacy.enabled ? (
        <div className="rounded-2xl border border-danger/30 bg-danger/10 p-4 text-[13px] text-text-dim">
          The privacy path was skipped for this send
          {receipt.privacy.skippedReason
            ? ` (${receipt.privacy.skippedReason})`
            : ""}{" "}
          — it settled directly, so there&apos;s no shielded middle to show. Send
          again with privacy on to see the proof.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* IN — public deposit edge */}
          <EdgeCard
            tone="public"
            kicker="① Deposit — public"
            title="Money goes in"
            body="A visible deposit into the shielded pool. An observer sees a deposit happened — and that's the last thing they can read."
            txHash={depositLeg?.txHash}
            explorerUrl={depositLeg?.explorerUrl}
            simulated={depositLeg?.simulated}
          />

          {/* MIDDLE — the private leg */}
          <PrivateMiddle proofRef={transferLeg?.proofRef} />

          {/* OUT — public withdraw edge */}
          <EdgeCard
            tone="public"
            kicker="③ Withdraw — public"
            title="Money comes out"
            body={
              claim
                ? "A visible withdraw to the recipient's account. The shielded source it came from is not linkable to the deposit."
                : "When the recipient claims, a visible withdraw lands in their account — but it can't be tied back to the deposit. (Claim this slip to populate the out edge.)"
            }
            txHash={claim?.unshield?.txHash ?? claim?.withdrawTxHash}
            explorerUrl={
              claim?.unshield?.explorerUrl ?? claim?.withdrawExplorerUrl
            }
            simulated={claim?.unshield?.simulated ?? claim?.withdrawSimulated}
            pending={!claim}
          />
        </div>
      )}

      {/* The builder line */}
      <p className="serif mt-6 text-center text-[20px] italic text-text">
        “Even the builder can&apos;t read this.”
      </p>

      {/* Comparison */}
      <Comparison amount={amount} />

      {anySimulated && (
        <p className="mt-4 text-[11px] leading-snug text-text-faint">
          Demo mode: the tx hashes above are deterministic simulations, so they
          will 404 on the real ArcScan explorer. With real credentials these are
          live Arc testnet transactions — the privacy guarantee is identical
          either way.
        </p>
      )}
    </div>
  );
}

function EdgeCard({
  tone,
  kicker,
  title,
  body,
  txHash,
  explorerUrl,
  simulated,
  pending,
}: {
  tone: "public";
  kicker: string;
  title: string;
  body: string;
  txHash?: string;
  explorerUrl?: string;
  simulated?: boolean;
  pending?: boolean;
}) {
  void tone;
  return (
    <div className="card rise p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-text-faint">
          {kicker}
        </span>
        <span className="rounded-full border border-[var(--hair-strong)] bg-ink-800 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.1em] text-text-dim">
          readable
        </span>
      </div>
      <h3 className="display mt-1.5 text-[16px] font-semibold text-text">
        {title}
      </h3>
      <p className="mt-1 text-[12.5px] leading-snug text-text-dim">{body}</p>

      {txHash ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-[var(--hair)] bg-ink-900 px-3 py-2">
          <span className="hash truncate text-text-dim">
            {shortAddress(txHash)}
          </span>
          {explorerUrl ? (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-[11px] font-semibold text-volt underline-offset-2 hover:underline"
            >
              explorer ↗
              {simulated ? " (sim)" : ""}
            </a>
          ) : (
            <span className="shrink-0 text-[11px] text-text-faint">
              {simulated ? "simulated" : ""}
            </span>
          )}
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-text-faint">
          {pending ? "Not claimed yet — no out edge on-chain." : "No tx."}
        </p>
      )}
    </div>
  );
}

function PrivateMiddle({ proofRef }: { proofRef?: string }) {
  const CANNOT_SEE = [
    "the amount",
    "who sent it",
    "who received it",
    "the sender → recipient edge",
    "which token moved",
  ];
  return (
    <div className="card-shielded shield-scan rise relative overflow-hidden p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#16130a]/60">
          ② Private transfer — shielded
        </span>
        <span className="stamp text-[#b3382a]">Unreadable</span>
      </div>

      <h3 className="serif mt-3 text-[24px] leading-tight text-[#16130a]">
        Nothing readable here.
      </h3>
      <p className="mt-1.5 text-[12.5px] leading-snug text-[#16130a]/70">
        On-chain, this leg is a zero-knowledge proof submission. There&apos;s no
        ordinary transaction to open — only opaque proof bytes:
      </p>

      <div className="hash mt-3 rounded-lg border border-[#16130a]/15 bg-[#16130a]/[0.05] px-3 py-2 leading-relaxed text-[#16130a]/55">
        {proofRef ?? "proof unavailable"}
      </div>

      <p className="mt-4 text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#16130a]/60">
        What an observer can NOT see
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {CANNOT_SEE.map((item, i) => (
          <li
            key={item}
            className="flex items-center justify-between gap-3 text-[12.5px] text-[#16130a]/85"
          >
            {item}
            <span
              aria-hidden
              className="redact-bar"
              style={{ width: `${30 + ((i * 17) % 36)}%` }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Comparison({ amount }: { amount: string }) {
  return (
    <div className="mt-5 grid grid-cols-2 gap-2">
      <div className="card p-3.5">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-text-faint">
          A normal transfer shows
        </p>
        <ul className="hash mt-2 flex flex-col gap-1 text-[11.5px] text-text-dim">
          <li>from: 0xSender…</li>
          <li>to: 0xRecipient…</li>
          <li className="font-semibold text-danger">{amount}</li>
        </ul>
      </div>
      <div className="card-shielded p-3.5">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#16130a]/60">
          Slip shows
        </p>
        <ul className="hash mt-2 flex flex-col gap-1 text-[11.5px] text-[#16130a]/80">
          <li>
            from: <span aria-hidden className="redact-bar w-[55%]" />
          </li>
          <li>
            to: <span aria-hidden className="redact-bar w-[60%]" />
          </li>
          <li>
            amount: <span aria-hidden className="redact-bar w-[40%]" />
          </li>
        </ul>
      </div>
    </div>
  );
}
