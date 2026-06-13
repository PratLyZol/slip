/**
 * Step 1 — Resolve: recipient name/username → identity/address.
 *
 * Two paths:
 *  - `.eth` names → a REAL ENS public-resolver read on Ethereum mainnet via
 *    viem's built-in `getEnsAddress` (namehash → resolver → addr). NO ENS SDK —
 *    viem is plumbing, not a sponsor SDK (AGENTS.md: "ENS is used only as a plain
 *    public-resolver read"). On any network failure / unset name, we degrade
 *    gracefully to the deterministic demo mapping with a note, so a flaky RPC
 *    never blocks a send.
 *  - everything else → the existing deterministic demo mapping (a name always
 *    maps to the same plausible address, no network).
 */

import {
  createPublicClient,
  http,
  keccak256,
  toHex,
  getAddress,
  type Address,
} from "viem";
import { mainnet } from "viem/chains";
import { simLatency, sleep } from "../demo/sim";
import type { ResolveResult } from "./types";

/**
 * Public Ethereum mainnet RPCs for ENS reads (no key required). Tried in order;
 * the first that answers wins. Multiple endpoints because public RPCs rate-limit
 * / Cloudflare-gate intermittently — the privacy demo must never hinge on one.
 */
const ENS_RPC_URLS = [
  "https://cloudflare-eth.com",
  "https://ethereum-rpc.publicnode.com",
  "https://eth.llamarpc.com",
];
/** Hard cap on each ENS read so a slow/dead RPC never stalls a send. */
const ENS_TIMEOUT_MS = 4000;

/** Deterministically map any handle to a stable, valid-looking demo address. */
export function demoAddressFor(recipient: string): Address {
  const hash = keccak256(toHex(`slip:resolve:${recipient.trim().toLowerCase()}`));
  // Take the last 20 bytes (40 hex chars) as the address body.
  return getAddress(`0x${hash.slice(-40)}`);
}

/** True when a handle is an ENS name we should attempt a real resolution for. */
export function isEnsName(recipient: string): boolean {
  return recipient.trim().toLowerCase().endsWith(".eth");
}

/**
 * Real ENS public-resolver read via viem (namehash → resolver → addr). Returns
 * the checksummed address, or null if the name is unregistered / has no addr
 * record. Throws on network failure (caller degrades).
 *
 * `getEnsAddress` is viem's built-in resolver read — it performs the raw
 * `eth_call`s against the ENS registry + public resolver under the hood. No ENS
 * SDK is added; this is the same chain plumbing (viem) used everywhere else.
 */
export async function ensResolve(name: string): Promise<Address | null> {
  const normalized = name.trim().toLowerCase();
  let lastErr: unknown;
  for (const url of ENS_RPC_URLS) {
    try {
      const client = createPublicClient({
        chain: mainnet,
        transport: http(url, { timeout: ENS_TIMEOUT_MS }),
      });
      const addr = await client.getEnsAddress({ name: normalized });
      return addr ?? null;
    } catch (err) {
      lastErr = err;
      // Try the next public RPC.
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("All ENS RPCs failed.");
}

/**
 * Resolve a recipient handle to an address.
 *
 * `.eth` → real ENS read (graceful demo fallback on failure). Otherwise → the
 * deterministic demo mapping. The `via` / `note` fields let the UI show how the
 * name was resolved ("alice.eth → 0x1234…abcd").
 */
export async function resolve(recipient: string): Promise<ResolveResult> {
  if (isEnsName(recipient)) {
    try {
      const addr = await ensResolve(recipient);
      if (addr) {
        return { address: addr, via: "ens" };
      }
      // Registered-looking name with no address record → fall back, note it.
      await sleep(simLatency(150, 350));
      return {
        address: demoAddressFor(recipient),
        via: "demo",
        note: "no ENS address record — using a demo address",
      };
    } catch (err) {
      // Network / RPC failure: never block the send. Degrade to demo mapping.
      const reason = err instanceof Error ? err.message : "ENS lookup failed";
      if (process.env.NODE_ENV !== "production") {
        console.warn(`[slip] ENS resolve failed for ${recipient} — using demo address. (${reason})`);
      }
      return {
        address: demoAddressFor(recipient),
        via: "demo",
        note: "ENS lookup unavailable — using a demo address",
      };
    }
  }

  // Non-.eth handle: deterministic demo mapping (no network).
  await sleep(simLatency(300, 700));
  return { address: demoAddressFor(recipient), via: "demo" };
}
