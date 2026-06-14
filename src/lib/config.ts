/**
 * Slip configuration + real-adapter gates.
 *
 * The app is REAL-ONLY (see AGENTS.md): there is no demo/simulation fallback.
 * Each integration activates from its own env key/credential, and when a
 * required key is absent the adapter surfaces an HONEST error rather than
 * silently simulating. The gates below report which real paths are wired.
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
 * True when the REAL Unlink privacy path is available: an admin key is present.
 * When false — if real creds for OTHER adapters exist but Unlink's don't — the
 * engine degrades to direct settle with the shield marked "skipped (flag)".
 */
export function isUnlinkConfigured(): boolean {
  return !!UNLINK_API_KEY;
}

/**
 * Dynamic server API token (server-only — NEVER bundled to the client). The
 * `dyn_…` token authorizes the backend pregen route (`waas/create`) and wallet
 * lookups. Without it the real recipient-address derivation has no Dynamic
 * backend to call, so the pregen route surfaces an honest error.
 */
export const DYNAMIC_API_TOKEN = process.env.DYNAMIC_API_TOKEN;

/**
 * NOTE: the CCTP bridge is now WALLET-SIGNED (the connected wallet signs the
 * burn on Base Sepolia, client-side) — there is no longer a server-held
 * `CCTP_PRIVATE_KEY`, and the bridge has no env-key gate. See aggregate.ts /
 * adapters/bridge.ts.
 */

/**
 * Circle StableFX API key (server-only — NEVER bundled to the client). Drives
 * the real USDC→EURC conversion at claim time via Circle StableFX on Arc.
 * Contact-a-rep (sales@circle.com), so it may be absent; when missing the FX
 * path falls back to Swap Kit.
 */
export const CIRCLE_STABLEFX_API_KEY = process.env.CIRCLE_STABLEFX_API_KEY;

/** StableFX REST base URL (override for sandbox vs prod). */
export const CIRCLE_STABLEFX_API_BASE =
  process.env.CIRCLE_STABLEFX_API_BASE ?? "https://api.circle.com";

/**
 * Circle Kit key (server-only — NEVER bundled to the client). Powers the Swap
 * Kit fallback FX leg (real on-chain USDC→EURC).
 */
export const CIRCLE_KIT_KEY = process.env.CIRCLE_KIT_KEY;

/** Optional Base Sepolia RPC override (server-only). Falls back to the SDK default. */
export const BASE_SEPOLIA_RPC_URL = process.env.BASE_SEPOLIA_RPC_URL;

/**
 * Email delivery (server-only) — used by /api/notify to email the recipient
 * their claim link. Resend REST API (no SDK). Without the key the route returns
 * an honest 501 (never silently "succeeds"). `EMAIL_FROM` defaults to Resend's
 * shared test sender, which only delivers to your own verified address — set a
 * verified-domain from-address to email anyone (e.g. a friend) for the demo.
 */
export const RESEND_API_KEY = process.env.RESEND_API_KEY;
export const EMAIL_FROM = process.env.EMAIL_FROM ?? "Slip <onboarding@resend.dev>";

/**
 * True when the REAL Dynamic pregen path is available: both the public env id
 * and the server token are present. When false, the pregen route surfaces an
 * honest error rather than producing a keyless address.
 */
export function isPregenConfigured(): boolean {
  return !!DYNAMIC_ENV_ID && !!DYNAMIC_API_TOKEN;
}

/**
 * CRITICAL SAFETY GATE (Task #2). True only when the recipient's payout address
 * is guaranteed to be a REAL, OTP-claimable wallet — i.e. when the real Dynamic
 * pregen path is configured ({@link isPregenConfigured}).
 *
 * When this is FALSE, the pregen route cannot produce a real, claimable payout
 * address. Sending REAL shielded USDC to anything else means the funds are lost
 * forever. The real Unlink unshield/withdraw MUST refuse unless this returns
 * true (see adapters/unlink.ts `unshield` + engine/claim.ts). This is the
 * single source of truth for "is it safe to send real funds to the recipient
 * address?".
 *
 * It is deliberately INDEPENDENT of whether Unlink itself is configured: even a
 * fully-real Unlink withdraw must never fire to a recipient with no claimable key.
 */
export function isRealPayoutSafe(): boolean {
  return isPregenConfigured();
}

/**
 * True when the REAL StableFX path is available: a Circle StableFX key is
 * present. When false, FX cascades to Swap Kit.
 */
export function isStableFxConfigured(): boolean {
  return !!CIRCLE_STABLEFX_API_KEY;
}

/**
 * True when the REAL Swap Kit fallback FX path is available: a Circle Kit key
 * is present.
 */
export function isSwapConfigured(): boolean {
  return !!CIRCLE_KIT_KEY;
}
