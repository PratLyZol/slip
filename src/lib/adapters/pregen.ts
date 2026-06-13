/**
 * Pregen adapter — recipient identifier (email/phone) → pre-generated EVM payout
 * address (PRD §2 step 1, PLAN §3). This is the REAL "pregen identity" leg:
 * Dynamic mints an embedded (WaaS) wallet for the identifier server-side, so the
 * sender can pay someone who has no wallet yet — the address is deterministic
 * for that identifier and the recipient claims it later by signing in.
 *
 * Wraps the Dynamic `waas/create` REST endpoint behind the {@link PregenOps}
 * interface (engine/types.ts) so the engine never talks to Dynamic directly
 * (AGENTS.md: "SDK wiring lives ONLY in adapters"). No Dynamic SDK is added —
 * the call is a plain server-side `fetch` (no new dependency). Two impls:
 *
 *  - DEMO ({@link demoPregenOps}): deterministic `demoAddressFor(identifier)`,
 *    credential-free, so the demo stays green with zero keys. `existed: false`.
 *  - REAL ({@link realPregenOps}): the live Dynamic `waas/create` call,
 *    authorized by the SERVER-ONLY `DYNAMIC_API_TOKEN`. SERVER-ONLY — the token
 *    is a secret and must never reach the browser (see `import "server-only"`).
 *
 * `import "server-only"` poisons any client bundle that pulls this module in, so
 * the `dyn_…` token can never be statically reachable from the browser. The
 * engine reaches pregen ONLY via the `/api/pregen` route, which is server-side.
 */

import "server-only";

import { getAddress, type Address } from "viem";
import {
  DYNAMIC_API_TOKEN,
  DYNAMIC_ENV_ID,
  isPregenConfigured,
} from "../config";
import { demoAddressFor } from "../engine/resolve";
import { simLatency, sleep } from "../demo/sim";
import type { PregenOps } from "../engine/types";

/** Dynamic WaaS pregen REST base — `{envId}/waas/create` is appended per call. */
const DYNAMIC_API_BASE = "https://app.dynamic.xyz/api/v0/environments";

// ---------------------------------------------------------------------------
// DEMO implementation — deterministic, no credentials, no network.
// ---------------------------------------------------------------------------

const demoPregenOps: PregenOps = {
  real: false,

  async pregenAddress(identifier) {
    // A touch of latency so the await reads as real work; deterministic address.
    await sleep(simLatency(200, 500));
    return { address: demoAddressFor(identifier), existed: false };
  },
};

// ---------------------------------------------------------------------------
// REAL implementation — Dynamic waas/create, server-only (DYNAMIC_API_TOKEN).
// ---------------------------------------------------------------------------

/** Identifier kinds Dynamic's pregen accepts. */
type IdentifierType = "email" | "phoneNumber";

/**
 * Classify an identifier as a phone vs an email. An email always contains "@";
 * otherwise a leading `+` or an all-digits/spacing/dashes shape (E.164-ish)
 * reads as a phone number. Anything else (a bare username) falls back to email,
 * which is Dynamic's most permissive identifier kind.
 */
function identifierType(identifier: string): IdentifierType {
  const trimmed = identifier.trim();
  if (trimmed.includes("@")) return "email";
  // E.164 / phone shapes: optional leading "+", then digits and separators only.
  if (/^\+?[0-9][0-9()\-.\s]{4,}$/.test(trimmed)) return "phoneNumber";
  return "email";
}

/**
 * Build the Dynamic request body for an identifier, picking email vs phone.
 *
 * HONESTY NOTE (verified 2026-06-13 against the installed SDK + docs/research/
 * dynamic.md §3): the EXACT server-side `waas/create` REST request/response
 * shape is NOT verified. The installed `@dynamic-labs/*` 4.88.5 line is a React
 * CLIENT SDK — its closest endpoints (`SDKApi.createWaasAccount`, request model
 * `CreateWaasAccountRequest { chain, clientKeygenIds, … }`, and
 * `createEmbeddedWallets`) are MPC/TSS client-keygen or authenticated-user
 * flows, NOT a server-only "pregen an address for this email/phone" call. The
 * server REST pregen endpoint (Bearer `dyn_…`) is the Dynamic Dashboard API,
 * whose body docs §3 marks UNVERIFIED. So this body (`{ identifier, type,
 * chains }`) is a BEST-EFFORT guess. That is SAFE here because: (1) the real
 * path only runs when DYNAMIC_API_TOKEN is present and throws otherwise (it
 * never fabricates an address), and (2) {@link parsePregenAddress} only returns
 * an address that the live API actually sent back — a wrong body yields a
 * non-OK response → an honest throw, never a fake address. Confirm the exact
 * body via the Dynamic docs MCP before relying on the real path in production.
 */
