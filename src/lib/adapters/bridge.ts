/**
 * CCTP aggregation adapter — bring the Σ(amount) USDC onto Arc (PRD §2 step 4,
 * PLAN §4). This is the REAL "aggregation" leg: Dynamic has no aggregate-to-USDC
 * product (PLAN §4 correction), so Circle CCTP fills that role — burn USDC on
 * Base Sepolia, mint it natively on Arc, in ONE call, forwarder mode so the
 * recipient needs no Arc gas.
 *
 * Wraps `@circle-fin/bridge-kit` + `@circle-fin/adapter-viem-v2` behind a small
 * {@link BridgeOps} interface so the engine never imports the SDK directly
 * (AGENTS.md: "SDK wiring lives ONLY in adapters"). Two implementations:
 *
 *  - DEMO ({@link demoBridgeOps}): deterministic simulation. A fake burn tx on
 *    the Base Sepolia explorer + a fake mint tx on ArcScan, realistic latency.
 *    Credential-free so the demo stays green.
 *  - REAL ({@link realBridgeOps}): the live CCTP bridge via bridge-kit. The burn
 *    is paid by the `CCTP_PRIVATE_KEY` EOA on Base Sepolia; the mint is relayed
 *    by Circle's Orbit forwarder onto Arc (no Arc gas for anyone). SERVER-ONLY —
 *    the private key is a secret and must never reach the browser.
 *
 * NO per-adapter feature flag (user directive): the adapter branches on the
 * GLOBAL {@link isDemoMode} only. In real mode the bridge runs for real and, on
 * failure, throws an HONEST error — it does NOT silently fall back to the sim.
 *
 * bridge-kit API used (verified against the INSTALLED package @1.10.2, not just
 * the PLAN.md snippet — the PLAN guide matches the public surface):
 *   new BridgeKit().bridge({
 *     from: { adapter, chain: "Base_Sepolia" },
 *     to:   { adapter, chain: "Arc_Testnet", recipientAddress, useForwarder: true },
 *     amount, config: { transferSpeed: TransferSpeed.FAST },
 *   }) => Promise<BridgeResult>
 * where BridgeResult is `{ state: "success"|"error"|"pending", steps: BridgeStep[] }`
 * and each BridgeStep is `{ name, state, txHash?, explorerUrl?, forwarded? }`.
 * `createViemAdapterFromPrivateKey({ privateKey })` builds the EVM signer; one
 * adapter works across both chains (the from/to chains are passed per-leg).
 */

import type { Hex } from "viem";
import {
  CCTP_DEST_CHAIN,
  CCTP_SOURCE_CHAIN,
  baseSepoliaTxUrl,
  txUrl,
} from "./arc";
import { CCTP_PRIVATE_KEY, isDemoMode } from "../config";
import { simLatency, simTxOn, sleep } from "../demo/sim";
import type { TxRef } from "../engine/types";

/** Inputs for an aggregation bridge: how much, and where it should mint. */
export interface BridgeToArcParams {
  /** Σ amount of USDC to bridge, human units as a string (e.g. "50.00"). */
  amountUsdc: string;
  /** The Arc address the minted USDC should land on (the sender's Arc EOA). */
  recipientAddress: string;
}

/** Result of an aggregation bridge: the two public on-chain edges. */
export interface BridgeToArcResult {
  /** The CCTP burn on Base Sepolia (source side). */
  burnTx: TxRef;
  /** The CCTP mint on Arc (destination side, forwarder-relayed). */
  mintTx: TxRef;
  /** True when both txs were deterministic demo simulations, not real. */
  simulated: boolean;
}

/**
 * The aggregation interface the engine programs against. Both the real CCTP
 * bridge and the demo simulation implement it.
 */
export interface BridgeOps {
  /** True when this is the real bridge-kit path (vs. the demo simulation). */
  readonly real: boolean;
  /**
   * Bridge Σ(amount) USDC from Base Sepolia onto Arc (mint to
   * `recipientAddress`). Bridges the total ONCE — never per-recipient.
   */
  bridgeToArc(params: BridgeToArcParams): Promise<BridgeToArcResult>;
}

// ---------------------------------------------------------------------------
// DEMO implementation — deterministic, no credentials, no network.
// ---------------------------------------------------------------------------

const demoBridgeOps: BridgeOps = {
  real: false,

  async bridgeToArc({ amountUsdc, recipientAddress }) {
    // Realistic FAST CCTP latency Base Sepolia → Arc (PLAN §8: docs ~8–20s; we
    // keep the demo snappy but non-instant so the await reads as real work).
    await sleep(simLatency(1200, 2600));
    // Burn lives on the SOURCE chain explorer (Base Sepolia); mint on Arc.
    const burnTx = simTxOn(
      baseSepoliaTxUrl,
      "cctp-burn",
      amountUsdc,
      recipientAddress,
    );
    const mintTx = simTxOn(txUrl, "cctp-mint", amountUsdc, recipientAddress);
    return { burnTx, mintTx, simulated: true };
  },
};

// ---------------------------------------------------------------------------
// REAL implementation — @circle-fin/bridge-kit, Base Sepolia → Arc, forwarder.
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

const realBridgeOps: BridgeOps = {
  real: true,

  async bridgeToArc({ amountUsdc, recipientAddress }) {
    if (!CCTP_PRIVATE_KEY) {
      throw new Error(
        "CCTP_PRIVATE_KEY missing — cannot run the real CCTP bridge.",
      );
    }
    // The CCTP burn is paid by a funded EOA whose private key is a SECRET; it
    // must never ship to the browser. Guard so a stray client-side call fails
    // loudly rather than leaking the key (mirrors the Unlink admin-path guard).
    if (typeof window !== "undefined") {
      throw new Error(
        "Real CCTP bridge is server-only (CCTP_PRIVATE_KEY) — not callable in the browser.",
      );
    }
    // Runtime-resolved specifiers keep the bundler from statically pulling the
    // (Node-only) bridge-kit + adapter into the browser bundle. They still
    // type-check and are reachable server-side when CCTP_PRIVATE_KEY is present.
    const bridgeKitMod = "@circle-fin/bridge-kit";
    const adapterMod = "@circle-fin/adapter-viem-v2";
    const { BridgeKit, TransferSpeed } = (await import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ bridgeKitMod
    )) as typeof import("@circle-fin/bridge-kit");
    const { createViemAdapterFromPrivateKey } = (await import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ adapterMod
    )) as typeof import("@circle-fin/adapter-viem-v2");

    // One adapter (the funded Base Sepolia EOA) signs the burn. The mint is
    // relayed by Circle's Orbit forwarder, so no destination adapter/gas needed.
    const adapter = createViemAdapterFromPrivateKey({
      privateKey: CCTP_PRIVATE_KEY,
    });

    const result = await new BridgeKit().bridge({
      from: { adapter, chain: CCTP_SOURCE_CHAIN },
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
      const reason =
        failed?.errorMessage ?? `bridge state: ${result.state}`;
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
  },
};

/**
 * Select the active BridgeOps. Real bridge-kit path when NOT in demo mode;
 * otherwise the deterministic demo simulation. NO per-adapter flag — branches
 * on the GLOBAL demo mode only (user directive).
 */
export function getBridgeOps(): BridgeOps {
  return isDemoMode() ? demoBridgeOps : realBridgeOps;
}

/** True when the demo simulation is the active bridge path. */
export function bridgeIsSimulated(): boolean {
  return isDemoMode();
}
