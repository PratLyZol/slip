/**
 * Slip configuration + demo-mode gate.
 *
 * Demo mode is FIRST-CLASS (see AGENTS.md). The whole product — send, claim, FX,
 * privacy proof, batch — must work with zero credentials. Real adapters only
 * activate when the relevant env keys are present.
 */

/** Dynamic environment id (public, safe in the client bundle). */
export const DYNAMIC_ENV_ID = process.env.NEXT_PUBLIC_DYNAMIC_ENV_ID;

/**
 * Unlink app id (public). Required by the Unlink SDK to namespace derived
 * identities. Safe in the client bundle (it is a tenant label, not a secret).
 */
export const UNLINK_APP_ID = process.env.NEXT_PUBLIC_UNLINK_APP_ID ?? "slip";

/**
 * Unlink admin API key (server-only — NEVER bundled to the client). The
 * custodial Unlink client needs a backend that can register users + issue
 * authorization tokens; without this key there is no real Unlink backend to
 * talk to, so the real shield path degrades to the direct settle fallback
 * (PRD §8: privacy behind a flag must never block the end-to-end send).
 */
export const UNLINK_API_KEY = process.env.UNLINK_API_KEY;

/**
 * True when the REAL Unlink privacy path is available: not in demo mode AND an
 * admin key is present. When false, demo mode simulates the shielded legs, or —
 * if real creds for OTHER adapters exist but Unlink's don't — the engine
 * degrades to direct settle with the shield marked "skipped (flag)".
 */
export function isUnlinkConfigured(): boolean {
  return !isDemoMode() && !!UNLINK_API_KEY;
}

/**
 * Demo mode has been REMOVED — the app is real-only. This always returns false
 * so every adapter takes its real path (real wallet, real CCTP bridge, real
 * Unlink/FX). Real integrations surface honest errors when their credentials are
 * absent rather than silently simulating. Kept as a single function so the (now
 * unreachable) sim branches still compile; they can be deleted as cleanup.
 */
export function isDemoMode(): boolean {
  return false;
}

/**
 * Dynamic server API token (server-only — NEVER bundled to the client). The
 * `dyn_…` token authorizes the backend pregen route (`waas/create`) and wallet
 * lookups. Without it the real recipient-address derivation has no Dynamic
 * backend to call, so pregen degrades to the deterministic demo address.
 */
export const DYNAMIC_API_TOKEN = process.env.DYNAMIC_API_TOKEN;

/**
 * Funded Base Sepolia EOA private key (server-only — NEVER bundled to the
 * client). Signs the CCTP burn that aggregates Σ(amounts) from Base Sepolia to
 * Arc testnet. Absent, the bridge leg runs as a deterministic simulation.
 */
export const CCTP_PRIVATE_KEY = process.env.CCTP_PRIVATE_KEY;

/**
 * Circle StableFX API key (server-only — NEVER bundled to the client). Drives
 * the real USDC→EURC conversion at claim time via Circle StableFX on Arc.
 * Contact-a-rep (sales@circle.com), so it may be absent; when missing the FX
 * path falls back to Swap Kit, then to the deterministic sim.
 */
export const CIRCLE_STABLEFX_API_KEY = process.env.CIRCLE_STABLEFX_API_KEY;

/** StableFX REST base URL (override for sandbox vs prod). */
export const CIRCLE_STABLEFX_API_BASE =
  process.env.CIRCLE_STABLEFX_API_BASE ?? "https://api.circle.com";

/**
 * Circle Kit key (server-only — NEVER bundled to the client). Powers the Swap
 * Kit fallback FX leg (real on-chain USDC→EURC). Absent, FX falls back to the
 * deterministic simulation.
 */
export const CIRCLE_KIT_KEY = process.env.CIRCLE_KIT_KEY;

/** Optional Base Sepolia RPC override (server-only). Falls back to the SDK default. */
export const BASE_SEPOLIA_RPC_URL = process.env.BASE_SEPOLIA_RPC_URL;

/**
 * True when the REAL Dynamic pregen path is available: not in demo mode AND
 * both the public env id and the server token are present. When false, the
 * pregen route returns a deterministic demo address.
 */
export function isPregenConfigured(): boolean {
  return !isDemoMode() && !!DYNAMIC_ENV_ID && !!DYNAMIC_API_TOKEN;
}

/**
 * True when the REAL CCTP bridge path is available: not in demo mode AND a
 * funded Base Sepolia signer key is present. When false, the bridge leg is
 * simulated deterministically.
 */
export function isBridgeConfigured(): boolean {
  return !isDemoMode() && !!CCTP_PRIVATE_KEY;
}

/**
 * True when the REAL StableFX path is available: not in demo mode AND a Circle
 * StableFX key is present. When false, FX cascades to Swap Kit then the sim.
 */
export function isStableFxConfigured(): boolean {
  return !isDemoMode() && !!CIRCLE_STABLEFX_API_KEY;
}

/**
 * True when the REAL Swap Kit fallback FX path is available: not in demo mode
 * AND a Circle Kit key is present. When false, FX falls back to the sim.
 */
export function isSwapConfigured(): boolean {
  return !isDemoMode() && !!CIRCLE_KIT_KEY;
}

