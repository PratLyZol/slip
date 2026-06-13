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
 * True when we should run every adapter in deterministic simulated mode.
 *
 * Demo mode is on when EITHER:
 *  - NEXT_PUBLIC_DEMO_MODE=true is explicitly set, OR
 *  - NEXT_PUBLIC_DYNAMIC_ENV_ID is missing (no real wallet backend to talk to).
 *
 * Kept as a single source of truth so adapters never branch on env vars directly.
 */
export function isDemoMode(): boolean {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") return true;
  if (!DYNAMIC_ENV_ID) return true;
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
 * Circle StableFX API key (server-only — NEVER bundled to the client). Format
 * `PREFIX:ID:SECRET`. Contact-a-rep (sales@circle.com), so it may be absent;
 * when missing the primary FX path falls back to Swap Kit, then to the sim.
 */
export const STABLEFX_API_KEY = process.env.STABLEFX_API_KEY;

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
  return !isDemoMode() && !!STABLEFX_API_KEY;
}

/**
 * True when the REAL Swap Kit fallback FX path is available: not in demo mode
 * AND a Circle Kit key is present. When false, FX falls back to the sim.
 */
export function isSwapConfigured(): boolean {
  return !isDemoMode() && !!CIRCLE_KIT_KEY;
}

/** A believable fixed balance shown to the demo sender (USDC, human units). */
export const DEMO_USDC_BALANCE = 1283.5;

/** Demo sender identity surfaced in the "logged in" chrome. */
export const DEMO_SENDER = {
  name: "Demo Sender",
  email: "demo@slip.cash",
  /** Deterministic, obviously-fake demo EOA. */
  address: "0x5117De0000000000000000000000000000000001" as const,
};
