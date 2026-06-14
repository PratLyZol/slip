/**
 * Local currency at CLAIM time (PLAN §9) — a direct DESTINATION-TOKEN choice,
 * NOT a fabricated swap. EU recipient → EURC, everyone else → USDC. The recipient
 * receives the real coin; we never invent an FX rate or a settlement tx.
 *
 * Two real outcomes:
 *  - USDC (non-EU): genuine no-op — the withdrawn USDC is already what they get.
 *  - EURC (EU): POST /api/fx, which runs the real Circle Swap Kit USDC→EURC on
 *    Arc (server-side, so the kit key + the taker's signing key never reach the
 *    browser). If there is no live route on Arc testnet, the route HONESTLY
 *    returns USDC (with a note) rather than faking EURC. Either way the result is
 *    real — a real swap tx, or real USDC delivered — with no fabricated rate.
 *
 * StableFX is DROPPED (PLAN §10): no contact-a-rep key, no simulated quote. There
 * is no demo/sim branch here — a failure surfaces as an honest thrown error.
 */

import type { FxResult, Region } from "./types";
import type { Hex } from "viem";

/** Local stablecoin symbol for a region. EU → EURC, otherwise → USDC. */
export function localTokenForRegion(region: Region | undefined): string {
  return region === "EU" ? "EURC" : "USDC";
}

/**
 * Deliver the recipient's local stablecoin for `region`.
 *
 * @param amountUsdc human-units USDC string (e.g. "50.00")
 * @param region     recipient region; drives the destination token
 * @param secret     the claim secret (signs the real swap, server-side, for EU)
 * @returns the token + amount the recipient actually receives
 *
 * No fabrication: USDC is a true pass-through (rate 1, no tx); EURC runs the real
 * swap route, which returns either a real EURC swap (rate + txHash) or — when no
 * route exists on testnet — real USDC, honestly labeled.
 */
export async function fxAtClaim(
  amountUsdc: string,
  region: Region | undefined,
  secret: Hex,
): Promise<FxResult> {
  const token = localTokenForRegion(region);

  // US / USDC: genuine no-op, no FX leg at all.
  if (token === "USDC") {
    return { token, amount: amountUsdc, rateUsed: 1 };
  }

  // EU / EURC: deliver the real destination token via the server FX route (real
  // Circle Swap Kit USDC→EURC, or an honest USDC fallback when unrouted).
  return realFxViaRoute(token, amountUsdc, region, secret);
}

/** Response shape of POST /api/fx (see src/app/api/fx/route.ts). */
interface FxRouteResponse {
  ok: boolean;
  token?: string;
  amount?: string;
  rate?: number;
  txHash?: Hex;
  status?: string;
  note?: string;
  error?: string;
}

/**
 * Real-mode FX: POST the claim inputs to /api/fx, which runs the real Swap Kit
 * USDC→EURC flow server-side (or an honest USDC fallback). Relative URL — this
 * runs in the recipient's browser during a real claim. Throws an honest error on
 * a non-OK response rather than masking it as a fabricated conversion.
 */
async function realFxViaRoute(
  token: string,
  amountUsdc: string,
  region: Region | undefined,
  secret: Hex,
): Promise<FxResult> {
  const res = await fetch("/api/fx", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, region, amountUsdc }),
  });
  const data = (await res.json().catch(() => ({}))) as FxRouteResponse;
  if (!res.ok || !data.ok || data.amount === undefined) {
    throw new Error(data.error ?? `[slip] FX route failed (${res.status}).`);
  }
  if (data.note) {
    console.warn(`[slip] FX: ${data.note}`);
  }
  return {
    token: data.token ?? token,
    amount: data.amount,
    rateUsed: data.rate,
    txHash: data.txHash,
  };
}
