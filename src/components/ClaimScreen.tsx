"use client";

/**
 * Claim screen — the recipient's whole story, walletless + gasless.
 *
 * The secret lives in the URL fragment, which the server NEVER sees, so decode
 * happens client-side. Flow:
 *   ready    → big friendly amount + "Claim your money"
 *   claiming → live claim progress (ClaimSteps, streamed from runClaim)
 *   success  → "You received $X" + receipt + tx link
 *   claimed  → re-opening a claimed link shows the original receipt
 *
 * Zero credentials in demo mode: no wallet UI, no seed phrase, no gas prompt.
 */

import { useMemo, useState } from "react";
import { decodeClaimFragment } from "@/lib/engine/claimLink";
import { addressFromSecret } from "@/lib/engine/counterfactual";
import { runClaim } from "@/lib/engine/claim";
import {
  getClaimReceipt,
  receiptFromResult,
  saveClaimReceipt,
  type ClaimReceipt,
} from "@/lib/engine/claimedStore";
import {
  ClaimStep,
  type ClaimPayload,
  type ClaimStepState,
} from "@/lib/engine/types";
import { useHash } from "@/lib/useClientValue";
import { formatUsd, shortAddress } from "@/lib/format";
import ClaimSteps from "./ClaimSteps";

type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; payload: ClaimPayload }
  | { kind: "claiming"; payload: ClaimPayload }
  | { kind: "success"; payload: ClaimPayload; receipt: ClaimReceipt }
  | { kind: "claimed"; payload: ClaimPayload; receipt: ClaimReceipt };

/** Distinguishes the SSR snapshot from a genuinely empty client-side hash. */
const SSR_SENTINEL = " ssr";

export default function ClaimScreen() {
  const hash = useHash(SSR_SENTINEL);

  // Decode the fragment once. This drives the initial phase.
  const initial: Phase = useMemo(() => {
    if (hash === SSR_SENTINEL) return { kind: "loading" };
    if (hash === "" || hash === "#") {
      return { kind: "error", message: "This link has no claim data." };
    }
    const res = decodeClaimFragment(hash);
    if (!res.ok) return { kind: "error", message: res.error };
    // Re-opening an already-claimed link → show the original receipt.
    const prior = getClaimReceipt(res.payload.secret);
    if (prior) return { kind: "claimed", payload: res.payload, receipt: prior };
    return { kind: "ready", payload: res.payload };
  }, [hash]);

  const [override, setOverride] = useState<Phase | null>(null);
  const [steps, setSteps] = useState<Partial<Record<ClaimStep, ClaimStepState>>>(
    {},
  );

  const phase = override ?? initial;

  async function handleClaim(payload: ClaimPayload) {
    setSteps({});
    setOverride({ kind: "claiming", payload });
    try {
      const result = await runClaim(payload, (s) =>
        setSteps((prev) => ({ ...prev, [s.step]: s })),
      );
      const receipt = receiptFromResult(result);
      saveClaimReceipt(payload.secret, receipt);
      setOverride({ kind: "success", payload, receipt });
    } catch (e) {
      setOverride({
        kind: "error",
        message: e instanceof Error ? e.message : "Claim failed.",
      });
    }
  }

  if (phase.kind === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-10 w-10 animate-slip-pulse rounded-full border-2 border-volt border-t-transparent" />
      </div>
    );
  }

  if (phase.kind === "error") {
    return <ErrorState message={phase.message} />;
  }

  if (phase.kind === "success" || phase.kind === "claimed") {
    return (
      <SuccessState
        payload={phase.payload}
        receipt={phase.receipt}
        alreadyClaimed={phase.kind === "claimed"}
      />
    );
  }

  // ready | claiming
  const { payload } = phase;
  const amount = formatUsd(Number(payload.amountUsdc));
  const currency = payload.region === "EU" ? "EURC" : "USDC";
  const account = addressFromSecret(payload.secret);
  const claiming = phase.kind === "claiming";

  return (
    <div className="flex flex-1 flex-col items-center pt-6 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-14 h-44 w-72 -translate-x-1/2 rounded-full bg-volt/[0.06] blur-3xl"
      />
      <span className="serif rise text-[22px] italic text-text-dim">
        {payload.senderName
          ? `${payload.senderName} sent you`
          : "Someone sent you"}
      </span>
      <h1 className="amount-figure rise mt-4 text-[60px] font-medium leading-none">
        {amount}
      </h1>
      <p className="rise mt-4 text-[14px] text-text-dim">
        Arriving as <span className="font-semibold text-text">{currency}</span>{" "}
        — no wallet, no gas, no fees on you.
      </p>

      {claiming ? (
        <div className="card card-pop animate-slip-rise mt-8 w-full p-5 text-left">
          <p className="kicker mb-4">Claiming</p>
          <ClaimSteps states={steps} />
        </div>
      ) : (
        <div className="card rise mt-8 w-full p-4 text-left">
          <Row label="Amount" value={amount} />
          <Row label="Currency" value={currency} />
          <Row label="Claim account" value={shortAddress(account)} mono />
          <Row
            label="Created"
            value={new Date(payload.createdAt).toLocaleString()}
          />
        </div>
      )}

      <div className="flex-1" />

      <button
        onClick={() => handleClaim(payload)}
        disabled={claiming}
        className="btn-volt focus-volt rise mt-6 w-full rounded-2xl py-4 text-[16px] font-bold disabled:cursor-not-allowed disabled:opacity-60"
      >
        {claiming ? "Claiming…" : "Claim your money"}
      </button>
      {!claiming && (
        <p className="mt-3 text-[12px] leading-snug text-text-faint">
          One tap. We create your account, sponsor the gas, and convert to{" "}
          {currency} — all in a single step.
        </p>
      )}
    </div>
  );
}

