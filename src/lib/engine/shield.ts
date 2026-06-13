/**
 * Step 4 — Shield: route settlement through an Unlink shielded balance.
 *
 * THIS is the bounty leg (PRD Phase 3). Instead of a plain public USDC transfer,
 * the sender:
 *   1. deposits USDC into their OWN Unlink shielded balance (PUBLIC edge), then
 *   2. privately transfers it to the CLAIM's unlink address — the leg where the
 *      amount and the sender↔recipient edge vanish from the chain.
 *
 * The funds then sit shielded until the recipient claims (claim.ts unshields).
 *
 * The privacy path is gated and degrades safely (PRD §8): if the real Unlink
 * path throws (no funded testnet USDC, no admin key, backend hiccup), we log
 * honestly and return `enabled: false` so the engine falls back to the direct
 * settle path with the shield marked "skipped (flag)". Privacy behind a flag
 * must NEVER block the end-to-end send.
 */

import type { Hex } from "viem";
import { getShieldOps, usdcToken } from "../adapters/unlink";
import type { PrivacyArtifacts, PrivacyLeg } from "./types";

/** Outcome of the shield step: the privacy artifacts + whether it engaged. */
export interface ShieldResult {
  privacy: PrivacyArtifacts;
}

/**
 * Run the send-side shield (deposit + private transfer).
 *
 * @param amountUsdc human-units USDC string (e.g. "50.00")
 * @param secret     the claim secret — derives both Unlink accounts
 * @returns privacy artifacts. On any real-path failure, returns
 *          `{ enabled: false, skippedReason }` (caller does direct settle).
 */
export async function shield(
  amountUsdc: string,
  secret: Hex,
): Promise<ShieldResult> {
  const ops = getShieldOps();
  const token = usdcToken(amountUsdc);

  try {
    const senderUnlinkAddress = await ops.senderUnlinkAddress(secret);
    const claimUnlinkAddress = await ops.claimUnlinkAddress(secret);

    // Leg 1 — shield (deposit). PUBLIC edge.
    const depositLeg = await ops.shield(secret, token);
    // Leg 2 — private transfer to the claim's shielded address. PRIVATE middle.
    const transferLeg = await ops.privateTransfer(secret, token);

    const legs: PrivacyLeg[] = [depositLeg, transferLeg];

    return {
      privacy: {
        enabled: true,
        senderUnlinkAddress,
        claimUnlinkAddress,
        legs,
      },
    };
  } catch (err) {
    // PRD §8: degrade gracefully — never block the send on the privacy leg.
    const reason =
      err instanceof Error ? err.message : "Unlink shielded path unavailable";
    console.warn(
      `[slip] shield path failed — falling back to direct settle. (${reason})`,
    );
    return {
      privacy: {
        enabled: false,
        skippedReason: reason,
        legs: [],
      },
    };
  }
}
