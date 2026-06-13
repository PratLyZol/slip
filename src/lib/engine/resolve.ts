/**
 * Step 1 — Resolve: recipient name/username → identity/address.
 *
 * For now every name maps to a deterministic demo address. ENS public-resolver
 * reads (name → address via raw eth_call / viem, NO ENS SDK per AGENTS.md) land
 * later — the hook is marked clearly below.
 */

import { keccak256, toHex, getAddress, type Address } from "viem";
import { simLatency, sleep } from "../demo/sim";
import type { ResolveResult } from "./types";

/** Deterministically map any handle to a stable, valid-looking demo address. */
export function demoAddressFor(recipient: string): Address {
  const hash = keccak256(toHex(`slip:resolve:${recipient.trim().toLowerCase()}`));
  // Take the last 20 bytes (40 hex chars) as the address body.
  return getAddress(`0x${hash.slice(-40)}`);
}

/**
 * Resolve a recipient handle to an address.
 *
 * Demo + real currently share the deterministic mapping. When a handle ends in
 * `.eth`, a future agent should do an ENS public-resolver read here:
 *
 *   // NOT YET WIRED — ENS public-resolver read (raw eth_call via viem, no SDK)
 *   if (recipient.endsWith(".eth")) { ...namehash + resolver.addr(node)... }
 */
export async function resolve(recipient: string): Promise<ResolveResult> {
  await sleep(simLatency(300, 700));

  // ENS hook (Phase 6, optional). Intentionally falls through to demo mapping.
  if (recipient.trim().toLowerCase().endsWith(".eth")) {
    // NOT YET WIRED — ENS public-resolver read lands in a later phase.
    // For now .eth names resolve via the same deterministic demo mapping.
  }

  return { address: demoAddressFor(recipient), via: "demo" };
}
