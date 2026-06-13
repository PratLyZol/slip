/**
 * CCTP aggregation adapter — bring the Σ(amount) USDC onto Arc (PRD §2 step 4,
 * PLAN §4). This is the REAL "aggregation" leg: Dynamic has no aggregate-to-USDC
 * product (PLAN §4 correction), so Circle CCTP fills that role — burn USDC on
 * Base Sepolia, mint it natively on Arc, in ONE call, forwarder mode so the
 * recipient needs no Arc gas.
 *
 * Wraps `@circle-fin/bridge-kit` + `@circle-fin/adapter-viem-v2` so the engine
 * never imports the SDK directly (AGENTS.md: "SDK wiring lives ONLY in
 * adapters"). ONE real implementation, no simulation:
 *
 *  - {@link bridgeWithWalletClient}: the live CCTP bridge via bridge-kit. The
 *    burn is signed by + funded from the CONNECTED WALLET on Base Sepolia (not a
 *    server key). The mint is relayed by Circle's Orbit forwarder onto Arc (no
 *    Arc gas for anyone). Runs CLIENT-SIDE using the wallet's viem WalletClient
 *    wrapped as an EIP-1193 provider. CCTP_PRIVATE_KEY is NOT used here, and
 *    there is NO demo/simulation fallback — on failure it throws an HONEST error
 *    so a live route can never report a fake-success burn/mint.
 *
 * bridge-kit API used (verified against the INSTALLED package, not just the
 * PLAN.md snippet — the PLAN guide matches the public surface):
 *   new BridgeKit().bridge({
 *     from: { adapter, chain: "Base_Sepolia" },
 *     to:   { adapter, chain: "Arc_Testnet", recipientAddress, useForwarder: true },
 *     amount, config: { transferSpeed: TransferSpeed.FAST },
 *   }) => Promise<BridgeResult>
 * where BridgeResult is `{ state: "success"|"error"|"pending", steps: BridgeStep[] }`
 * and each BridgeStep is `{ name, state, txHash?, explorerUrl?, forwarded? }`.
 * `createViemAdapterFromProvider({ provider })` builds the EVM signer from an
 * EIP-1193 provider; a viem WalletClient's `.request` method is EIP-1193 compat.
 */

import type { EIP1193Provider, Hex, WalletClient } from "viem";
import { BridgeKit, TransferSpeed } from "@circle-fin/bridge-kit";
import type { BridgeChainIdentifier } from "@circle-fin/bridge-kit";
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import {
  CCTP_DEST_CHAIN,
  CCTP_SOURCE_CHAIN,
  baseSepoliaTxUrl,
  txUrl,
} from "./arc";
import type { TxRef } from "../engine/types";

/** Inputs for an aggregation bridge: how much, where it should mint, from where. */
export interface BridgeToArcParams {
  /** Σ amount of USDC to bridge, human units as a string (e.g. "50.00"). */
  amountUsdc: string;
  /** The Arc address the minted USDC should land on (the sender's Arc EOA). */
  recipientAddress: string;
  /**
   * bridge-kit `from.chain` — the wallet's connected ORIGIN chain to burn from
   * (e.g. "Base_Sepolia", "Arbitrum_Sepolia"). Comes from the CCTP source
   * registry keyed by the wallet's live chain id. Defaults to Base Sepolia.
   */
  sourceChain?: BridgeChainIdentifier;
}

/** Result of an aggregation bridge: the two public on-chain edges. */
export interface BridgeToArcResult {
  /** The CCTP burn on Base Sepolia (source side). */
  burnTx: TxRef;
  /** The CCTP mint on Arc (destination side, forwarder-relayed). */
  mintTx: TxRef;
  /**
   * Always `false` — there is no simulation path. Retained so the engine's
   * existing `bridge.simulated` branch keeps compiling (it resolves to the
   * "real" copy). A live route can never report a simulated burn/mint.
   */
  simulated: boolean;
}

