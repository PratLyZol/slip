"use client";

/**
 * OTP login gate — the recipient confirms it's THEM before the money is released
 * (spec F3, folds in A3), backed by REAL Dynamic email OTP.
 *
 * Flow: ask for the email FIRST ("what's your email?") → Dynamic sends a real
 * 6-digit code (useConnectWithOtp().connectWithEmail) → enter the code →
 * verifyOneTimePassword logs the user into their Dynamic embedded wallet → we
 * hand the logged-in wallet address back up so ClaimScreen can enforce that it
 * matches the intended recipient.
 *
 * VERIFIED SDK surface (node_modules/@dynamic-labs/sdk-react-core@4.88.5):
 *   - useConnectWithOtp() -> IConnectWithOtpContext with:
 *       connectWithEmail(email: string, options?) => Promise<void>      // sends code
 *       verifyOneTimePassword(code: string, options?) => Promise<VerifyResponse|void>
 *     (src/lib/context/ConnectWithOtpContext/types.d.ts lines 23–30)
 *   - useUserWallets() (exported as useUserWalletsExternal) => Wallet[]; each
 *     Wallet has `address: string` (wallet-connector-core Wallet.d.ts line 18).
 *   Both hooks use createProviderHook → they THROW outside <DynamicContextProvider>.
 *   Providers.tsx only mounts the provider when NEXT_PUBLIC_DYNAMIC_ENV_ID is set,
 *   so the hook-using component is ONLY rendered when DYNAMIC_ENV_ID is present.
 *
 * Money words only: the recipient is "confirming it's you to claim your money",
 * never "logging into a wallet". The verb is identity, not crypto.
 */

import { useEffect, useState } from "react";
import {
  useConnectWithOtp,
  useUserWallets,
} from "@dynamic-labs/sdk-react-core";
import { DYNAMIC_ENV_ID } from "@/lib/config";

const CODE_LENGTH = 6;

interface Props {
  /**
   * Verified — the recipient passed real OTP. `walletAddress` is the address of
   * the Dynamic embedded wallet they just logged into; ClaimScreen compares it
   * (case-insensitively) to payload.recipientAddress before running the claim.
   */
  onVerified: (walletAddress: string) => void;
}

export default function OtpLogin({ onVerified }: Props) {
  // Dynamic is only mounted when an env id is present (Providers.tsx). Without
  // it there's no backend to send/verify a real code — never fake-accept.
  if (!DYNAMIC_ENV_ID) {
    return <OtpUnavailable />;
  }
  return <OtpLoginDynamic onVerified={onVerified} />;
}

