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

/** A believable fixed balance shown to the demo sender (USDC, human units). */
export const DEMO_USDC_BALANCE = 1283.5;

/** Demo sender identity surfaced in the "logged in" chrome. */
export const DEMO_SENDER = {
  name: "Demo Sender",
  email: "demo@slip.cash",
  /** Deterministic, obviously-fake demo EOA. */
  address: "0x5117De0000000000000000000000000000000001" as const,
};