// ---------------------------------------------------------------------------
// REAL implementation — @circle-fin/bridge-kit, Base Sepolia → Arc, forwarder.
// The only implementation: wallet-signed, client-side, no simulation fallback.
// ---------------------------------------------------------------------------

/** Pull a step's tx hash out of a BridgeResult by matching its name. */
function stepHash(
  steps: ReadonlyArray<{ name: string; txHash?: string }>,
  needle: string,
): Hex | undefined {
  const step = steps.find((s) =>
    s.name.toLowerCase().includes(needle),
  );
  const hash = step?.txHash;
  return hash ? (hash as Hex) : undefined;
}

/**
 * Bridge USDC from Base Sepolia to Arc using the CONNECTED WALLET's viem
 * WalletClient as the signer. The burn is funded by — and signed by — the
 * Dynamic embedded wallet; the same wallet receives the mint on Arc.
 *
 * The viem WalletClient exposes a `.request` method that is EIP-1193 compatible.
 * We wrap it as `{ request: walletClient.request.bind(walletClient) }` and pass
 * it to `createViemAdapterFromProvider` — that is the ENTIRE provider wrapping.
 *
 * bridge-kit + the viem adapter are imported STATICALLY at the top of this module
 * so Turbopack/webpack bundle them into the client chunk normally. Their
 * transitive deps all ship browser builds (`pino` has a `browser` field →
 * browser.js, `@solana/web3.js`/`@ethersproject/*` are browser-safe), so the
 * client build resolves them without Node-built-in shims — verified by
 * `npm run build`. (An earlier version used `turbopackIgnore` dynamic imports;
 * that left bare specifiers the browser cannot resolve at runtime, so it was
 * removed in favour of real bundling.)
 *
 * `createViemAdapterFromProvider` is ASYNC (returns Promise<ViemAdapter>) — it
 * must be awaited before the adapter is passed to BridgeKit.bridge().
 */
export async function bridgeWithWalletClient(
  walletClient: WalletClient,
  params: BridgeToArcParams,
): Promise<BridgeToArcResult> {
  const { amountUsdc, recipientAddress, sourceChain } = params;

  // Wrap the viem WalletClient as an EIP-1193 provider. A viem WalletClient's
  // `.request` method is EIP-1193-compatible; bind it to preserve `this` when
  // bridge-kit calls it internally. The adapter only exercises `request`, so
  // casting the single-method object to EIP1193Provider is safe here.
  const eip1193Provider = {
    request: walletClient.request.bind(walletClient),
  } as unknown as EIP1193Provider;

  // Default (user-controlled) capabilities: the connected wallet owns the
  // address, so no `address` field is required in from/to. Must be awaited.
  const adapter = await createViemAdapterFromProvider({
    provider: eip1193Provider,
  });

  const result = await new BridgeKit().bridge({
    from: { adapter, chain: sourceChain ?? CCTP_SOURCE_CHAIN },
    to: {
      adapter,
      chain: CCTP_DEST_CHAIN,
      recipientAddress,
      useForwarder: true,
    },
    amount: amountUsdc,
    config: { transferSpeed: TransferSpeed.FAST },
  });

  if (result.state !== "success") {
    // Surface the first errored step's message honestly — do NOT mask.
    const failed = result.steps.find((s) => s.state === "error");
    const reason = failed?.errorMessage ?? `bridge state: ${result.state}`;
    throw new Error(`CCTP bridge failed — ${reason}`);
  }

  const burnHash = stepHash(result.steps, "burn");
  const mintHash = stepHash(result.steps, "mint");
  if (!burnHash || !mintHash) {
    throw new Error(
      "CCTP bridge succeeded but burn/mint tx hashes were not reported.",
    );
  }

  return {
    burnTx: {
      hash: burnHash,
      explorerUrl: baseSepoliaTxUrl(burnHash),
      simulated: false,
    },
    mintTx: {
      hash: mintHash,
      explorerUrl: txUrl(mintHash),
      simulated: false,
    },
    simulated: false,
  };
}
