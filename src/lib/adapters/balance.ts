/**
 * USDC balance adapter — reads the wallet's USDC on its connected ORIGIN chain.
 *
 * The connected wallet funds a send by signing the CCTP burn on whatever EVM
 * chain it's currently on (the origin). So the spendable balance is the wallet's
 * USDC on that origin chain — not Arc (which is ~0 pre-bridge). We resolve the
 * chain's USDC token + RPC from the CCTP source registry and read `balanceOf`.
 * When the chain id is unknown/unsupported we fall back to Base Sepolia.
 * SDK/chain wiring stays in adapters (AGENTS.md).
 */

import { createPublicClient, formatUnits, http, type Address } from "viem";
import {
  CCTP_SOURCE_CHAINS,
  cctpSourceByChainId,
  type CctpSourceChain,
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
/** Default origin when the wallet's chain is unknown (Base Sepolia). */
const DEFAULT_SOURCE = CCTP_SOURCE_CHAINS[0];

const clients = new Map<number, ReturnType<typeof createPublicClient>>();
function clientFor(chain: CctpSourceChain) {
  let cl = clients.get(chain.chainId);
  if (!cl) {
    cl = createPublicClient({ transport: http(chain.rpc) });
    clients.set(chain.chainId, cl);
  }
  return cl;
}

/**
 * Read the live USDC balance (human units) for an address on its origin chain.
 * Pass the wallet's connected `chainId`; falls back to Base Sepolia if omitted
 * or unsupported. Returns 0 when no address is connected yet.
 */
export async function getUsdcBalance(
  address?: Address,
  chainId?: number,
): Promise<number> {
  if (!address) return 0;
  const chain = cctpSourceByChainId(chainId) ?? DEFAULT_SOURCE;
  const raw = await clientFor(chain).readContract({
    address: chain.usdc,
    abi: ERC20_BALANCE_OF_ABI,
    functionName: "balanceOf",
    args: [address],
  });
  return Number(formatUnits(raw as bigint, USDC_DECIMALS));
}
