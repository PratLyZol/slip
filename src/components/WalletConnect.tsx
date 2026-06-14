"use client";

/**
 * Real wallet-connect control for the top bar.
 *
 * It talks to Dynamic DIRECTLY so the header offers a genuine connect flow.
 * Dynamic is mounted whenever NEXT_PUBLIC_DYNAMIC_ENV_ID is present (see
 * Providers); when it isn't, we render a disabled fallback instead of calling
 * Dynamic hooks.
 *
 * The balance shown in the pill is the CROSS-CHAIN USDC total (Σ over every
 * chain), read from the SAME `wallet.balances` state HomeScreen's hero uses — so
 * the pill number is byte-for-byte identical to the home headline (single source
 * of truth; no second fetch here).
 */

import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import {
  useDynamicContext,
  useIsLoggedIn,
  useUserWallets,
} from "@dynamic-labs/sdk-react-core";
import { DYNAMIC_ENV_ID } from "@/lib/config";
import { useWallet } from "./WalletProvider";
import { formatAmount, shortAddress } from "@/lib/format";

export default function WalletConnect() {
  // Hooks can't be conditional and Dynamic hooks require the provider, so pick
  // the implementation at the component boundary (mirrors WalletProvider).
  if (!DYNAMIC_ENV_ID) return <ConnectFallback />;
  return <DynamicConnect />;
}

function ConnectFallback() {
  return (
    <button
      type="button"
      disabled
      title="Set NEXT_PUBLIC_DYNAMIC_ENV_ID to enable wallet connect"
      className="cursor-not-allowed rounded-full bg-ink-700 px-4 py-1.5 text-[13px] font-semibold text-text-faint"
    >
      Connect Wallet
    </button>
  );
}

function DynamicConnect() {
  const { setShowAuthFlow, handleLogOut } = useDynamicContext();
  const isLoggedIn = useIsLoggedIn();
  const wallets = useUserWallets();
  const address = wallets[0]?.address as Address | undefined;
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Σ USDC across every chain — derived from the SAME `wallet.balances` state the
  // home hero reads, so the pill total matches it exactly. null entries (a chain
  // still loading / read failed) count as 0; `anyLoaded` gates the "not loaded
  // yet" UI (was the old `balanceUsdc === null` condition).
  const totalUsdc = wallet.balances.reduce((sum, b) => sum + (b.usdc ?? 0), 0);
  const anyLoaded = wallet.balances.some((b) => b.usdc !== null);

  // Close the details popover on outside-click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — the address stays selectable in the popover.
    }
  }

  if (!isLoggedIn || !address) {
    return (
      <button
        type="button"
        onClick={() => setShowAuthFlow(true)}
        className="focus-volt rounded-full bg-volt px-4 py-1.5 text-[13px] font-semibold text-ink-950 transition-opacity hover:opacity-90"
      >
        Connect Wallet
      </button>
    );
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Wallet details"
        className="focus-volt flex items-center gap-2.5 rounded-full border border-[var(--hair)] bg-ink-850 py-1.5 pl-2.5 pr-3 transition-opacity hover:opacity-90"
      >
        <span className="grid h-6 w-6 place-items-center rounded-full bg-ink-700 text-[10px] font-semibold text-volt">
          {address.slice(2, 4).toUpperCase()}
        </span>
        <div className="flex flex-col items-start leading-tight">
          <span className="text-[11px] font-medium text-text">
            {!anyLoaded
              ? shortAddress(address)
              : `$${formatAmount(totalUsdc)}`}
          </span>
          <span className="text-[9px] uppercase tracking-wide text-text-faint">
            {!anyLoaded ? "connected" : shortAddress(address)}
          </span>
        </div>
      </button>

      {open && (
        <div className="card card-pop absolute right-0 top-full z-30 mt-2 w-[min(20rem,calc(100vw-2.5rem))] rounded-2xl p-3.5">
          <p className="kicker mb-1.5">Wallet address</p>
          <p className="select-all break-all font-mono text-[12.5px] leading-relaxed text-text">
            {address}
          </p>
          {anyLoaded && (
            <p className="mt-2 text-[11px] text-text-faint">
              Balance ${formatAmount(totalUsdc)} USDC
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={copyAddress}
              className="focus-volt flex-1 rounded-xl bg-volt px-3 py-2 text-[12px] font-semibold text-ink-950 transition-opacity hover:opacity-90"
            >
              {copied ? "Copied ✓" : "Copy address"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                handleLogOut();
              }}
              className="focus-volt rounded-xl border border-[var(--hair)] bg-ink-850 px-3 py-2 text-[12px] font-semibold text-text-dim transition-opacity hover:opacity-90"
            >
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
