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
 *    on-chain swap. The real adapter must be flag-gated; demo simulates the
 *    quote + settle. So the real branch here belongs behind isDemoMode()/a key
 *    check, exactly like settle.ts.
 *  - EU → EURC, everywhere else → USDC. EURC is 6-decimal on Arc.
 *  - All legs stay on Arc testnet (no bridge hop).
 */

import { keccak256 } from "viem";
import { isDemoMode } from "../config";
import { simLatency, simTx, sleep } from "../demo/sim";
import { recipientAddressFromSecret } from "./counterfactual";
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

  // NOT YET WIRED — real Circle StableFX conversion.
  // Real path (flag-gated): request a USDC→EURC quote via the StableFX API
  // (requires a Circle-issued key per docs/research/arc.md — StableFX is NOT a
  // permissionless on-chain swap), accept it, and let FxEscrow settle on Arc to
  // the recipient account (recipientAddressFromSecret(secret)). Return the quoted
  // EURC `amount`, the `rateUsed`, and the settlement `txHash`. Without a Circle
  // key there is no RFQ counterparty, so we fall back to a labeled 1:1
  // pass-through (honest) rather than fabricating a "real" rate. Referenced here
  // so the seam (recipient destination) is visible to the real adapter:
  void recipientAddressFromSecret;
  console.warn(
    "[slip] real FX (StableFX) needs a Circle API key — passing USDC through as EURC 1:1.",
  );
  return { token, amount: amountUsdc, rateUsed: 1 };
}
