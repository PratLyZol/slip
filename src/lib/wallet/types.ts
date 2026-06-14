import type { Address, WalletClient } from "viem";

/** Unified wallet view consumed by the UI. Real-only (the connected wallet). */
export interface WalletState {
  /** Whether a wallet is connected. */
  loggedIn: boolean;
  /** Display name for the connected wallet (short address). */
  name: string;
  /** Connected wallet address, if any. */
  address?: Address;
  /** The wallet's currently-connected EVM chain id (the CCTP burn origin). */
  chainId?: number;
  /** USDC balance in human units on the connected chain, or null while loading. */
  balanceUsdc: number | null;
  /**
   * Per-chain USDC balances (Base Sepolia + Arc Testnet), for the Settings
   * screen. `usdc` is human units, or null if that chain's read failed/loading.
   */
  balances: { chainId: number; name: string; usdc: number | null }[];
  /**
   * Force an immediate re-read of `balanceUsdc` + `balances`, resolving once the
   * reads land. Use after a money move that completes WITHOUT a network switch —
   * e.g. SendScreen awaiting this (and polling) when step ① (bridge → Arc mint)
   * finishes, so the step ② gate sees the fresh Arc balance right away instead
   * of waiting for a chain switch to retrigger the read. Resolves immediately
   * (no-op) when no wallet is connected.
   */
  refreshBalances: () => Promise<void>;
  /** Open the wallet connect flow. */
  login: () => void;
  /** Disconnect the wallet. */
  logout: () => void;
  /** Read the wallet's current network chain id (does NOT switch). */
  getNetwork: () => Promise<number | undefined>;
  /** Switch the wallet's active network to `chainId`. */
  switchNetwork: (chainId: number) => Promise<void>;
  /**
   * Obtain a viem WalletClient for the requested chain from the connected
   * Dynamic wallet. Returns `undefined` when no wallet is connected or the
   * Dynamic environment is absent. The chainId is a decimal string (e.g.
   * "84532" for Base Sepolia, "5042002" for Arc testnet).
   */
  getWalletClient: (chainId: string) => Promise<WalletClient | undefined>;
}
