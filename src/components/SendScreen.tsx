"use client";

/**
 * Send — the distribute leg only. The recipients table (name / email-or-phone /
 * amount rows) → {@link runDistribute}: shield Σ on Arc + private fan-out + one
 * claim link per recipient, then email each emailable link. GATED on the wallet
 * holding USDC on Arc (read from wallet.balances).
 *
 * Getting funds ONTO Arc (the CCTP bridge) lives on Home ({@link UnifyBalance}),
 * not here — this screen assumes the money is already on Arc and just fans it
 * out. When the Arc balance is empty we point the sender back to Home.
 *
 * Recipients see money words, never chain words (AGENTS.md); they only ever see
 * the claim link.
 */

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { runDistribute, buildClaimUrl } from "@/lib/engine";
import { isEmail, isPhone } from "@/lib/engine/resolve";
import { ARC_CHAIN_ID } from "@/lib/adapters/arc";
import {
  EngineStep,
  type EngineResult,
  type StepState,
} from "@/lib/engine/types";
import { useWallet } from "./WalletProvider";
import EngineSteps from "./EngineSteps";
import SuccessCard from "./SuccessCard";
import SendResults from "./SendResults";
import { formatAmount, formatUsd } from "@/lib/format";
import {
  sentReceiptFromResult,
  saveSentReceipt,
} from "@/lib/engine/sentStore";

type DistributePhase = "idle" | "running" | "done";

interface Row {
  id: string;
  /** Arbitrary label for the sender — not used by the money path. */
  name: string;
  /** Email or phone — the identifier the walletless claim is keyed off. */
  contact: string;
  /** Amount in USD for this recipient. */
  amount: string;
}

function rid(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `r${Date.now()}${Math.floor(Math.random() * 1e6)}`
  );
}
function emptyRow(): Row {
  return { id: rid(), name: "", contact: "", amount: "" };
}
function contactValid(contact: string): boolean {
  return isEmail(contact) || isPhone(contact);
}
function rowValid(r: Row): boolean {
  const amt = Number(r.amount);
  return contactValid(r.contact) && amt > 0 && Number.isFinite(amt);
}

