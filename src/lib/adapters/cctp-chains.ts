/**
 * CCTP source-chain registry — the origin chains a connected wallet can burn
 * USDC from to bridge onto Arc.
 *
 * The wallet signs the CCTP burn on whatever EVM chain it's currently connected
 * to (the "origin chain"). We must (a) read that chain, (b) confirm it's a chain
 * CCTP can burn from, and (c) hand bridge-kit the correct `from.chain` string +
 * read the wallet's USDC on that chain. This registry is the single source of
 * truth for all three.
 *
 * `bridgeKitChain` values are VERIFIED against @circle-fin/bridge-kit
 * (chains.d.ts chain identifiers). USDC addresses are Circle's canonical CCTP
 * testnet tokens (6 decimals).
 */

import type { Address } from "viem";
import type { BridgeChainIdentifier } from "@circle-fin/bridge-kit";
import {
  ARC_CHAIN_ID,
  ARC_RPC_URL,
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_RPC_URL,
  BASE_SEPOLIA_USDC_ADDRESS,
  USDC_ADDRESS as ARC_USDC_ADDRESS,
} from "./arc";

export interface CctpSourceChain {
  /** Numeric EVM chain id (what wallet.getNetwork() returns). */
  chainId: number;
  /** bridge-kit `from.chain` identifier (type-checked against @circle-fin/bridge-kit). */
  bridgeKitChain: BridgeChainIdentifier;
  /** Human label for the UI ("Base Sepolia"). */
  name: string;
  /** Native USDC on this chain (CCTP-burnable, 6 decimals). */
  usdc: Address;
  /** Public RPC for reading balances on this chain. */
  rpc: string;
}

export const CCTP_SOURCE_CHAINS: CctpSourceChain[] = [
  {
    chainId: 84532,
    bridgeKitChain: "Base_Sepolia",
    name: "Base Sepolia",
    usdc: BASE_SEPOLIA_USDC_ADDRESS,
    rpc: BASE_SEPOLIA_RPC_URL,
  },
  {
    chainId: 11155111,
    bridgeKitChain: "Ethereum_Sepolia",
    name: "Ethereum Sepolia",
    usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    rpc: "https://ethereum-sepolia-rpc.publicnode.com",
  },
  {
    chainId: 421614,
    bridgeKitChain: "Arbitrum_Sepolia",
    name: "Arbitrum Sepolia",
    usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    rpc: "https://sepolia-rollup.arbitrum.io/rpc",
  },
  {
    chainId: 11155420,
    bridgeKitChain: "Optimism_Sepolia",
    name: "Optimism Sepolia",
    usdc: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7",
    rpc: "https://sepolia.optimism.io",
  },
  {
    chainId: 43113,
    bridgeKitChain: "Avalanche_Fuji",
    name: "Avalanche Fuji",
    usdc: "0x5425890298aed601595a70AB815c96711a31Bc65",
    rpc: "https://api.avax-test.network/ext/bc/C/rpc",
  },
  {
    chainId: 80002,
    bridgeKitChain: "Polygon_Amoy_Testnet",
    name: "Polygon Amoy",
    usdc: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
    rpc: "https://rpc-amoy.polygon.technology",
  },
];

/**
 * Chains whose USDC balance the wallet UI reads — distinct from {@link
 * CCTP_SOURCE_CHAINS}.
 *
 * IMPORTANT: Arc is a CCTP *destination*, never a burn source. It lives here
 * (so the wallet can show its Arc USDC and switch onto it) but is deliberately
 * kept OUT of the CCTP source registry — adding it there would let the engine
 * try to burn from Arc. The two lists must stay separate.
 */
export interface BalanceChain {
  /** Numeric EVM chain id. */
  chainId: number;
  /** Human label for the UI. */
  name: string;
  /** USDC token on this chain (6 decimals). */
  usdc: Address;
  /** Public RPC for reading balances on this chain. */
  rpc: string;
}

export const BALANCE_CHAINS: BalanceChain[] = [
  {
    chainId: BASE_SEPOLIA_CHAIN_ID,
    name: "Base Sepolia",
    usdc: BASE_SEPOLIA_USDC_ADDRESS,
    rpc: BASE_SEPOLIA_RPC_URL,
  },
  {
    chainId: ARC_CHAIN_ID,
    name: "Arc Testnet",
    usdc: ARC_USDC_ADDRESS,
    rpc: ARC_RPC_URL,
  },
];

/** A balance-readable chain by numeric id, or undefined if not listed. */
export function balanceChainByChainId(
  chainId?: number,
): BalanceChain | undefined {
  if (chainId == null) return undefined;
  return BALANCE_CHAINS.find((c) => c.chainId === chainId);
}

/** The CCTP source chain for a numeric chain id, or undefined if unsupported. */
export function cctpSourceByChainId(
  chainId?: number,
): CctpSourceChain | undefined {
  if (chainId == null) return undefined;
  return CCTP_SOURCE_CHAINS.find((c) => c.chainId === chainId);
}

/** True when the wallet's current chain is one CCTP can burn from. */
export function isSupportedOriginChain(chainId?: number): boolean {
  return cctpSourceByChainId(chainId) !== undefined;
}

/** Comma-joined supported chain names, for "switch to one of …" UI copy. */
export function supportedOriginChainNames(): string {
  return CCTP_SOURCE_CHAINS.map((c) => c.name).join(", ");
}
