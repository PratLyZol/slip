/**
 * Step 5 — Settle: transfer USDC to the counterfactual address.
 *
 * Demo path: a deterministic simulated transfer with a plausible Arc tx hash.
 * Real path: a viem USDC ERC-20 transfer, gated by isDemoMode(). The real path
 * needs a funded sender wallet client (wired by a later agent through Dynamic);
 * for now it is a clearly-marked stub so the demo never breaks.
 */

import { type Address, type Hex } from "viem";
import { isDemoMode } from "../config";
import { simLatency, simTx, sleep } from "../demo/sim";
import type { SettleResult } from "./types";

/**
 * Settle `amountUsd` USDC to the counterfactual `to` address.
 * `secret` is folded into the simulated hash so each slip gets a unique tx.
 */
export async function settle(
  to: Address,
  amountUsd: number,
  secret: Hex,
): Promise<SettleResult> {
  if (isDemoMode()) {
    await sleep(simLatency(600, 1500));
    return { tx: simTx("settle", to, amountUsd.toString(), secret) };
  }

  // NOT YET WIRED — real USDC settlement.
  // Real path (later agent): obtain a viem WalletClient for the Dynamic embedded
  // wallet on Arc, then:
  //   const hash = await walletClient.writeContract({
  //     address: USDC_ADDRESS, abi: erc20TransferAbi, functionName: "transfer",
  //     args: [to, parseUnits(amountUsd.toFixed(6), USDC_DECIMALS)],
  //   });
  // Until that wallet client exists, fall back to a labeled simulation so the
  // engine still produces a funded (simulated) account and a valid claim link.
  console.warn(
    "[slip] real settle path not wired yet — falling back to simulated settlement.",
  );
  await sleep(simLatency(600, 1500));
  return { tx: simTx("settle", to, amountUsd.toString(), secret) };
}
