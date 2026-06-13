"use client";

/**
 * The home screen IS the send screen. Recipient name + big USD amount + Send.
 * On send we run the engine, stream step states into <EngineSteps>, then show
 * the success card with the claim link + QR.
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import { runSend } from "@/lib/engine";
import {
  EngineStep,
  type EngineResult,
  type Region,
  type StepState,
} from "@/lib/engine/types";
import { useWallet } from "./WalletProvider";
import EngineSteps from "./EngineSteps";
import SuccessCard from "./SuccessCard";
import { formatAmount } from "@/lib/format";
import {
  sentReceiptFromResult,
  saveSentReceipt,
} from "@/lib/engine/sentStore";

type Phase = "idle" | "running" | "done";

export default function SendScreen() {
  const wallet = useWallet();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [region, setRegion] = useState<Region>("US");

  const [phase, setPhase] = useState<Phase>("idle");
  const [states, setStates] = useState<Partial<Record<EngineStep, StepState>>>(
    {},
  );
  const [result, setResult] = useState<EngineResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const amountNum = Number(amount);
  const canSend =
    phase === "idle" &&
    Boolean(wallet.address) &&
    recipient.trim().length > 0 &&
    amountNum > 0 &&
    Number.isFinite(amountNum);

  const onStep = useCallback((s: StepState) => {
    setStates((prev) => ({ ...prev, [s.step]: s }));
  }, []);

  async function handleSend() {
    if (!canSend) return;
    setError(null);
    setStates({});
    setPhase("running");
    try {
      const res = await runSend(
        {
          recipients: [
            { identifier: recipient.trim(), amountUsd: amountNum, region },
          ],
          senderName: wallet.name,
          senderAddress: wallet.address,
        },
        onStep,
      );
      // Persist the send-side privacy artifacts for the /private proof view.
      saveSentReceipt(res.secret, sentReceiptFromResult(res));
      setResult(res);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setPhase("idle");
    }
  }

  function reset() {
    setPhase("idle");
    setStates({});
    setResult(null);
    setError(null);
    setRecipient("");
    setAmount("");
  }

  if (phase === "done" && result) {
    return (
      <SuccessCard
        result={result}
        recipient={recipient.trim()}
        onSendAnother={reset}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* Amount — the hero, lit from behind. */}
      <div className="rise relative mt-2 flex flex-col items-center pt-7">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 h-44 w-72 -translate-x-1/2 rounded-full bg-volt/[0.06] blur-3xl"
        />
        <label className="kicker">You send</label>
        <div className="mt-4 flex items-baseline gap-1">
          <span className="amount-figure text-[38px] text-text-faint">$</span>
          <input
            inputMode="decimal"
            placeholder="0"
            value={amount}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9.]/g, "");
              if ((v.match(/\./g)?.length ?? 0) <= 1) setAmount(v);
            }}
            disabled={phase === "running"}
            className="amount-figure w-[clamp(2ch,60vw,7ch)] bg-transparent text-center text-[68px] font-medium leading-none text-text caret-[var(--volt)] outline-none placeholder:text-ink-600 disabled:opacity-60"
            aria-label="Amount in USD"
          />
        </div>
        <p className="amount-figure mt-3 text-[12px] text-text-faint">
          {wallet.balanceUsdc !== null
            ? `Balance $${formatAmount(wallet.balanceUsdc)} USDC`
            : "Loading balance…"}
        </p>
      </div>

      {/* Recipient */}
      <div className="rise mt-9">
        <label htmlFor="recipient" className="kicker">
          To
        </label>
        <input
          id="recipient"
          placeholder="name, username, or alice.eth"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          disabled={phase === "running"}
          autoComplete="off"
          className="focus-volt mt-2.5 w-full rounded-2xl border border-[var(--hair)] bg-ink-850 px-4 py-3.5 text-[16px] text-text outline-none transition-colors placeholder:text-text-faint focus:border-[var(--hair-strong)] disabled:opacity-60"
        />
      </div>

      {/* Where the recipient is — drives FX into their local money at claim. */}
      <div className="rise mt-5">
        <span className="kicker">Where are they?</span>
        <div className="mt-2.5 flex gap-1 rounded-2xl border border-[var(--hair)] bg-ink-900 p-1">
          {(["US", "EU"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRegion(r)}
              disabled={phase === "running"}
              aria-pressed={region === r}
              className={`flex-1 rounded-xl px-3 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-60 ${
                region === r
                  ? "bg-ink-700 text-text shadow-[0_1px_0_#f5efe01f_inset]"
                  : "text-text-faint hover:text-text-dim"
              }`}
            >
              {r === "US" ? "🇺🇸 United States" : "🇪🇺 Europe"}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-text-faint">
          They&apos;ll get their money in{" "}
          <span className="font-semibold text-text-dim">
            {region === "EU" ? "euros (EURC)" : "dollars (USDC)"}
          </span>
          .
        </p>
      </div>

      {error && (
        <p className="animate-slip-rise mt-4 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-[13px] text-danger">
          {error}
        </p>
      )}

      {/* Live engine progress */}
      {phase === "running" && (
        <div className="card card-pop animate-slip-rise mt-7 p-5">
          <p className="kicker mb-4">Sending</p>
          <EngineSteps states={states} />
        </div>
      )}

      <div className="flex-1" />

      {/* Send button */}
      <button
        onClick={handleSend}
        disabled={!canSend}
        className="btn-volt focus-volt rise mt-6 w-full rounded-2xl py-4 text-[16px] font-bold disabled:cursor-not-allowed disabled:opacity-30"
      >
        {phase === "running" ? "Sending…" : "Send"}
      </button>

      {/* Multi-recipient is the same recipients[] path — Batch is its surface. */}
      {phase !== "running" && (
        <Link
          href="/batch"
          className="focus-volt rise mt-3.5 text-center text-[12.5px] font-medium text-text-faint transition-colors hover:text-text-dim"
        >
          Paying several people?{" "}
          <span className="text-text-dim">Send a batch →</span>
        </Link>
      )}
    </div>
  );
}
