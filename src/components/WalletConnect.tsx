"use client";

/**
 * Real wallet-connect control for the top bar (replaces the demo WalletPill).
 *
 * It talks to Dynamic DIRECTLY rather than the demo-aware WalletProvider, so the
 * header offers a genuine connect flow even while the rest of the app runs in
 * demo mode (engine adapters still branch on isDemoMode()). Dynamic is mounted
 * whenever NEXT_PUBLIC_DYNAMIC_ENV_ID is present (see Providers); when it isn't,
 * we render a disabled fallback instead of calling Dynamic hooks.
 */

import { useEffect, useState } from "react";
import type { Address } from "viem";
import {
  useDynamicContext,
  useIsLoggedIn,
  useUserWallets,
} from "@dynamic-labs/sdk-react-core";
import { DYNAMIC_ENV_ID } from "@/lib/config";
import { getUsdcBalance } from "@/lib/adapters/balance";
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
  const [balanceUsdc, setBalanceUsdc] = useState<number | null>(null);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    getUsdcBalance(address)
      .then((b) => {
        if (!cancelled) setBalanceUsdc(b);
      })
      .catch(() => {
        if (!cancelled) setBalanceUsdc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

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
    <button
      type="button"
      onClick={() => handleLogOut()}
      title={`${address} · click to disconnect`}
      className="focus-volt flex items-center gap-2.5 rounded-full border border-[var(--hair)] bg-ink-850 py-1.5 pl-2.5 pr-3 transition-opacity hover:opacity-90"
    >
      <span className="grid h-6 w-6 place-items-center rounded-full bg-ink-700 text-[10px] font-semibold text-volt">
        {address.slice(2, 4).toUpperCase()}
      </span>
      <div className="flex flex-col items-start leading-tight">
        <span className="text-[11px] font-medium text-text">
          {balanceUsdc === null
            ? shortAddress(address)
            : `$${formatAmount(balanceUsdc)}`}
        </span>
        <span className="text-[9px] uppercase tracking-wide text-text-faint">
          {balanceUsdc === null ? "connected" : shortAddress(address)}
        </span>
      </div>
    </button>
  );
}
