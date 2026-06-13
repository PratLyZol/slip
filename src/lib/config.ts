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
 * Circle StableFX API key (server-only — NEVER bundled to the client). Drives
 * the real USDC→EURC conversion at claim time via Circle StableFX on Arc.
 * NO per-adapter feature flag: when NOT in demo mode the FX adapter runs the
 * real StableFX REST flow and surfaces honest errors; demo mode simulates.
 */
export const CIRCLE_STABLEFX_API_KEY = process.env.CIRCLE_STABLEFX_API_KEY;

/** StableFX REST base URL (override for sandbox vs prod). */
export const CIRCLE_STABLEFX_API_BASE =
  process.env.CIRCLE_STABLEFX_API_BASE ?? "https://api.circle.com";

/**
 * Funded Base Sepolia EOA private key (server-only) that pays for the CCTP
 * burn when aggregating funds onto Arc. NO per-adapter flag: real mode bridges
 * for real via CCTP; demo mode simulates the bridge.
 */
export const CCTP_PRIVATE_KEY = process.env.CCTP_PRIVATE_KEY;

/** A believable fixed balance shown to the demo sender (USDC, human units). */
export const DEMO_USDC_BALANCE = 1283.5;

/** Demo sender identity surfaced in the "logged in" chrome. */
export const DEMO_SENDER = {
  name: "Demo Sender",
  email: "demo@slip.cash",
  /** Deterministic, obviously-fake demo EOA. */
  address: "0x5117De0000000000000000000000000000000001" as const,
};
