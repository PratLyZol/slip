/**
 * Step 2 — Aggregate: bring the sender's USDC onto Arc via Circle CCTP.
 *
 * Two parts, in order:
 *   1. {@link aggregate} — verify the sender holds enough USDC (honest
 *      pass-through; "Dynamic chain abstraction / swap-everything-to-USDC" was
 *      NOT a verifiable first-class Dynamic product — docs/research/dynamic.md
 *      §5; PLAN §4: Dynamic has no aggregate product).
 *   2. {@link bridgeToArc} — the REAL aggregation: a Circle CCTP bridge that
 *      burns Σ(amount) USDC on Base Sepolia and mints it on Arc (forwarder mode,
 *      no recipient Arc gas). PLAN §4: CCTP fills the aggregation role. Bridges
 *      the TOTAL ONCE — never per-recipient.
 *
 * Real path: the burn is signed by the CONNECTED DYNAMIC WALLET on Base Sepolia
 * (wallet-signed, client-side via bridgeWithWalletClient). Per the FROZEN
 * CONTRACT, the engine resolves the Base Sepolia viem WalletClient (chainId
 * 84532) from the connected wallet and passes it in directly. The server key
 * (CCTP_PRIVATE_KEY) is no longer used in the bridge path.
 *
 * Real-only: both parts read/move real funds — no simulation, no artificial
 * latency. They surface honest errors when a credential/wallet is absent.
 */

import type { Address, WalletClient } from "viem";
import { getUsdcBalance } from "../adapters/balance";
import {
  bridgeWithWalletClient,
  type BridgeToArcParams,
  type BridgeToArcResult,
} from "../adapters/bridge";
import type { AggregateResult } from "./types";

/**
 * Verify (and conceptually consolidate) the sender's assets into spendable USDC.
 * Pass-through fallback: read USDC balance, confirm it covers `amountUsd`.
 */
export async function aggregate(
  amountUsd: number,
  senderAddress?: Address,
  originChainId?: number,
): Promise<AggregateResult> {
  // Read the wallet's USDC on its connected origin chain (the CCTP burn source).
  const availableUsdc = await getUsdcBalance(senderAddress, originChainId);
  return {
    availableUsdc,
    sufficient: availableUsdc + 1e-9 >= amountUsd,
  };
}

/**
 * Aggregate the funds onto Arc via Circle CCTP (the real aggregation leg).
 * Burns Σ on Base Sepolia, mints on Arc, awaits the mint, returns both edges.
 * The burn is signed by + funded from the connected wallet — no server key, no
 * simulation. Throws an honest error on failure (never a fake-success fallback).
 *
 * FROZEN CONTRACT (the engine programs against this exact shape):
 *   bridgeToArc(params, walletClient): Promise<BridgeToArcResult>
 *
 * @param params       standard bridge params (amountUsdc + recipientAddress).
 *                     recipientAddress is the connected wallet's Arc address.
 * @param walletClient the connected wallet's viem WalletClient ALREADY on Base
 *                     Sepolia (chainId 84532) — the engine resolves it via
 *                     getWalletClient("84532") (which switches the network) and
 *                     passes the resolved client. Used to sign + fund the burn.
 */
export async function bridgeToArc(
  params: BridgeToArcParams,
  walletClient: WalletClient,
): Promise<BridgeToArcResult> {
  // The wallet-signed CCTP burn requires the connected wallet's Base Sepolia
  // client. A falsy client means no wallet is connected — fail honestly rather
  // than simulate. (The engine type-guards this too; this is defence in depth.)
  if (!walletClient) {
    throw new Error(
      "[slip] No Base Sepolia wallet client — connect a wallet before sending. The CCTP burn must be signed by the connected wallet.",
    );
  }

  return bridgeWithWalletClient(walletClient, params);
}
