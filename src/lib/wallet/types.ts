import type { Address, WalletClient } from "viem";

/** Unified wallet view consumed by the UI. Real-only (the connected wallet). */
export interface WalletState {
  /** Whether a wallet is connected. */
  loggedIn: boolean;
  /** Display name for the connected wallet (short address). */
  name: string;
  /** Connected wallet address, if any. */
  address?: Address;
  /** USDC balance in human units, or null while loading. */
  balanceUsdc: number | null;
  /** Open the wallet connect flow. */
  login: () => void;
  /** Disconnect the wallet. */
  logout: () => void;
  /**
   * Obtain a viem WalletClient for the requested chain from the connected
   * Dynamic wallet. Returns `undefined` when no wallet is connected or the
   * Dynamic environment is absent. The chainId is a decimal string (e.g.
   * "84532" for Base Sepolia, "5042002" for Arc testnet).
   */
  getWalletClient: (chainId: string) => Promise<WalletClient | undefined>;
}
