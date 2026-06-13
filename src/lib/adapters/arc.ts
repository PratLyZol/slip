/**
 * Arc testnet chain config + token addresses + explorer helpers.
 *
 * All values VERIFIED in docs/research/arc.md — do not re-research or invent.
 * SDK/chain wiring lives ONLY in adapters (AGENTS.md file layout).
 */

import { defineChain, type Address, type Hex } from "viem";

/** Arc testnet chain id (decimal — trust over any rendered hex). */
export const ARC_CHAIN_ID = 5042002;

export const ARC_RPC_URL = "https://rpc.testnet.arc.network";
export const ARC_EXPLORER_URL = "https://testnet.arcscan.app";
export const ARC_FAUCET_URL = "https://faucet.circle.com";

/**
 * Unlink hosted-environment name for Arc testnet. The SDK maps this string to
 * its Engine URL (`https://arc-testnet-production-api.unlink.xyz`) and resolves
 * the on-chain verifier contract internally. Confirmed in
 * @unlink-xyz/sdk ENVIRONMENTS (chain id 5042002).
 */
export const UNLINK_ARC_ENVIRONMENT = "arc-testnet" as const;

/**
 * USDC on Arc — the native gas token's ERC-20 interface.
 * 6 decimals as ERC-20, 18 in native gas accounting (same underlying balance).
 */
export const USDC_ADDRESS: Address =
  "0x3600000000000000000000000000000000000000";
export const USDC_DECIMALS = 6;

/** EURC on Arc (6 decimals) — recipient's local stablecoin in the EU. */
export const EURC_ADDRESS: Address =
  "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";
export const EURC_DECIMALS = 6;

/**
 * Arc testnet as a viem chain. Native currency modeled as USDC with 18 decimals
 * for *gas accounting* (per Arc's dual representation), distinct from the
 * 6-decimal ERC-20 USDC interface used for balances/transfers.
 */
export const arcTestnet = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: [ARC_RPC_URL] },
  },
  blockExplorers: {
    default: { name: "ArcScan", url: ARC_EXPLORER_URL },
  },
  testnet: true,
});

/**
 * Dynamic `overrides.evmNetworks` entry for Arc testnet.
 * Shape verified in docs/research/dynamic.md §2.
 */
export const arcDynamicNetwork = {
  chainId: ARC_CHAIN_ID,
  networkId: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 18,
  },
  rpcUrls: [ARC_RPC_URL],
  blockExplorerUrls: [ARC_EXPLORER_URL],
  iconUrls: [] as string[],
};

/** Explorer URL for a transaction hash. */
export function txUrl(hash: Hex): string {
  return `${ARC_EXPLORER_URL}/tx/${hash}`;
}

/** Explorer URL for an address. */
export function addressUrl(address: Address): string {
  return `${ARC_EXPLORER_URL}/address/${address}`;
}
