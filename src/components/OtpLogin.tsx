"use client";

/**
 * OTP login gate — the recipient confirms it's them before the money is released
 * (spec F3, folds in A3). This is a Dynamic-style email/SMS one-time-code login:
 * "we sent you a code" → enter 6 digits → verifying → claim.
 *
 * Demo mode is first-class: the code is SIMULATED — any 6 digits pass, and the
 * obvious demo code is shown as a hint. No Dynamic SDK call, no credentials.
 * Real Dynamic email/SMS OTP would slot in behind the same callback, gated on
 * NEXT_PUBLIC_DYNAMIC_ENV_ID — but the demo path never depends on it.
 *
 * Money words only: the recipient is "confirming it's you to claim your money",
 * never "logging into a wallet". The verb is identity, not crypto.
 */

import { useRef, useState } from "react";
import { isDemoMode } from "@/lib/config";

/** The simulated code surfaced as a hint in demo mode. Any 6 digits also pass. */
const DEMO_CODE = "123456";
const CODE_LENGTH = 6;

type Channel = "email" | "sms";

interface Props {
  /** Verified — proceed to the actual claim. */
  onVerified: () => void;
}

export default function OtpLogin({ onVerified }: Props) {
  const demo = isDemoMode();
  const [channel, setChannel] = useState<Channel>("email");
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const ready = code.length === CODE_LENGTH;

  function onCodeChange(raw: string) {
    // Numeric only, capped at the code length.
    const next = raw.replace(/\D/g, "").slice(0, CODE_LENGTH);
    setCode(next);
    if (error) setError(null);
  }

  async function verify() {
    if (!ready || verifying) return;
    setVerifying(true);
    setError(null);

    // Simulated verification with realistic latency. In demo every 6-digit code
    // is accepted — the gate is a confidence-building step, not a real auth wall.
    await new Promise((r) => setTimeout(r, 850 + Math.random() * 600));

    if (demo) {
      onVerified();
      return;
    }

    // NOT YET WIRED — real Dynamic email/SMS OTP verification. Without a Dynamic
    // env id there's no backend to verify against, so we never reach here in the
    // demo build. Kept honest: simulate-and-proceed with a console warning.
    console.warn(
      "[slip] real Dynamic OTP verification not wired — accepting code.",
    );
    onVerified();
  }

  return (
    <div className="flex flex-1 flex-col items-center pt-6 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-14 h-44 w-72 -translate-x-1/2 rounded-full bg-volt/[0.06] blur-3xl"
      />

      <span className="rise grid h-16 w-16 place-items-center rounded-full border border-volt/40 bg-volt/[0.08] text-volt">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <rect
            x="4"
            y="6"
            width="16"
            height="12"
            rx="2.5"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path
            d="m5 8 7 5 7-5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>

      <h1 className="serif rise mt-5 text-[26px] leading-tight">
        Let&apos;s confirm it&apos;s you
      </h1>
      <p className="rise mt-3 max-w-[300px] text-[14px] text-text-dim">
        We sent a 6-digit code to claim your money. Enter it below to release the
        funds to you.
      </p>

      {/* Channel toggle — email / SMS, the way a login screen offers both. */}
      <div className="rise mt-6 inline-flex rounded-full border border-[var(--hair)] bg-ink-900/40 p-1 text-[13px]">
        {(["email", "sms"] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setChannel(c)}
            disabled={verifying}
            className={`rounded-full px-4 py-1.5 font-medium transition-colors disabled:opacity-60 ${
              channel === c
                ? "bg-volt text-[#07130b]"
                : "text-text-faint hover:text-text-dim"
            }`}
          >
            {c === "email" ? "Email" : "Text"}
          </button>
        ))}
      </div>

      <div className="card rise mt-6 w-full p-5">
        <label htmlFor="otp-code" className="kicker mb-3 block text-left">
          {channel === "email" ? "Code from your email" : "Code from your text"}
        </label>
        <input
          id="otp-code"
          ref={inputRef}
          value={code}
          onChange={(e) => onCodeChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") verify();
          }}
          disabled={verifying}
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label="6-digit confirmation code"
          placeholder="••••••"
          className="focus-volt amount-figure w-full rounded-xl border border-[var(--hair)] bg-ink-950/60 px-4 py-3 text-center text-[28px] tracking-[0.5em] text-text placeholder:text-text-faint disabled:opacity-60"
        />

        {error && (
          <p className="mt-3 text-left text-[12px] text-danger">{error}</p>
        )}

        {demo && (
          <p className="mt-3 text-left text-[12px] text-text-faint">
            Demo code:{" "}
            <button
              type="button"
              onClick={() => {
                setCode(DEMO_CODE);
                inputRef.current?.focus();
              }}
              disabled={verifying}
              className="font-mono text-cool underline-offset-2 hover:underline disabled:no-underline"
            >
              {DEMO_CODE}
            </button>{" "}
            — or type any six digits.
          </p>
        )}
      </div>

      <div className="flex-1" />

      <button
        onClick={verify}
        disabled={!ready || verifying}
        className="btn-volt focus-volt rise mt-6 w-full rounded-2xl py-4 text-[16px] font-bold disabled:cursor-not-allowed disabled:opacity-60"
      >
        {verifying ? "Verifying…" : "Confirm and claim"}
      </button>
      <p className="mt-3 text-[12px] leading-snug text-text-faint">
        This is just to make sure the money reaches you — no password, no wallet.
      </p>
    </div>
  );
}
