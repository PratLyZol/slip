/**
 * Multi-chain USDC balance adapter.
 *
 * A wallet's spendable USDC can sit on ANY CCTP-supported testnet — the funds
 * are bridged onto Arc at send time (CCTP burns on the source chain, mints on
 * Arc). A single-chain (Arc-only) read is therefore misleading: it shows $0 for
 * a wallet that actually holds USDC on, say, Base Sepolia. So we read `balanceOf`
 * across the CCTP testnets in parallel, tolerate per-chain RPC failures (treat as
 * 0, never block), and sum. `getUsdcBalance` returns the total; the by-chain
 * variant returns the breakdown so the UI can show WHERE the funds are.
 */

import { createPublicClient, formatUnits, http, type Address } from "viem";

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
/** Per-chain read cap so one slow/dead RPC never stalls the balance. */
const READ_TIMEOUT_MS = 4000;

/** A wallet's USDC on one chain (human units). */
export interface ChainUsdc {
  key: string;
  name: string;
  chainId: number;
  usdc: number;
}

interface UsdcChain {
  key: string;
  name: string;
  chainId: number;
  rpc: string;
  token: Address;
}

/**
 * CCTP testnet chains we look for the wallet's USDC on (native USDC, 6 decimals).
 * Arc is the bridge destination; the rest are valid CCTP sources. Addresses are
 * Circle's canonical testnet USDC per chain.
 */
const USDC_CHAINS: UsdcChain[] = [
  { key: "arc", name: "Arc", chainId: 5042002, rpc: "https://rpc.testnet.arc.network", token: "0x3600000000000000000000000000000000000000" },
  { key: "base-sepolia", name: "Base Sepolia", chainId: 84532, rpc: "https://sepolia.base.org", token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" },
  { key: "eth-sepolia", name: "Ethereum Sepolia", chainId: 11155111, rpc: "https://ethereum-sepolia-rpc.publicnode.com", token: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" },
  { key: "arb-sepolia", name: "Arbitrum Sepolia", chainId: 421614, rpc: "https://sepolia-rollup.arbitrum.io/rpc", token: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" },
  { key: "op-sepolia", name: "Optimism Sepolia", chainId: 11155420, rpc: "https://sepolia.optimism.io", token: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7" },
  { key: "polygon-amoy", name: "Polygon Amoy", chainId: 80002, rpc: "https://rpc-amoy.polygon.technology", token: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582" },
  { key: "avax-fuji", name: "Avalanche Fuji", chainId: 43113, rpc: "https://api.avax-test.network/ext/bc/C/rpc", token: "0x5425890298aed601595a70AB815c96711a31Bc65" },
];

const clients = new Map<string, ReturnType<typeof createPublicClient>>();
function clientFor(c: UsdcChain) {
  let cl = clients.get(c.key);
  if (!cl) {
    cl = createPublicClient({ transport: http(c.rpc, { timeout: READ_TIMEOUT_MS }) });
    clients.set(c.key, cl);
  }
  return cl;
}

async function readOne(c: UsdcChain, address: Address): Promise<number> {
  try {
    const raw = (await clientFor(c).readContract({
      address: c.token,
      abi: ERC20_BALANCE_OF_ABI,
      functionName: "balanceOf",
      args: [address],
    })) as bigint;
    return Number(formatUnits(raw, USDC_DECIMALS));
  } catch {
    // RPC flaky / chain unreachable — treat as 0 so a single bad endpoint never
    // zeroes the whole balance or blocks a send.
    return 0;
  }
}

/**
 * Per-chain USDC for an address across the CCTP testnets. Failed reads → 0.
 * Returns every chain (including zeros) so the UI can decide what to surface.
 */
export async function getUsdcBalanceByChain(
  address?: Address,
): Promise<ChainUsdc[]> {
  if (!address) return [];
  return Promise.all(
    USDC_CHAINS.map(async (c) => ({
      key: c.key,
      name: c.name,
      chainId: c.chainId,
      usdc: await readOne(c, address),
    })),
  );
}

/**
 * Total USDC (human units) for an address, summed across the CCTP testnets.
 * Returns 0 when no address is connected yet.
 */
export async function getUsdcBalance(address?: Address): Promise<number> {
  if (!address) return 0;
  const per = await getUsdcBalanceByChain(address);
  return per.reduce((sum, c) => sum + c.usdc, 0);
}
