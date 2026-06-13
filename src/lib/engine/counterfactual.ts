/**
 * Step 3 — Counterfactual account: claim secret → deterministic recipient address.
 *
 * PRD §3: "Salt = claim secret." The QR/link encodes a per-claim secret that
 * deterministically derives the recipient's account address. Whoever holds the
 * link can claim (hackathon-grade).
 *
 * Implementation: we derive a private key from the 32-byte secret (keccak so the
 * key is well-distributed even if the secret were ever weak) and take the
 * matching EOA address via viem's `privateKeyToAccount`. A later agent can swap
 * this for a true ERC-4337 CREATE2 `initCode` address using the same secret as
 * the salt — the interface (secret → address) is unchanged.
 */

import { keccak256, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { CounterfactualResult } from "./types";

/** Generate a fresh 32-byte claim secret (CSPRNG). */
export function generateClaimSecret(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex as Hex;
}

/** Derive the deterministic counterfactual address from a claim secret. */
export function addressFromSecret(secret: Hex): Address {
  // keccak(secret) → a uniformly-distributed 32-byte private key.
  const privateKey = keccak256(secret);
  return privateKeyToAccount(privateKey).address;
}

/**
 * Step 3 entry point: derive the (not-yet-deployed) counterfactual account.
 * Synchronous math, but async to keep the engine step signatures uniform.
 */
export async function deriveCounterfactual(
  secret: Hex,
): Promise<CounterfactualResult> {
  return { address: addressFromSecret(secret), deployed: false };
}
