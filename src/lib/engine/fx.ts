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

  // EU / EURC: Phase 2 pass-through (rate 1.0). Phase 4 replaces this branch.
  if (isDemoMode()) {
    // Simulate the StableFX settle so the receipt has a plausible tx + latency.
    await sleep(simLatency(400, 900));
    const settleTx = simTx("fx", token, amountUsdc, secret);
    return {
      token,
      amount: amountUsdc, // 1:1 until Phase 4 applies a real rate
      rateUsed: 1,
      txHash: settleTx.hash,
    };
  }

  // NOT YET WIRED — real Circle StableFX conversion.
  // Real path (Phase 4 agent): request a USDC→EURC quote via the StableFX API
  // (requires a Circle-issued key), accept it, and let FxEscrow settle on Arc to
  // the recipient account (recipientAddressFromSecret(secret)). Return the quoted
  // EURC `amount`, the `rateUsed`, and the settlement `txHash`. Until a key is
  // present, fall back to a labeled 1:1 pass-through so the demo never breaks.
  // Referenced here so the seam (recipient destination) is visible to Phase 4:
  void recipientAddressFromSecret;
  console.warn(
    "[slip] real FX (StableFX) path not wired yet — passing USDC through as EURC 1:1.",
  );
  return { token, amount: amountUsdc, rateUsed: 1 };
}
