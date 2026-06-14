"use client";

/**
 * Send — TWO explicit, independently-retriable steps over the SPLIT engine.
 *
 *   Step ①  Bridge to Arc.  A button that calls {@link runBridge} for the Σ
 *           total: burn on the wallet's connected ORIGIN chain, mint onto Arc,
 *           ONCE. The origin-chain (CCTP-source) network guard lives HERE — the
 *           burn is signed on the origin chain. A failure here NEVER blocks
 *           step ②; it's retriable on its own.
 *
 *   Step ②  Distribute.  The recipients table (name / email-or-phone / amount
 *           rows) → {@link runDistribute}: shield Σ on Arc + private fan-out +
 *           one claim link per recipient, then email each emailable link.
 *           GATED on the wallet holding USDC on Arc (read from wallet.balances),
 *           NOT on step ① having run this session — distribute reads the Arc
 *           balance fresh and shields it.
 *
 * Recipients see money words, never chain words (AGENTS.md). The "Bridge to Arc"
 * label is sender-facing plumbing; recipients only ever see the claim link.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { runBridge, runDistribute, buildClaimUrl } from "@/lib/engine";
import { isEmail, isPhone } from "@/lib/engine/resolve";
import {
  cctpSourceByChainId,
  supportedOriginChainNames,
} from "@/lib/adapters/cctp-chains";
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
type BridgePhase = "idle" | "running" | "done" | "failed";

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

  // ── Step ① (bridge) state ──────────────────────────────────────────────────
  const [bridgePhase, setBridgePhase] = useState<BridgePhase>("idle");
  const [bridgeDetail, setBridgeDetail] = useState<string | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);

  // The wallet's connected ORIGIN chain — the chain the CCTP burn is signed on.
  // Read LIVE (the embedded connector binds the client to the active network)
  // and require a CCTP-supported source before bridging.
  const [netChainId, setNetChainId] = useState<number | undefined>(
    wallet.chainId,
  );
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    if (!wallet.address) {
      // Synchronous clear on disconnect — carried over verbatim from the
      // pre-split SendScreen; it's idempotent and React bails on a no-op.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNetChainId(undefined);
      return;
    }
    let cancelled = false;
    wallet
      .getNetwork()
      .then((id) => {
        if (!cancelled) setNetChainId(id);
      })
      .catch(() => {
        if (!cancelled) setNetChainId(undefined);
      });
    return () => {
      cancelled = true;
    };
    // Re-read whenever the wallet or its active chain changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.address, wallet.chainId]);

  const originSource = cctpSourceByChainId(netChainId);
  const onSupportedNetwork = Boolean(originSource);
  const wrongNetwork =
    Boolean(wallet.address) && netChainId !== undefined && !onSupportedNetwork;

  async function switchToBaseSepolia() {
    setSwitching(true);
    setBridgeError(null);
    try {
      await wallet.switchNetwork(84532);
      setNetChainId(84532);
    } catch (e) {
      setBridgeError(
        e instanceof Error ? e.message : "Couldn't switch network. Try again.",
      );
    } finally {
      setSwitching(false);
    }
  }

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

  const bridgeRunning = bridgePhase === "running";
  const distributeRunning = phase === "running";

  // ── Step ① — Bridge can run when on a supported origin chain with a wallet
  // connected, and there's a Σ total to bridge.
  const canBridge =
    Boolean(wallet.address) &&
    onSupportedNetwork &&
    total > 0 &&
    !bridgeRunning;

  // ── Step ② — Distribute is gated on having Arc funds + valid recipients.
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

  // After a bridge, the Arc mint lands with no chain switch, so the balances
  // effect never re-fires on its own. Re-read on a TIMER: call refreshBalances()
  // a few times (3s apart) to absorb CCTP mint / Arc-RPC read-after-write lag.
  // We deliberately DON'T read wallet.balances inside the loop (that closure is
  // stale) — each refresh updates the balances state, the render recomputes
  // hasArcFunds from the fresh state, and the step ② gate flips on its own the
  // moment the Arc mint shows. Running all iterations is harmless (a couple
  // extra reads); the UI is never disabled during the poll.
  function pollArcBalanceAfterBridge() {
    void (async () => {
      for (let i = 0; i < 4; i++) {
        await wallet.refreshBalances();
        await new Promise((r) => setTimeout(r, 3000));
      }
    })();
  }

  // ── Step ① — Bridge Σ onto Arc. Independently retriable; a failure here is
  // surfaced inline and NEVER blocks step ②.
  async function handleBridge() {
    if (!canBridge) return;
    setBridgeError(null);
    setBridgeDetail(null);
    setBridgePhase("running");
    try {
      const res = await runBridge(
        {
          amountUsd: total,
          senderAddress: wallet.address,
          originChainId: netChainId,
          getWalletClient: wallet.getWalletClient,
        },
        (s) => {
          // The bridge emits only the Aggregate step; surface its detail inline.
          if (s.step === EngineStep.Aggregate && s.detail) {
            setBridgeDetail(s.detail);
          }
        },
      );
      setBridgeDetail(
        `Bridged ${formatUsd(Number(res.amountUsdc))} onto Arc`,
      );
      setBridgePhase("done");
      // Force a balance re-read: the Arc mint lands WITHOUT a chain switch, so
      // the [address,chainId] balances effect never re-fires on its own and the
      // step ② gate (hasArcFunds) would stay false. Fire the timer poll (~3×, 3s
      // apart) — non-blocking; the gate un-gates reactively as balances refresh.
      pollArcBalanceAfterBridge();
    } catch (e) {
      setBridgeError(e instanceof Error ? e.message : "Bridge failed. Try again.");
      setBridgePhase("failed");
    }
  }

  // ── Step ② — Distribute over funds already on Arc.
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
    setBridgePhase("idle");
    setBridgeDetail(null);
    setBridgeError(null);
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
            : wallet.balanceUsdc !== null
              ? `Balance $${formatAmount(wallet.balanceUsdc)} USDC${
                  originSource ? ` on ${originSource.name}` : ""
                }`
              : "Connect a wallet to load balance"}
        </p>
      </div>

      {/* ── Step ① — Bridge to Arc ─────────────────────────────────────────── */}
      <section className="rise mt-8">
        <div className="flex items-center gap-2">
          <StepBadge n={1} done={bridgePhase === "done"} />
          <div className="flex flex-col">
            <span className="text-[14px] font-bold text-text">
              Move funds to Arc
            </span>
            <span className="text-[11px] text-text-faint">
              Bridge {total > 0 ? formatUsd(total) : "your USDC"} onto Arc once
            </span>
          </div>
        </div>

        {/* Wrong-network guard — bridging burns on the origin chain. */}
        {wrongNetwork ? (
          <div className="mt-3 rounded-2xl border border-danger/40 bg-danger/[0.06] p-4 text-left">
            <p className="text-[13px] font-semibold text-danger">
              Wrong network
            </p>
            <p className="mt-1 text-[12px] text-text-dim">
              Your wallet is on a chain we can&apos;t bridge from. Switch to a
              supported network ({supportedOriginChainNames()}).
            </p>
            <button
              type="button"
              onClick={switchToBaseSepolia}
              disabled={switching}
              className="focus-volt mt-3 w-full rounded-xl bg-volt px-3 py-2.5 text-[13px] font-bold text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {switching ? "Switching…" : "Switch to Base Sepolia"}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleBridge}
            disabled={!canBridge}
            className="focus-volt mt-3 w-full rounded-2xl border border-[var(--hair-strong)] bg-ink-850 py-3 text-[14px] font-bold text-text transition-colors hover:border-volt/50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {bridgeRunning
              ? "Bridging…"
              : bridgePhase === "done"
                ? "Bridge again"
                : !wallet.address
                  ? "Connect a wallet first"
                  : total <= 0
                    ? "Enter an amount below"
                    : `Bridge ${formatUsd(total)} to Arc`}
          </button>
        )}

        {bridgeDetail && (
          <p
            className={`mt-2 text-[12px] ${
              bridgePhase === "done" ? "text-volt" : "text-text-dim"
            }`}
          >
            {bridgeDetail}
          </p>
        )}
        {bridgeError && (
          <p className="mt-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
            {bridgeError}
          </p>
        )}
      </section>

      {/* ── Step ② — Distribute ────────────────────────────────────────────── */}
      <section className="rise mt-8">
        <div className="flex items-center gap-2">
          <StepBadge n={2} done={phase === "done"} />
          <div className="flex flex-col">
            <span className="text-[14px] font-bold text-text">
              Send to recipients
            </span>
            <span className="text-[11px] text-text-faint">
              {hasArcFunds
                ? "Shielded on Arc, then a private link per person"
                : "Needs USDC on Arc — run step 1 first"}
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
                  ? "Bridge to Arc first (step 1)"
                  : validRows.length <= 1
                    ? `Send ${total > 0 ? formatUsd(total) : ""}`.trim()
                    : `Send ${formatUsd(total)} to ${validRows.length} people`}
        </button>
      </section>
    </div>
  );
}

/** Numbered step badge — filled volt when that step has completed. */
function StepBadge({ n, done }: { n: number; done: boolean }) {
  return (
    <span
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-bold ${
        done
          ? "bg-volt text-ink-950"
          : "border border-[var(--hair-strong)] text-text-dim"
      }`}
    >
      {done ? "✓" : n}
    </span>
  );
}