export default function SendScreen() {
  const wallet = useWallet();
  const [rows, setRows] = useState<Row[]>([emptyRow()]);

  // ── Step ② (distribute) state ──────────────────────────────────────────────
  const [phase, setPhase] = useState<DistributePhase>("idle");
  const [states, setStates] = useState<Partial<Record<EngineStep, StepState>>>(
    {},
  );
  const [results, setResults] = useState<EngineResult[] | null>(null);
  const [sentRows, setSentRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  const validRows = useMemo(() => rows.filter(rowValid), [rows]);
  const total = useMemo(
    () => validRows.reduce((sum, r) => sum + Number(r.amount), 0),
    [validRows],
  );

  // Arc USDC the wallet currently holds — the gate for step ②. Distribute reads
  // this fresh and shields it; we DON'T gate on step ① having run this session.
  const arcBalance =
    wallet.balances.find((b) => b.chainId === ARC_CHAIN_ID)?.usdc ?? null;
  const hasArcFunds = arcBalance !== null && arcBalance > 0;

  const distributeRunning = phase === "running";

  // Distribute is gated on having Arc funds + valid recipients.
  // DEMO (carried from PR #19): no in-flight `phase === "idle"` guard, so the
  // Send button stays clickable and re-entrant sends are allowed during a demo.
  const canDistribute =
    Boolean(wallet.address) &&
    validRows.length > 0 &&
    hasArcFunds;

  const onStep = useCallback((s: StepState) => {
    setStates((prev) => ({ ...prev, [s.step]: s }));
  }, []);

  function update(id: string, field: "name" | "contact" | "amount", value: string) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }
  function addRow() {
    setRows((rs) => [...rs, emptyRow()]);
  }
  function removeRow(id: string) {
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs));
  }

  // Distribute over funds already on Arc.
  async function handleDistribute() {
    if (!canDistribute) return;
    setError(null);
    setStates({});
    setPhase("running");
    try {
      const res = await runDistribute(
        {
          // No region here — the recipient's local currency is detected when
          // THEY open the claim link (lib/region.ts), not picked by the sender.
          recipients: validRows.map((r) => ({
            identifier: r.contact.trim(),
            amountUsd: Number(r.amount),
          })),
          senderName: wallet.name,
          senderAddress: wallet.address,
          // No originChainId — distribute switches to Arc (5042002) internally.
          getWalletClient: wallet.getWalletClient,
        },
        onStep,
      );
      res.forEach((r) => saveSentReceipt(r.secret, sentReceiptFromResult(r)));
      setResults(res);
      setSentRows(validRows);
      setPhase("done");

      // Email each recipient (whose identifier is an email) their claim link.
      // Best-effort: a mail failure must not break the send — links still show.
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      res.forEach((r, i) => {
        const to = validRows[i]?.contact.trim();
        if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return; // email only
        void fetch("/api/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to,
            claimUrl: buildClaimUrl(r.claimPayload, origin),
            amountUsdc: r.claimPayload.amountUsdc,
            senderLabel: wallet.name,
          }),
        }).catch((err) =>
          console.warn(`[slip] claim-link email to ${to} failed:`, err),
        );
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setPhase("idle");
    }
  }

  function reset() {
    setPhase("idle");
    setStates({});
    setResults(null);
    setSentRows([]);
    setError(null);
    setRows([emptyRow()]);
  }

  // Terminal success view (after step ②).
  if (phase === "done" && results) {
    if (results.length === 1) {
      const label =
        sentRows[0]?.name?.trim() || sentRows[0]?.contact || "recipient";
      return (
        <SuccessCard
          result={results[0]}
          recipient={label}
          onSendAnother={reset}
        />
      );
    }
    return (
      <SendResults results={results} rows={sentRows} onSendAnother={reset} />
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* Total — the hero, lit from behind. */}
      <div className="rise relative mt-2 flex flex-col items-center pt-7">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 h-44 w-72 -translate-x-1/2 rounded-full bg-volt/[0.06] blur-3xl"
        />
        <label className="kicker">You send</label>
        <div className="mt-3 flex items-baseline gap-1">
          <span className="amount-figure text-[34px] text-text-faint">$</span>
          <span className="amount-figure text-[60px] font-medium leading-none text-text">
            {total > 0 ? formatAmount(total) : "0"}
          </span>
        </div>
        <p className="amount-figure mt-3 text-[12px] text-text-faint">
          {arcBalance !== null
            ? `On Arc $${formatAmount(arcBalance)} USDC ready`
            : wallet.address
              ? "Loading your Arc balance…"
              : "Connect a wallet to load balance"}
        </p>
      </div>

      {/* No funds on Arc → send the user to Home to bridge (the bridge lives
          there now, in UnifyBalance). */}
      {wallet.address && !hasArcFunds && (
        <Link
          href="/"
          className="rise card focus-volt mt-7 flex items-center justify-between gap-3 rounded-2xl p-4 transition-colors hover:border-[var(--hair-strong)]"
        >
          <div className="flex flex-col">
            <span className="text-[14px] font-bold text-text">
              No funds on Arc yet
            </span>
            <span className="text-[11px] text-text-faint">
              Move USDC to Arc from Home, then send.
            </span>
          </div>
          <span className="shrink-0 rounded-xl bg-volt px-3 py-2 text-[12px] font-bold text-ink-950">
            Add funds
          </span>
        </Link>
      )}

      {/* ── Send to recipients ─────────────────────────────────────────────── */}
      <section className="rise mt-8">
        <div className="flex items-center gap-2">
          <div className="flex flex-col">
            <span className="text-[14px] font-bold text-text">
              Send to recipients
            </span>
            <span className="text-[11px] text-text-faint">
              {hasArcFunds
                ? "Shielded on Arc, then a private link per person"
                : "Add funds to Arc from Home first"}
            </span>
          </div>
        </div>

        {/* Recipients table — add rows like adding secrets. */}
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <span className="kicker">Recipients</span>
            <span className="text-[11px] text-text-faint">
              {validRows.length} ready
            </span>
          </div>

          <ul className="mt-2.5 flex flex-col gap-2">
            {rows.map((r, i) => {
              const showError =
                r.contact.trim().length > 0 && !contactValid(r.contact);
              return (
                <li key={r.id} className="card p-3">
                  <div className="flex items-center gap-2">
                    <input
                      value={r.name}
                      onChange={(e) => update(r.id, "name", e.target.value)}
                      disabled={distributeRunning}
                      placeholder={`Recipient ${i + 1} — name`}
                      autoComplete="off"
                      className="focus-volt min-w-0 flex-1 rounded-lg border border-[var(--hair)] bg-ink-850 px-3 py-2 text-[14px] font-semibold text-text outline-none transition-colors placeholder:text-text-faint focus:border-[var(--hair-strong)] disabled:opacity-60"
                    />
                    <button
                      onClick={() => removeRow(r.id)}
                      disabled={distributeRunning || rows.length === 1}
                      aria-label="Remove recipient"
                      className="focus-volt grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[var(--hair)] text-text-faint transition-colors hover:text-danger disabled:opacity-30"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <path
                          d="M6 6l12 12M18 6 6 18"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  </div>

                  <div className="mt-2 flex gap-2">
                    <input
                      value={r.contact}
                      onChange={(e) => update(r.id, "contact", e.target.value)}
                      disabled={distributeRunning}
                      inputMode="email"
                      placeholder="phone or email"
                      autoComplete="off"
                      aria-invalid={showError}
                      className={`focus-volt min-w-0 flex-1 rounded-lg border bg-ink-850 px-3 py-2 text-[14px] text-text outline-none transition-colors placeholder:text-text-faint disabled:opacity-60 ${
                        showError
                          ? "border-danger"
                          : "border-[var(--hair)] focus:border-[var(--hair-strong)]"
                      }`}
                    />
                    <div className="flex w-[34%] items-center rounded-lg border border-[var(--hair)] bg-ink-850 px-2.5 focus-within:border-[var(--hair-strong)]">
                      <span className="amount-figure text-[13px] text-text-faint">
                        $
                      </span>
                      <input
                        value={r.amount}
                        onChange={(e) =>
                          update(
                            r.id,
                            "amount",
                            e.target.value.replace(/[^0-9.]/g, ""),
                          )
                        }
                        disabled={distributeRunning}
                        inputMode="decimal"
                        placeholder="0"
                        className="amount-figure min-w-0 flex-1 bg-transparent px-1 py-2 text-right text-[14px] text-text outline-none placeholder:text-text-faint disabled:opacity-60"
                      />
                    </div>
                  </div>

                  {showError && (
                    <p className="mt-1.5 text-[11px] text-danger">
                      Enter a phone number or email — that&apos;s how they claim.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          <button
            onClick={addRow}
            disabled={distributeRunning}
            className="focus-volt mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--hair-strong)] py-2.5 text-[13px] font-semibold text-text-dim transition-colors hover:text-text disabled:opacity-50"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            Add recipient
          </button>
        </div>

        {/* Currency is set to the recipient's local money when they claim. */}
        <p className="mt-4 text-center text-[11px] leading-snug text-text-faint">
          Each recipient gets their{" "}
          <span className="font-semibold text-text-dim">local currency</span> —
          converted automatically when they claim, based on where they are.
        </p>

        {error && (
          <p className="animate-slip-rise mt-4 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-[13px] text-danger">
            {error}
          </p>
        )}

        {/* Live distribute progress */}
        {distributeRunning && (
          <div className="card card-pop animate-slip-rise mt-7 p-5">
            <p className="kicker mb-4">Sending</p>
            <EngineSteps states={states} />
          </div>
        )}

        {/* Distribute button */}
        <button
          onClick={handleDistribute}
          disabled={!canDistribute}
          className="btn-volt focus-volt mt-6 w-full rounded-2xl py-4 text-[16px] font-bold disabled:cursor-not-allowed disabled:opacity-30"
        >
          {distributeRunning
            ? "Sending…"
            : !wallet.address
              ? "Connect a wallet to send"
              : validRows.length === 0
                ? "Add a recipient to send"
                : !hasArcFunds
                  ? "Add funds to Arc first"
                  : validRows.length <= 1
                    ? `Send ${total > 0 ? formatUsd(total) : ""}`.trim()
                    : `Send ${formatUsd(total)} to ${validRows.length} people`}
        </button>
      </section>
    </div>
  );
}
