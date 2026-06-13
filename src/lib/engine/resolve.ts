/**
 * Step 1 — Resolve: recipient identifier → payout address.
 *
 * Three paths:
 *  - email / phone → a Dynamic PREGEN payout address via `POST /api/pregen`
 *    (Track A owns that route; it pre-generates a stable embedded wallet for the
 *    identifier and returns its EVM address). This is the real walletless-payout
 *    path: the recipient claims by OTP login and auto-associates that wallet. On
 *    any failure we degrade to the deterministic demo mapping so a send never
 *    blocks (PRD §8). `via` stays "demo" (the frozen ResolveResult only allows
 *    "demo" | "ens"); a `note` records that it came from Dynamic pregen.
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

/** True when a handle looks like an email address (heuristic: contains "@"). */
export function isEmail(recipient: string): boolean {
  const v = recipient.trim();
  return v.includes("@") && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
}

/**
 * True when a handle looks like a phone number (heuristic): a leading "+" or a
 * value that is mostly digits once separators are stripped (≥7 digits). Plain
 * names never match — they have letters and no leading "+".
 */
export function isPhone(recipient: string): boolean {
  const v = recipient.trim();
  if (!v) return false;
  const digits = v.replace(/[\s\-().]/g, "");
  if (v.startsWith("+")) return /^\+\d{7,15}$/.test(digits);
  return /^\d{7,15}$/.test(digits);
}

/**
 * Resolve an email/phone identifier to its Dynamic PREGEN payout address via
 * `POST /api/pregen` (Track A). Returns the checksummed address. Throws on any
 * network / non-OK response so the caller degrades to the demo mapping.
 *
 * The route mirrors `PregenOps.pregenAddress` (engine/types.ts): it returns
 * `{ address, existed }`. We only need the address here.
 */
export async function pregenResolve(identifier: string): Promise<Address> {
  const res = await fetch("/api/pregen", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier }),
  });
  if (!res.ok) {
    throw new Error(`pregen route ${res.status}`);
  }
  const body = (await res.json()) as { address?: string };
  if (typeof body.address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(body.address)) {
    throw new Error("pregen route returned no address");
  }
  return getAddress(body.address);
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
 * email/phone → Dynamic pregen payout address (graceful demo fallback). `.eth` →
 * real ENS read (graceful demo fallback on failure). Otherwise → the
 * deterministic demo mapping. The `via` / `note` fields let the UI show how the
 * name was resolved ("alice.eth → 0x1234…abcd").
 */
export async function resolve(recipient: string): Promise<ResolveResult> {
  // Email / phone → Dynamic pregen embedded wallet (the real walletless payout
  // target). `via` is "demo" (ResolveResult only allows "demo" | "ens"); the
  // note distinguishes a real pregen hit from the plain demo mapping.
  if (isEmail(recipient) || isPhone(recipient)) {
    try {
      const addr = await pregenResolve(recipient);
      return { address: addr, via: "demo", note: "via Dynamic pregen" };
    } catch (err) {
      // Never block the send on the pregen route — degrade to the demo mapping.
      const reason = err instanceof Error ? err.message : "pregen lookup failed";
      if (process.env.NODE_ENV !== "production") {
        console.warn(`[slip] pregen resolve failed for ${recipient} — using demo address. (${reason})`);
      }
      return {
        address: demoAddressFor(recipient),
        via: "demo",
        note: "pregen unavailable — using a demo address",
      };
    }
  }

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
