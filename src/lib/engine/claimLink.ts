/**
 * Claim-link codec — shared by the send flow (encode) and the claim page (decode).
 *
 * Format: `/claim#<base64url(JSON ClaimPayload)>` (AGENTS.md).
 * The secret rides in the URL FRAGMENT only — it never hits the network/server.
 *
 * This module is deliberately dependency-light and isomorphic (browser + node)
 * so the smoke script and both pages can share it.
 */

import { CLAIM_PAYLOAD_VERSION, type ClaimPayload } from "./types";

/** base64url encode a UTF-8 string (browser + node safe). */
function base64urlEncode(input: string): string {
  let b64: string;
  if (typeof Buffer !== "undefined") {
    b64 = Buffer.from(input, "utf-8").toString("base64");
  } else {
    // Browser path.
    const bytes = new TextEncoder().encode(input);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    b64 = btoa(binary);
  }
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url decode to a UTF-8 string (browser + node safe). */
function base64urlDecode(input: string): string {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const padded = b64 + pad;
  if (typeof Buffer !== "undefined") {
    return Buffer.from(padded, "base64").toString("utf-8");
  }
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Encode a ClaimPayload into the fragment string (no leading `#`). */
export function encodeClaimFragment(payload: ClaimPayload): string {
  return base64urlEncode(JSON.stringify(payload));
}

/**
 * Build the relative claim path: `/claim#<fragment>`.
 * Use {@link buildClaimUrl} for an absolute URL (QR codes need absolute).
 */
export function buildClaimPath(payload: ClaimPayload): string {
  return `/claim#${encodeClaimFragment(payload)}`;
}

/** Build an absolute claim URL given an origin (for QR codes / sharing). */
export function buildClaimUrl(payload: ClaimPayload, origin: string): string {
  const trimmed = origin.replace(/\/$/, "");
  return `${trimmed}${buildClaimPath(payload)}`;
}

/** Outcome of decoding a claim fragment. */
export type DecodeResult =
  | { ok: true; payload: ClaimPayload }
  | { ok: false; error: string };

/** Decode + validate a fragment (with or without leading `#`). */
export function decodeClaimFragment(fragment: string): DecodeResult {
  const frag = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  if (!frag) return { ok: false, error: "Missing claim data." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(base64urlDecode(frag));
  } catch {
    return { ok: false, error: "This claim link is malformed." };
  }

  const v = validateClaimPayload(parsed);
  if (!v.ok) return v;
  return { ok: true, payload: v.payload };
}

/** Structural validation of a decoded value as a ClaimPayload. */
function validateClaimPayload(value: unknown): DecodeResult {
  if (typeof value !== "object" || value === null) {
    return { ok: false, error: "This claim link is malformed." };
  }
  const p = value as Record<string, unknown>;

  if (typeof p.v !== "number") {
    return { ok: false, error: "This claim link is malformed." };
  }
  if (p.v !== CLAIM_PAYLOAD_VERSION) {
    return { ok: false, error: "This claim link is from an unsupported version." };
  }
  if (typeof p.secret !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(p.secret)) {
    return { ok: false, error: "This claim link is missing its secret." };
  }
  if (typeof p.amountUsdc !== "string" || p.amountUsdc.length === 0) {
    return { ok: false, error: "This claim link is missing an amount." };
  }
  if (typeof p.createdAt !== "string") {
    return { ok: false, error: "This claim link is malformed." };
  }
  if (p.senderName !== undefined && typeof p.senderName !== "string") {
    return { ok: false, error: "This claim link is malformed." };
  }
  if (p.region !== undefined && p.region !== "US" && p.region !== "EU") {
    return { ok: false, error: "This claim link is malformed." };
  }

  return {
    ok: true,
    payload: {
      v: p.v,
      secret: p.secret as ClaimPayload["secret"],
      amountUsdc: p.amountUsdc,
      senderName: p.senderName as string | undefined,
      region: p.region as ClaimPayload["region"],
      createdAt: p.createdAt,
    },
  };
}
