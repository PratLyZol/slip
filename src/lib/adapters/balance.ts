/**
 * USDC balance adapter — reads the wallet's USDC across the chains it can hold
 * money on.
 *
 * {@link getUsdcBalance} reads the balance on a single chain (the wallet's
 * connected chain). {@link getAllUsdcBalances} reads every {@link BALANCE_CHAINS}
 * entry so the Settings screen can show per-chain holdings. We resolve each
 * chain's USDC token + RPC from the balance registry and read `balanceOf`; when
 * a chain id is unknown we fall back to Base Sepolia. SDK/chain wiring stays in
 * adapters (AGENTS.md).
 */

import { createPublicClient, formatUnits, http, type Address } from "viem";
import {
  BALANCE_CHAINS,
  balanceChainByChainId,
  cctpSourceByChainId,
  type BalanceChain,
} from "./cctp-chains";

const ERC20_BALANCE_OF_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const USDC_DECIMALS = 6;
/** Default chain when the wallet's chain is unknown (Base Sepolia). */
const DEFAULT_CHAIN = BALANCE_CHAINS[0];

const clients = new Map<number, ReturnType<typeof createPublicClient>>();
function clientFor(chain: BalanceChain) {
  let cl = clients.get(chain.chainId);
  if (!cl) {
    cl = createPublicClient({ transport: http(chain.rpc) });
    clients.set(chain.chainId, cl);
  }
  return cl;
}

/** Read USDC `balanceOf` (human units) for `address` on one balance chain. */
async function readUsdc(chain: BalanceChain, address: Address): Promise<number> {
  const raw = await clientFor(chain).readContract({
    address: chain.usdc,
    abi: ERC20_BALANCE_OF_ABI,
    functionName: "balanceOf",
    args: [address],
  });
  return Number(formatUnits(raw as bigint, USDC_DECIMALS));
}

/**
 * Read the live USDC balance (human units) for an address on a single chain.
 * Pass the wallet's connected `chainId`. Resolves the chain from the balance
 * registry first (Base Sepolia + Arc), then the CCTP source registry (so a
 * wallet on any burnable origin — Arbitrum/Optimism/etc. — still reads its real
 * USDC), and finally falls back to Base Sepolia. Returns 0 with no address.
 */
export async function getUsdcBalance(
  address?: Address,
  chainId?: number,
): Promise<number> {
  if (!address) return 0;
  const chain =
    balanceChainByChainId(chainId) ?? cctpSourceByChainId(chainId) ?? DEFAULT_CHAIN;
  return readUsdc(chain, address);
}

/** A per-chain USDC balance row, as consumed by the wallet UI. */
export interface ChainUsdcBalance {
  chainId: number;
  name: string;
  /** USDC in human units, or null if the read failed. */
  usdc: number | null;
}

/**
 * Read USDC across every {@link BALANCE_CHAINS} entry (Base Sepolia + Arc) for
 * the Settings screen. Reads run in parallel and are independent: one chain's
 * RPC failing yields `usdc: null` for that row only, never rejecting the whole
 * call. Returns one row per chain in registry order (empty when no address).
 */
export async function getAllUsdcBalances(
  address?: Address,
): Promise<ChainUsdcBalance[]> {
  if (!address) return [];
  return Promise.all(
    BALANCE_CHAINS.map(async (chain) => {
      try {
        const usdc = await readUsdc(chain, address);
        return { chainId: chain.chainId, name: chain.name, usdc };
      } catch {
        return { chainId: chain.chainId, name: chain.name, usdc: null };
      }
    }),
  );
}
