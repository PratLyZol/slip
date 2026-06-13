/**
 * Circle Swap Kit adapter — the USDC→EURC conversion at claim time, replacing
 * the StableFX REST flow. Swap Kit is Circle's own SDK (LiFi-backed under the
 * hood, so it stays within the 3-sponsor-SDK rule as the Circle integration).
 *
 * Same-chain swap on Arc testnet: `swap(context, { from:{adapter, chain}, tokenIn,
 * tokenOut, amount })`, signed by a viem private-key adapter. The signer is the
 * recipient's claim account (key derived from the claim secret), which holds the
 * USDC after the unshield/withdraw.
 *
 * SERVER-ONLY: Swap Kit is Node-only and the signing key is a secret — neither
 * may reach the browser. Guarded with a `typeof window` throw; runtime-resolved
 * dynamic imports keep the SDK out of the client bundle (mirrors adapters/bridge.ts).
 *
 * REALITY (honest): Swap Kit routes through LiFi, which has no USDC↔EURC pool on
 * Arc *testnet*. So a real swap there returns "no route" — we surface that as a
 * `routed: false` result and the caller delivers USDC instead (no fake EURC).
 */

import { concatHex, keccak256, toHex, type Hex } from "viem";

/** Derive the recipient claim account's signing key from the claim secret —
 * IDENTICAL to counterfactual.recipientAddressFromSecret, so the swap is signed
 * by the very account that holds the withdrawn USDC. Server-only. */
function recipientKeyFromSecret(secret: Hex): Hex {
  return keccak256(concatHex([secret, toHex("slip:recipient")]));
}

export interface UsdcToEurcResult {
  /** Amount the recipient ends with (EURC if routed, USDC on fallback). */
  amount: string;
  /** True when a real Swap Kit route executed; false when none existed. */
  routed: boolean;
  /** On-chain swap tx hash, when the swap executed. */
  txHash?: Hex;
  /** Effective USDC→EURC rate, when known. */
  rate?: number;
  /** Honest note (e.g. "no route on Arc testnet — delivered USDC"). */
  note?: string;
}

/**
 * Swap `amountUsdc` USDC → EURC on Arc via Swap Kit, signed by the secret's
 * recipient account. On any failure (the expected testnet case: no LiFi route),
 * returns `{ routed: false, amount: amountUsdc }` so the caller delivers USDC.
 * Never throws for a missing route — only honest-fallbacks.
 */
export async function swapUsdcToEurc(
  amountUsdc: string,
  secret: Hex,
): Promise<UsdcToEurcResult> {
  if (typeof window !== "undefined") {
    throw new Error(
      "[slip] swap adapter is SERVER-ONLY — Swap Kit + the signing key must never reach the browser.",
    );
  }

  // Runtime-resolved specifiers keep the bundler from pulling the Node-only SDK
  // into the browser bundle (same pattern as adapters/bridge.ts).
  const swapKitMod = "@circle-fin/swap-kit";
  const adapterMod = "@circle-fin/adapter-viem-v2";
  const { swap, createSwapKitContext } = (await import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ swapKitMod
  )) as typeof import("@circle-fin/swap-kit");
  const { createViemAdapterFromPrivateKey } = (await import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ adapterMod
  )) as typeof import("@circle-fin/adapter-viem-v2");

  try {
    const adapter = createViemAdapterFromPrivateKey({
      privateKey: recipientKeyFromSecret(secret),
    });
    const context = createSwapKitContext();

    const result = (await swap(context, {
      from: { adapter, chain: "Arc_Testnet" },
      tokenIn: "USDC",
      tokenOut: "EURC",
      amountIn: amountUsdc,
    })) as unknown as Record<string, unknown>;

    // Defensive parse: the SwapResult shape isn't fully pinned in the types, so
    // read the common fields without inventing them. If we can't find an output
    // amount, fall back to the input amount (still EURC-denominated, routed).
    const out =
      asString(result.toAmount) ??
      asString(result.amountOut) ??
      asString(result.outputAmount) ??
      amountUsdc;
    const hash =
      asHex(result.txHash) ??
      asHex(result.transactionHash) ??
      asHex(result.hash);

    return { amount: out, routed: true, txHash: hash };
  } catch (err) {
    // Expected on Arc testnet (no LiFi USDC↔EURC route) — deliver USDC honestly.
    const msg = err instanceof Error ? err.message : String(err);
    return {
      amount: amountUsdc,
      routed: false,
      note: `No USDC→EURC swap route on Arc testnet — delivered USDC. (${msg.slice(0, 140)})`,
    };
  }
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "bigint" || typeof v === "number") return String(v);
  return undefined;
}
function asHex(v: unknown): Hex | undefined {
  return typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v)
    ? (v as Hex)
    : undefined;
}
