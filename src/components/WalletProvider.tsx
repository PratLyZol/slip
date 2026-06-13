"use client";

/**
 * WalletProvider exposes a unified {@link WalletState} via context. Real-only:
 * the connected Dynamic wallet (no demo identity).
 *
 * Dynamic hooks are only valid inside <Providers> (mounted when
 * NEXT_PUBLIC_DYNAMIC_ENV_ID is present). When the env id is absent we render a
 * disconnected provider that calls NO Dynamic hooks — so the app never crashes,
 * it just has no wallet until you set the env id and connect.
 */

import { createContext, useContext, useEffect, useState } from "react";
import type { Address } from "viem";
import {
  useDynamicContext,
  useIsLoggedIn,
  useUserWallets,
} from "@dynamic-labs/sdk-react-core";
import { DYNAMIC_ENV_ID } from "@/lib/config";
import { getUsdcBalance } from "@/lib/adapters/balance";
import { shortAddress } from "@/lib/format";
import type { WalletState } from "@/lib/wallet/types";

const WalletContext = createContext<WalletState | null>(null);

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWallet must be used within <WalletProvider>");
  }
  return ctx;
}

export default function WalletProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // No Dynamic env id → no provider mounted → render a hook-free disconnected
  // state instead of crashing on Dynamic hooks.
  if (!DYNAMIC_ENV_ID) {
    return <DisconnectedWalletProvider>{children}</DisconnectedWalletProvider>;
  }
  return <DynamicWalletProvider>{children}</DynamicWalletProvider>;
}

function DisconnectedWalletProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const value: WalletState = {
    loggedIn: false,
    name: "",
    address: undefined,
    balanceUsdc: null,
    login: () => {},
    logout: () => {},
  };
  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

function DynamicWalletProvider({ children }: { children: React.ReactNode }) {
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

  const value: WalletState = {
    loggedIn: Boolean(isLoggedIn && address),
    name: address ? shortAddress(address) : "",
    address,
    balanceUsdc,
    login: () => setShowAuthFlow(true),
    logout: () => handleLogOut(),
  };

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}