function SuccessState({
  payload,
  receipt,
  alreadyClaimed,
}: {
  payload: ClaimPayload;
  receipt: ClaimReceipt;
  alreadyClaimed: boolean;
}) {
  const received =
    receipt.token === "USDC"
      ? formatUsd(Number(receipt.amount))
      : `${Number(receipt.amount).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} ${receipt.token}`;

  return (
    <div className="flex flex-1 flex-col items-center pt-6 text-center">
      <span className="rise grid h-16 w-16 place-items-center rounded-full bg-volt text-[#07130b] shadow-[0_10px_28px_-10px_var(--volt)]">
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

      <h1 className="serif rise mt-5 text-[30px]">
        {alreadyClaimed ? "Already claimed" : "You received"}
      </h1>
      <p className="amount-figure rise mt-2 text-[44px] font-medium leading-none">
        {received}
      </p>
      {alreadyClaimed && (
        <p className="rise mt-3 text-[13px] text-text-dim">
          This link was already claimed on this device. Here&apos;s the receipt.
        </p>
      )}

      <div className="card card-pop rise mt-8 w-full p-4 text-left">
        <Row label="Received" value={received} />
        {payload.senderName && <Row label="From" value={payload.senderName} />}
        <Row
          label="Your account"
          value={shortAddress(receipt.recipientAddress)}
          mono
        />
        <Row
          label="Transaction"
          value={shortAddress(receipt.withdrawTxHash)}
          href={receipt.withdrawExplorerUrl}
          mono
        />
        <Row
          label="Claimed"
          value={new Date(receipt.claimedAt).toLocaleString()}
        />
      </div>

      <p className="mt-4 text-[12px] leading-snug text-text-faint">
        No wallet, no seed phrase, no gas — the money is yours.
      </p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
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
      <h1 className="serif mt-4 text-[24px]">Can&apos;t open this slip</h1>
      <p className="mt-2 max-w-[280px] text-[14px] text-text-dim">{message}</p>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  href,
}: {
  label: string;
  value: string;
  mono?: boolean;
  href?: string;
}) {
  const valueCls = `text-[13px] text-text ${mono ? "font-mono" : "font-medium"}`;
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-[13px] text-text-faint">{label}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={`${valueCls} text-cool underline-offset-2 hover:underline`}
        >
          {value}
        </a>
      ) : (
        <span className={valueCls}>{value}</span>
      )}
    </div>
  );
}
