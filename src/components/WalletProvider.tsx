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

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Address, WalletClient } from "viem";
import {
  useDynamicContext,
  useIsLoggedIn,
  useUserWallets,
} from "@dynamic-labs/sdk-react-core";
import { isEthereumWallet } from "@dynamic-labs/ethereum";
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
    chainId: undefined,
    balanceUsdc: null,
    login: () => {},
    logout: () => {},
    getNetwork: async () => undefined,
    switchNetwork: async () => {},
    getWalletClient: async () => undefined,
  };
  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

function DynamicWalletProvider({ children }: { children: React.ReactNode }) {
  const { setShowAuthFlow, handleLogOut } = useDynamicContext();
  const isLoggedIn = useIsLoggedIn();
  const wallets = useUserWallets();
  const primaryWallet = wallets[0];
  const address = primaryWallet?.address as Address | undefined;
  const [balanceUsdc, setBalanceUsdc] = useState<number | null>(null);
  const [chainId, setChainId] = useState<number | undefined>(undefined);

  // Read the wallet's current network (no switch). Stable identity for callers.
  const getNetwork = useCallback(async (): Promise<number | undefined> => {
    if (!primaryWallet || !isEthereumWallet(primaryWallet)) return undefined;
    const net = await primaryWallet.getNetwork();
    return typeof net === "number" ? net : undefined;
  }, [primaryWallet]);

  const switchNetwork = useCallback(
    async (target: number): Promise<void> => {
      if (!primaryWallet || !isEthereumWallet(primaryWallet)) return;
      await primaryWallet.switchNetwork(target);
      setChainId(target);
    },
    [primaryWallet],
  );

  // Track the connected origin chain id.
  useEffect(() => {
    if (!address) {
      setChainId(undefined);
      return;
    }
    let cancelled = false;
    getNetwork()
      .then((id) => {
        if (!cancelled) setChainId(id);
      })
      .catch(() => {
        if (!cancelled) setChainId(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [address, getNetwork]);

  // Read USDC on the connected ORIGIN chain (re-reads when the chain switches).
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    getUsdcBalance(address, chainId)
      .then((b) => {
        if (!cancelled) setBalanceUsdc(b);
      })
      .catch(() => {
        if (!cancelled) setBalanceUsdc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [address, chainId]);

  /**
   * Obtain a viem WalletClient for the requested chain from the connected
   * Dynamic embedded wallet. Uses the `isEthereumWallet` type guard to confirm
   * the wallet exposes `getWalletClient` before calling it. Returns undefined
   * when no wallet is connected or the wallet is not an EVM wallet.
   *
   * IMPORTANT: the embedded (Turnkey) connector's `getWalletClient(chainId)`
   * IGNORES the chainId arg and binds the client to the wallet's currently
   * selected network (defaults to evmNetworks[0]). So we MUST switch the active
   * chain first — otherwise the Arc deposit (5042002) and the Base Sepolia CCTP
   * burn (84532) would both sign on whichever chain happens to be active.
   * `switchNetwork` lives on the wallet and takes the numeric chain id.
   */
  const getWalletClient = useCallback(
    async (chainId: string): Promise<WalletClient | undefined> => {
      if (!primaryWallet) return undefined;
      if (!isEthereumWallet(primaryWallet)) return undefined;
      await primaryWallet.switchNetwork(Number(chainId));
      return primaryWallet.getWalletClient(chainId) as Promise<WalletClient | undefined>;
    },
    [primaryWallet],
  );

  const value: WalletState = {
    loggedIn: Boolean(isLoggedIn && address),
    name: address ? shortAddress(address) : "",
    address,
    chainId,
    balanceUsdc,
    login: () => setShowAuthFlow(true),
    logout: () => handleLogOut(),
    getNetwork,
    switchNetwork,
    getWalletClient,
  };

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}
