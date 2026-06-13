/**
 * USDC balance adapter for Arc testnet.
 *
 * Real path: ERC-20 `balanceOf` of the Arc USDC interface via a viem public
 * client over the Arc RPC (6 decimals). Demo path: a fixed believable balance.
 * SDK/chain wiring stays in adapters (AGENTS.md).
 */

import { createPublicClient, formatUnits, http, type Address } from "viem";
import { arcTestnet, USDC_ADDRESS, USDC_DECIMALS } from "./arc";

const ERC20_BALANCE_OF_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

let cachedClient: ReturnType<typeof createPublicClient> | null = null;
function publicClient() {
  if (!cachedClient) {
    cachedClient = createPublicClient({
      chain: arcTestnet,
      transport: http(),
    });
  }
  return cachedClient;
}

/**
 * Read the live USDC balance (human units) for an address on Arc. Returns 0
 * when no address is connected yet.
 */
export async function getUsdcBalance(address?: Address): Promise<number> {
  if (!address) return 0;
  const raw = await publicClient().readContract({
    address: USDC_ADDRESS,
    abi: ERC20_BALANCE_OF_ABI,
    functionName: "balanceOf",
    args: [address],
  });
  return Number(formatUnits(raw, USDC_DECIMALS));
}