function pregenRequestBody(identifier: string): Record<string, unknown> {
  const type = identifierType(identifier);
  const value = identifier.trim();
  const body: Record<string, unknown> = {
    identifier: value,
    type,
    chains: ["EVM"],
  };
  // For an E.164 number the country code is embedded in the `+…` prefix; only
  // pass `smsCountryCode` for a bare national number (no leading `+`).
  if (type === "phoneNumber" && !value.startsWith("+")) {
    body.smsCountryCode = "US";
  }
  return body;
}

/**
 * Pull the first EVM `0x…` address out of a Dynamic `waas/create` response. The
 * field varies across Dynamic responses, so read defensively: a top-level
 * `accountAddress`, else the first `wallets[].publicKey` (or `.address`) that
 * looks like an EVM address. Returns it checksummed via viem `getAddress`, or
 * `null` if nothing parseable is present.
 */
function parsePregenAddress(payload: unknown): Address | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;

  const isEvmAddress = (v: unknown): v is string =>
    typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);

  // Some responses nest the user under `user`; check both shapes.
  const top = obj.accountAddress;
  if (isEvmAddress(top)) return getAddress(top);

  const walletSources = [obj.wallets, (obj.user as Record<string, unknown> | undefined)?.wallets];
  for (const wallets of walletSources) {
    if (!Array.isArray(wallets)) continue;
    for (const w of wallets) {
      if (!w || typeof w !== "object") continue;
      const wallet = w as Record<string, unknown>;
      if (isEvmAddress(wallet.publicKey)) return getAddress(wallet.publicKey);
      if (isEvmAddress(wallet.address)) return getAddress(wallet.address);
    }
  }
  return null;
}

const realPregenOps: PregenOps = {
  real: true,

  async pregenAddress(identifier) {
    if (!DYNAMIC_ENV_ID || !DYNAMIC_API_TOKEN) {
      throw new Error(
        "DYNAMIC_ENV_ID / DYNAMIC_API_TOKEN missing — cannot run real Dynamic pregen.",
      );
    }
    // The `dyn_…` token is a SECRET; never let a stray client-side call leak it.
    // Mirrors the bridge/Unlink server-only guards (defence in depth alongside
    // `import "server-only"`).
    if (typeof window !== "undefined") {
      throw new Error(
        "Real Dynamic pregen is server-only (DYNAMIC_API_TOKEN) — not callable in the browser.",
      );
    }

    const url = `${DYNAMIC_API_BASE}/${DYNAMIC_ENV_ID}/waas/create`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DYNAMIC_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(pregenRequestBody(identifier)),
    });

    const text = await res.text();
    if (!res.ok) {
      // Surface the status + a short body snippet honestly; the caller (engine)
      // falls back to the demo address per PLAN §8.
      const snippet = text.slice(0, 200);
      throw new Error(
        `Dynamic waas/create failed — ${res.status} ${res.statusText}: ${snippet}`,
      );
    }

    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(
        `Dynamic waas/create returned non-JSON (${res.status}): ${text.slice(0, 200)}`,
      );
    }

    const address = parsePregenAddress(payload);
    if (!address) {
      throw new Error(
        `Dynamic waas/create succeeded (${res.status}) but no EVM address found in the response.`,
      );
    }

    // Idempotency: 201 = freshly created, 200 = the identifier already had a
    // pregen wallet. Treat anything other than 201 as "existed".
    return { address, existed: res.status !== 201 };
  },
};

/**
 * Select the active PregenOps. Real Dynamic `waas/create` path when
 * {@link isPregenConfigured} (not demo mode AND both the env id and the server
 * token are present); otherwise the deterministic demo simulation.
 */
export function getPregenOps(): PregenOps {
  return isPregenConfigured() ? realPregenOps : demoPregenOps;
}
