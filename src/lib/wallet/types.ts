import type { Address } from "viem";

/** Unified wallet view consumed by the UI, regardless of demo vs real backend. */
export interface WalletState {
  /** True when running on the deterministic demo backend. */
  demo: boolean;
  /** Whether a sender identity is present (always true in demo). */
  loggedIn: boolean;
  /** Display name for the logged-in sender. */
  name: string;
  /** Connected/embedded wallet address, if any. */
  address?: Address;
  /** USDC balance in human units, or null while loading. */
  balanceUsdc: number | null;
  /** Open the login flow (no-op in demo). */
  login: () => void;
  /** Sign out (no-op in demo). */
  logout: () => void;
}
