/**
 * Step 5 — Settle: a REAL on-chain USDC transfer on Arc to the claim address.
 *
 * This is the degraded (non-private) settle path: when the Unlink shielded leg is
 * unavailable, distribute.ts falls back to a direct USDC transfer so the recipient
 * still receives funds — but ONLY if those funds genuinely move on-chain. There is
 * NO simulation fallback: a transfer that cannot be signed/submitted throws, so the
 * caller emits a failed step instead of a fake "sent".
 *
 * The connected wallet (the sender's Dynamic embedded wallet, switched to Arc by
 * the caller) signs the ERC-20 `transfer`. USDC on Arc is 0x3600… (6 decimals,
 * chain 5042002). We read the tx receipt to confirm it succeeded before returning.
 */

import {
  createPublicClient,
  http,
  parseUnits,
  type Address,
  type Hex,
  type WalletClient,
} from "viem";
import { USDC_ADDRESS, USDC_DECIMALS, arcTestnet, txUrl } from "../adapters/arc";
import type { SettleResult } from "./types";

/** Minimal ERC-20 `transfer` ABI for the USDC settle. */
const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/**
 * Settle `amountUsd` USDC to the `to` address with a REAL ERC-20 transfer on Arc,
 * signed by the connected wallet's viem WalletClient. Throws on any failure —
 * never simulates — so a caller can never report a fake-success settle.
 *
 * @param to            destination address (the recipient's claim account)
 * @param amountUsd     amount in USD (== USDC), human units
 * @param walletClient  the connected wallet's viem client on Arc (5042002)
 */
export async function settle(
  to: Address,
  amountUsd: number,
  walletClient: WalletClient,
): Promise<SettleResult> {
  if (!walletClient) {
    throw new Error(
      "No Arc wallet client for the direct settle — connect a wallet before sending.",
    );
  }
  const account = walletClient.account;
  if (!account) {
    throw new Error("Wallet client has no account — cannot sign the USDC transfer.");
  }

  // Dedicated Arc public client for gas estimation + receipt polling, so the read
  // path does not depend on the injected wallet's (possibly flaky) transport.
  const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });

  // Human units → 6-decimal USDC base units. toFixed(6) avoids float drift.
  const amount = parseUnits(amountUsd.toFixed(USDC_DECIMALS), USDC_DECIMALS);

  const hash = await walletClient.writeContract({
    account,
    chain: arcTestnet,
    address: USDC_ADDRESS,
    abi: ERC20_TRANSFER_ABI,
    functionName: "transfer",
    args: [to, amount],
  });

  // Confirm the transfer actually landed — a reverted tx must NOT read as success.
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`USDC settle transfer reverted (tx ${hash}).`);
  }

  return {
    tx: {
      hash: hash as Hex,
      explorerUrl: txUrl(hash as Hex),
      simulated: false,
    },
  };
}
