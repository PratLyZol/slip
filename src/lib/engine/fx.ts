/**
 * FX at CLAIM time (PRD §2 step 7, §3) — the conversion hook.
 *
 * This is the explicit Phase 4 seam. The claim pipeline calls {@link fxAtClaim}
 * between the withdraw and the done step. RIGHT NOW it is a pass-through: USDC
 * stays USDC at rate 1.0, with no settlement tx. Phase 4 fills the real body
 * (Circle StableFX) WITHOUT changing this signature.
 *
 * Frozen interface (do not change the shape, only the body):
 *   fxAtClaim(amountUsdc, region) => { token, amount, rateUsed?, txHash? }
 *
 * Constraints the Phase 4 agent inherits (from docs/research/arc.md):
 *  - StableFX requires a Circle-issued API key — it is NOT a permissionless
 *    on-chain swap. Selection is on the GLOBAL isDemoMode() ONLY (user
 *    directive: NO per-adapter flag). Demo simulates the quote + settle; real
 *    mode runs the real StableFX REST flow via the /api/fx route (so the key +
 *    taker signing key stay server-side).
 *  - EU → EURC, everywhere else → USDC. EURC is 6-decimal on Arc.
 *  - All legs stay on Arc testnet (no bridge hop).
 */

import { keccak256 } from "viem";
import { isDemoMode } from "../config";
import { simLatency, simTx, sleep } from "../demo/sim";
import type { FxResult, Region } from "./types";
import type { Hex } from "viem";

/** Local stablecoin symbol for a region. EU → EURC, otherwise → USDC. */
export function localTokenForRegion(region: Region | undefined): string {
  return region === "EU" ? "EURC" : "USDC";
}

/**
 * Deterministic, realistic USDC→EURC rate derived from the claim secret, so
 * re-renders and the smoke run always agree. Models a StableFX RFQ quote: a
 * mid-market EUR/USD around 0.92 (so 1 USDC ≈ 0.92 EURC), jittered per-secret
 * into a believable 0.910–0.930 band, with a small LP spread already baked in.
 */
function quoteUsdcToEurc(secret: Hex): number {
  // Map keccak(secret)'s first bytes to a [0,1) fraction.
  const h = keccak256(secret).slice(2, 10); // 4 bytes
  const frac = parseInt(h, 16) / 0xffffffff;
  // 0.910 + up to 0.020 → 0.910–0.930.
  const rate = 0.91 + frac * 0.02;
  // Round to 4 dp for a quote-like figure.
  return Math.round(rate * 10000) / 10000;
}

/**
 * Convert a settled USDC amount into the recipient's local stablecoin.
 *
 * @param amountUsdc human-units USDC string (e.g. "50.00")
 * @param region     recipient region; drives the target token
 * @param secret     the claim secret (folds into the simulated FX tx hash)
 * @returns the token + amount the recipient actually receives
 *
 * PHASE 2 BEHAVIOUR: pass-through. If the target token IS USDC (US region),
 * there is nothing to convert — return USDC unchanged, no tx. If the target is
 * EURC, Phase 2 still passes the *amount* through unchanged (rate 1.0) and adds
 * NO real conversion — Phase 4 wires the real StableFX quote here. We keep the
 * token label honest (EURC) so the recipient UI already reads correctly, but we
 * do not fabricate a fake FX rate.
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

  // EU / EURC: convert USDC → EURC at a StableFX-style RFQ rate.
  if (isDemoMode()) {
    // Simulate the StableFX RFQ: deterministic quote + on-chain PvP settle.
    await sleep(simLatency(400, 900));
    const rate = quoteUsdcToEurc(secret);
    const converted = (Number(amountUsdc) * rate).toFixed(2);
    const settleTx = simTx("fx", token, converted, secret);
    return {
      token,
      amount: converted,
      rateUsed: rate,
      txHash: settleTx.hash,
    };
  }

  // REAL — Circle StableFX USDC→EURC at claim time.
  //
  // The actual REST flow (quote → sign EIP-712 → trade → funding presign → sign
  // → fund → poll) + the EIP-712 signing live in adapters/fx-stablefx.ts, run
  // behind the /api/fx route so the StableFX API key and the taker's signing key
  // (derived from `secret`) never reach the browser. We POST the inputs and read
  // back the honest result — including the case where a TEST-key trade legitimately
  // stalls at `taker_funded` (sandbox, no maker; PLAN §8). The recipient
  // destination is recipientAddressFromSecret(secret), computed server-side in the
  // route from `secret`. On any failure we throw an HONEST error (the claim
  // pipeline degrades visibly) — we do NOT mask it as a fake conversion.
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
 * Real-mode FX: POST the claim inputs to /api/fx, which runs the StableFX taker
 * flow server-side. Relative URL — this runs in the recipient's browser during a
 * real claim. Throws an honest error on a non-OK response rather than masking it.
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
    throw new Error(
      data.error ?? `[slip] StableFX FX route failed (${res.status}).`,
    );
  }
  if (data.note) {
    console.warn(`[slip] StableFX: ${data.note}`);
  }
  return {
    token: data.token ?? token,
    amount: data.amount,
    rateUsed: data.rate,
    txHash: data.txHash,
  };
}