/** The real Dynamic email-OTP flow. Only rendered inside DynamicContextProvider. */
function OtpLoginDynamic({ onVerified }: Props) {
  const { connectWithEmail, verifyOneTimePassword } = useConnectWithOtp();
  const userWallets = useUserWallets();

  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [awaitingWallet, setAwaitingWallet] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // After OTP verify, the embedded wallet may take a beat to appear (Dynamic
  // creates it on first login). Reading userWallets synchronously inside verify()
  // is STALE — wait for it here and hand the address up once it lands.
  useEffect(() => {
    if (!awaitingWallet) return;
    const address = userWallets[0]?.address;
    if (address) {
      setAwaitingWallet(false);
      onVerified(address);
      return;
    }
    const timeout = setTimeout(() => {
      setAwaitingWallet(false);
      setVerifying(false);
      setError("We couldn't load your wallet. Please try the code again.");
    }, 15000);
    return () => clearTimeout(timeout);
  }, [awaitingWallet, userWallets, onVerified]);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const codeReady = code.length === CODE_LENGTH;

  function onCodeChange(raw: string) {
    setCode(raw.replace(/\D/g, "").slice(0, CODE_LENGTH));
    if (error) setError(null);
  }

  async function sendCode() {
    if (!emailValid || sending) return;
    setSending(true);
    setError(null);
    try {
      // Triggers a REAL Dynamic OTP email to the address.
      await connectWithEmail(email.trim());
      setStep("code");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Couldn't send the code. Check the email and try again.",
      );
    } finally {
      setSending(false);
    }
  }

  async function verify() {
    if (!codeReady || verifying) return;
    setVerifying(true);
    setError(null);
    try {
      // Verifies the code and logs the user into their Dynamic embedded wallet
      // (creating it on first login). The wallet appears asynchronously, so we
      // wait for it in the effect above rather than reading it here (stale).
      await verifyOneTimePassword(code);
      setAwaitingWallet(true);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "That code didn't match. Check it and try again.",
      );
      setVerifying(false);
    }
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

      {step === "email" ? (
        <>
          <p className="rise mt-3 max-w-[300px] text-[14px] text-text-dim">
            What&apos;s your email? We&apos;ll send a 6-digit code to make sure
            the money reaches you.
          </p>

          <div className="card rise mt-6 w-full p-5">
            <label htmlFor="otp-email" className="kicker mb-3 block text-left">
              Your email
            </label>
            <input
              id="otp-email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") sendCode();
              }}
              disabled={sending}
              inputMode="email"
              autoComplete="email"
              aria-label="Your email address"
              placeholder="you@example.com"
              className="focus-volt w-full rounded-xl border border-[var(--hair)] bg-ink-950/60 px-4 py-3 text-[16px] text-text placeholder:text-text-faint disabled:opacity-60"
            />

            {error && (
              <p className="mt-3 text-left text-[12px] text-danger">{error}</p>
            )}
          </div>

          <div className="flex-1" />

          <button
            onClick={sendCode}
            disabled={!emailValid || sending}
            className="btn-volt focus-volt rise mt-6 w-full rounded-2xl py-4 text-[16px] font-bold disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sending ? "Sending code…" : "Send me a code"}
          </button>
        </>
      ) : (
        <>
          <p className="rise mt-3 max-w-[300px] text-[14px] text-text-dim">
            We sent a 6-digit code to{" "}
            <span className="font-semibold text-text">{email.trim()}</span>.
            Enter it below to release the funds to you.
          </p>

          <div className="card rise mt-6 w-full p-5">
            <label htmlFor="otp-code" className="kicker mb-3 block text-left">
              Code from your email
            </label>
            <input
              id="otp-code"
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
              autoFocus
              className="focus-volt amount-figure w-full rounded-xl border border-[var(--hair)] bg-ink-950/60 px-4 py-3 text-center text-[28px] tracking-[0.5em] text-text placeholder:text-text-faint disabled:opacity-60"
            />

            {error && (
              <p className="mt-3 text-left text-[12px] text-danger">{error}</p>
            )}

            <button
              type="button"
              onClick={() => {
                setStep("email");
                setCode("");
                setError(null);
              }}
              disabled={verifying}
              className="mt-3 text-left text-[12px] text-cool underline-offset-2 hover:underline disabled:no-underline"
            >
              Use a different email
            </button>
          </div>

          <div className="flex-1" />

          <button
            onClick={verify}
            disabled={!codeReady || verifying}
            className="btn-volt focus-volt rise mt-6 w-full rounded-2xl py-4 text-[16px] font-bold disabled:cursor-not-allowed disabled:opacity-60"
          >
            {verifying ? "Verifying…" : "Confirm and claim"}
          </button>
        </>
      )}

      <p className="mt-3 text-[12px] leading-snug text-text-faint">
        This is just to make sure the money reaches you — no password.
      </p>
    </div>
  );
}

/**
 * Honest fallback when Dynamic isn't configured (no NEXT_PUBLIC_DYNAMIC_ENV_ID).
 * There's no real OTP backend, so we DO NOT proceed — never fake-accept a code.
 */
function OtpUnavailable() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <span className="grid h-14 w-14 place-items-center rounded-full border border-danger/40 bg-danger/10 text-danger">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 8v5m0 3h.01"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <h1 className="serif mt-4 text-[24px]">Sign-in unavailable</h1>
      <p className="mt-2 max-w-[280px] text-[14px] text-text-dim">
        We can&apos;t confirm it&apos;s you right now — email sign-in isn&apos;t
        configured. Please try again later.
      </p>
    </div>
  );
}
