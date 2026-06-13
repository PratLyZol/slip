import type { Address } from "viem";

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
}
