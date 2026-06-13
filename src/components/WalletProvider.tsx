"use client";

/**
 * WalletProvider exposes a unified {@link WalletState} via context so the UI
 * never branches on demo vs real itself.
 *
 * - Demo mode: a static demo identity + fixed balance (no Dynamic hooks).
 * - Real mode: an inner component that reads Dynamic hooks (only valid inside
 *   <Providers> which mounts DynamicContextProvider) and live USDC balance.
 *
 * Because React hooks can't be called conditionally, we select the
 * implementation at the component boundary, not mid-render.
 */

import { createContext, useContext, useEffect, useState } from "react";
import type { Address } from "viem";
import {
  useDynamicContext,
  useIsLoggedIn,
  useUserWallets,
} from "@dynamic-labs/sdk-react-core";
import { DEMO_SENDER, DEMO_USDC_BALANCE, isDemoMode } from "@/lib/config";
import { getUsdcBalance } from "@/lib/adapters/balance";
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
  if (isDemoMode()) {
    return <DemoWalletProvider>{children}</DemoWalletProvider>;
  }
  return <RealWalletProvider>{children}</RealWalletProvider>;
}

function DemoWalletProvider({ children }: { children: React.ReactNode }) {
  const value: WalletState = {
    demo: true,
    loggedIn: true,
    name: DEMO_SENDER.name,
    address: DEMO_SENDER.address,
    balanceUsdc: DEMO_USDC_BALANCE,
    login: () => {},
    logout: () => {},
  };
  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

function RealWalletProvider({ children }: { children: React.ReactNode }) {
  const { user, setShowAuthFlow, handleLogOut } = useDynamicContext();
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
    demo: false,
    loggedIn: Boolean(isLoggedIn),
    name: user?.email ?? user?.username ?? "Sender",
    address,
    balanceUsdc,
    login: () => setShowAuthFlow(true),
    logout: () => handleLogOut(),
  };

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}
