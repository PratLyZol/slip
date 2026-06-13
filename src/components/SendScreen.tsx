"use client";

/**
 * The home screen IS the send screen. Recipient name + big USD amount + Send.
 * On send we run the engine, stream step states into <EngineSteps>, then show
 * the success card with the claim link + QR.
 */

import { useCallback, useState } from "react";
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
          recipient: recipient.trim(),
          amountUsd: amountNum,
          senderName: wallet.name,
          region,
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
      {/* Amount — the hero. */}
      <div className="mt-2 flex flex-col items-center pt-6">
        <label className="text-[12px] font-medium uppercase tracking-wide text-text-faint">
          You send
        </label>
        <div className="mt-3 flex items-baseline gap-1">
          <span className="amount-figure text-[40px] font-medium text-text-faint">
            $
          </span>
          <input
            inputMode="decimal"
            placeholder="0"
            value={amount}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9.]/g, "");
              if ((v.match(/\./g)?.length ?? 0) <= 1) setAmount(v);
            }}
            disabled={phase === "running"}
            className="amount-figure w-[clamp(2ch,60vw,7ch)] bg-transparent text-center text-[64px] font-semibold leading-none text-text outline-none placeholder:text-text-faint disabled:opacity-60"
            aria-label="Amount in USD"
          />
        </div>
        <p className="mt-2 text-[12px] text-text-faint">
          {wallet.balanceUsdc !== null
            ? `Balance $${formatAmount(wallet.balanceUsdc)} USDC`
            : "Loading balance…"}
        </p>
      </div>

      {/* Recipient */}
      <div className="mt-8">
        <label
          htmlFor="recipient"
          className="text-[12px] font-medium uppercase tracking-wide text-text-faint"
        >
          To
        </label>
        <input
          id="recipient"
          placeholder="name, username, or alice.eth"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          disabled={phase === "running"}
          autoComplete="off"
          className="focus-volt mt-2 w-full rounded-2xl border border-[var(--hair)] bg-ink-850 px-4 py-3.5 text-[16px] text-text outline-none placeholder:text-text-faint disabled:opacity-60"
        />
      </div>

      {/* Where the recipient is — drives FX into their local money at claim. */}
      <div className="mt-4">
        <span className="text-[12px] font-medium uppercase tracking-wide text-text-faint">
          Where are they?
        </span>
        <div className="mt-2 flex gap-2">
          {(["US", "EU"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRegion(r)}
              disabled={phase === "running"}
              className={`flex-1 rounded-xl border px-3 py-2.5 text-[13px] font-medium transition-colors disabled:opacity-60 ${
                region === r
                  ? "border-volt bg-volt/10 text-text"
                  : "border-[var(--hair)] bg-ink-850 text-text-dim hover:text-text"
              }`}
            >
              {r === "US" ? "🇺🇸 United States" : "🇪🇺 Europe"}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-text-faint">
          They&apos;ll get their money in {region === "EU" ? "euros (EURC)" : "dollars (USDC)"}.
        </p>
      </div>

      {error && (
        <p className="mt-4 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-[13px] text-danger">
          {error}
        </p>
      )}

      {/* Live engine progress */}
      {phase === "running" && (
        <div className="animate-slip-rise mt-7 rounded-2xl border border-[var(--hair)] bg-ink-900/60 p-5">
          <p className="mb-4 text-[12px] font-medium uppercase tracking-wide text-text-faint">
            Sending
          </p>
          <EngineSteps states={states} />
        </div>
      )}

      <div className="flex-1" />

      {/* Send button */}
      <button
        onClick={handleSend}
        disabled={!canSend}
        className="focus-volt mt-6 w-full rounded-2xl bg-volt py-4 text-[16px] font-semibold text-ink-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
      >
        {phase === "running" ? "Sending…" : "Send"}
      </button>
    </div>
  );
}
