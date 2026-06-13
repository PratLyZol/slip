/**
 * Circle StableFX adapter — the REAL USDC→EURC conversion at claim time
 * (TICKETS Track D1, PLAN §6 "P6 — Real FX cascade", primary FX path).
 *
 * StableFX is a REST RFQ flow with on-chain PvP settlement on Arc via the
 * FxEscrow contract — NOT an SDK, NOT a permissionless on-chain swap. The taker
 * (here: the recipient's account) requests a quote, signs an EIP-712 Permit2
 * payload to create the trade, signs a second EIP-712 Permit2 payload to fund
 * it, and the API relays both legs to FxEscrow which settles USDC↔EURC atomically.
 *
 * SDK budget: StableFX is the Circle sponsor; viem is plumbing (EIP-712 signing
 * + key derivation). No new SDK is introduced (3-SDK rule holds).
 *
 * SERVER-ONLY. The StableFX API key is a secret and the taker's signing key is
 * derived from the claim secret — neither may ever reach the browser. This module
 * guards with a `typeof window` throw (same pattern as adapters/bridge.ts) and is
 * only ever invoked from the `/api/fx` route handler. The browser-side caller in
 * `engine/fx.ts` POSTs to that route instead of importing this file.
 *
 * NO per-adapter feature flag (user directive): selection is on the GLOBAL
 * `isDemoMode()` in `engine/fx.ts`. In real mode this runs for real and, on
 * failure, throws an HONEST error — it never fakes a success.
 *
 * ── VERIFIED endpoint contract ──────────────────────────────────────────────
 * Source: Circle StableFX OpenAPI 3.1 spec
 *   https://developers.circle.com/openapi/stablefx.yaml  (fetched 2026-06-13)
 *   + https://developers.circle.com/stablefx/quickstarts/fx-trade-taker
 *   + https://developers.circle.com/stablefx/concepts/technical-guide
 * Base URL (servers[0].url): https://api.circle.com   Auth: Bearer <API_KEY>
 *
 *   1. POST /v1/exchange/stablefx/quotes        (operationId createQuote)
 *        body  { from:{currency,amount}, to:{currency}, tenor, type:"tradable",
 *                recipientAddress }
 *        200   { id, rate, from, to, fee, expiresAt, typedData }   ← typedData is
 *              the Permit2 EIP-712 payload to sign (domain/types/primaryType/
 *              message). For a *tradable* quote the typedData is returned
 *              inline — there is no separate taker presign GET (that GET presign
 *              endpoint is the MAKER path).
 *   2. (sign typedData with the taker key — viem signTypedData)
 *   3. POST /v1/exchange/stablefx/trades        (operationId createTrade)
 *        body  { idempotencyKey, quoteId, address, message:<typedData.message>,
 *                signature }
 *        200   Trade { id, contractTradeId, status, rate, from, to,
 *                      settlementTransactionHash, ... }
 *   4. POST /v1/exchange/stablefx/signatures/funding/presign
 *                                                (operationId generateFundingPresignData)
 *        body  { contractTradeIds:[<contractTradeId>], type:"taker" }
 *        200   { typedData, deliverables, receivables }   ← funding Permit2 EIP-712
 *   5. (sign funding typedData with the taker key)
 *   6. POST /v1/exchange/stablefx/fund          (operationId fundTrade)
 *        body  { type:"taker", signature, permit2:<fundingTypedData.message> }
 *        200   (empty body on success)
 *   7. GET  /v1/exchange/stablefx/trades/{tradeId}?type=taker
 *                                                (operationId getTradeById)
 *        200   TradeDetail { status, settlementTransactionHash, ... }
 *        Poll until status ∈ {complete, confirmed} (settled, EURC delivered) or
 *        the trade stalls at taker_funded (USDC escrowed, awaiting a maker).
 *   Trade status enum (VERIFIED): pending | complete | confirmed |
 *        pending_settlement | taker_funded | maker_funded | refunded |
 *        breaching | breached.
 *
 * ── NOT FULLY VERIFIED ──────────────────────────────────────────────────────
 * Treated honestly via the typed interfaces below + a defensive parse:
 *   - The amount `fee` lives in the quote response (`fee`/`collateral` are Amount
 *     strings) but its exact role in the delivered net is sandbox-priced; we
 *     report the *quoted* `rate` and the `to.amount` we actually requested/got.
 *   - The `domain.chainId`/`verifyingContract`/`spender` of BOTH typedData blocks
 *     are READ FROM THE RESPONSE and NEVER hardcoded (spec examples are Sepolia,
 *     11155111 / 0xffd2…); viem signs whatever the API returns.
 *   - PLAN §4/§8: a TEST key returns Circle SANDBOX pricing and a testnet trade
 *     can stall at `taker_funded` if Circle runs no maker bot. We surface that
 *     status honestly (simulated=false, but no settlement tx + a clear note),
 *     never a fabricated success.
 */

import {
  concatHex,
  keccak256,
  toHex,
  type Address,
  type Hex,
  type TypedDataDomain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  CIRCLE_STABLEFX_API_BASE,
  CIRCLE_STABLEFX_API_KEY,
} from "../config";

// ── Verified API shapes (subset we use) ─────────────────────────────────────

/** EIP-712 typed data exactly as the API returns it. domain/types/message are
 * all read from the response — never hardcoded (TICKETS D1). */
interface StableFxTypedData {
  domain: TypedDataDomain;
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

interface QuoteResponse {
  id: string;
  rate: number;
  from: { currency: string; amount?: string };
  to: { currency: string; amount?: string };
  fee?: string;
  collateral?: string;
  expiresAt?: string;
  /** Present for type:"tradable" quotes — the Permit2 payload to sign. */
  typedData: StableFxTypedData;
}

/** Trade status enum — VERIFIED from the OpenAPI TradeStatus schema. */
type TradeStatus =
  | "pending"
  | "complete"
  | "confirmed"
  | "pending_settlement"
  | "taker_funded"
  | "maker_funded"
  | "refunded"
  | "breaching"
  | "breached";

interface TradeResponse {
  id: string;
  contractTradeId?: string;
  status: TradeStatus;
  rate?: number;
  from?: { currency: string; amount?: string };
  to?: { currency: string; amount?: string };
  settlementTransactionHash?: string | null;
}

interface FundingPresignResponse {
  typedData: StableFxTypedData;
  deliverables?: { currency: string; amount?: string }[];
  receivables?: { currency: string; amount?: string }[];
}

// ── Adapter surface ─────────────────────────────────────────────────────────

export interface StableFxQuoteAndSettleInput {
  /** USDC to convert, human units (e.g. "50.00"). */
  amountUsdc: string;
  /** The taker/recipient EVM address that receives the EURC on Arc. */
  recipientEvmAddress: Address;
  /**
   * The claim secret. The taker signs the EIP-712 payloads with the recipient
   * account's key, which is deterministically derived from this secret (same
   * derivation as counterfactual.recipientAddressFromSecret). SERVER-ONLY.
   */
  secret: Hex;
}

export interface StableFxQuoteAndSettleResult {
  /** EURC the recipient receives, human units. */
  eurcAmount: string;
  /** Quoted USDC→EURC rate (sandbox-priced under a TEST key — disclosed). */
  rate: number;
  /** FxEscrow settlement tx hash, when the PvP completed on-chain. */
  txHash?: Hex;
  /** Trade status at the time we stopped polling (honest label). */
  status: TradeStatus;
  /**
   * True only for the deterministic demo sim. Real StableFX results are
   * `false` even when a TEST trade stalls at taker_funded — that is real
   * sandbox behaviour, NOT a simulation. The caller must not relabel it.
   */
  simulated: false;
  /** Human note (e.g. "stalled at taker_funded — no maker"), when relevant. */
  note?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function assertServer(): void {
  if (typeof window !== "undefined") {
    throw new Error(
      "[slip] fx-stablefx is SERVER-ONLY — the StableFX key and taker signing " +
        "key must never reach the browser. Call /api/fx instead.",
    );
  }
}

/**
 * Derive the taker's signing key from the claim secret — IDENTICAL derivation
 * to counterfactual.recipientAddressFromSecret, so the address that signs is
 * exactly `recipientEvmAddress`. Kept here (not imported) so this server module
 * stays self-contained and the derivation is auditable next to its use.
 */
function takerKeyFromSecret(secret: Hex): Hex {
  const salted = concatHex([secret, toHex("slip:recipient")]);
  return keccak256(salted);
}

function baseUrl(): string {
  return CIRCLE_STABLEFX_API_BASE.replace(/\/+$/, "");
}

async function stablefxFetch<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<T> {
  if (!CIRCLE_STABLEFX_API_KEY) {
    throw new Error(
      "[slip] CIRCLE_STABLEFX_API_KEY is not set — cannot run the real StableFX flow.",
    );
  }
  const res = await fetch(`${baseUrl()}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${CIRCLE_STABLEFX_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `[slip] StableFX ${init.method} ${path} failed: ${res.status} ${res.statusText}` +
        (text ? ` — ${text.slice(0, 500)}` : ""),
    );
  }
  // /fund returns an empty body on success.
  const raw = await res.text();
  return (raw ? JSON.parse(raw) : {}) as T;
}

/**
 * Sign an EIP-712 payload with the taker key. domain/types/primaryType/message
 * come straight from the API response — viem signs whatever StableFX returns
 * (never a hardcoded domain/spender).
 */
async function signTypedData(
  td: StableFxTypedData,
  takerKey: Hex,
): Promise<Hex> {
  const account = privateKeyToAccount(takerKey);
  // EIP712Domain is implicit in viem's typed-data signing; strip it so viem
  // doesn't reject the duplicated domain type entry the API includes.
  const { EIP712Domain: _ignored, ...types } = td.types;
  void _ignored;
  return account.signTypedData({
    domain: td.domain,
    types: types as Record<string, { name: string; type: string }[]>,
    primaryType: td.primaryType,
    message: td.message,
  });
}

// ── The flow ────────────────────────────────────────────────────────────────

/** How many times to poll the trade after funding before giving up (honestly). */
const POLL_ATTEMPTS = 8;
const POLL_INTERVAL_MS = 1500;

/** Terminal-ish statuses we stop polling on. */
function isSettled(status: TradeStatus): boolean {
  return status === "complete" || status === "confirmed";
}
function isFailed(status: TradeStatus): boolean {
  return (
    status === "refunded" || status === "breaching" || status === "breached"
  );
}

/**
 * Run the full StableFX taker flow: quote → sign → trade → funding presign →
 * sign → fund → poll. Settles EURC to `recipientEvmAddress` on Arc.
 *
 * Throws an HONEST error on any API/sign failure. Returns a labeled result when
 * the trade settles OR when it legitimately stalls at `taker_funded` (sandbox
 * behaviour with no maker — PLAN §8); never fabricates a success.
 */
export async function quoteAndSettle(
  input: StableFxQuoteAndSettleInput,
): Promise<StableFxQuoteAndSettleResult> {
  assertServer();
  const takerKey = takerKeyFromSecret(input.secret);

  // 1 — Request a tradable quote (USDC → EURC). The taker proceeds go to the
  // recipient address; the quote carries the Permit2 typedData to sign.
  const quote = await stablefxFetch<QuoteResponse>(
    "/v1/exchange/stablefx/quotes",
    {
      method: "POST",
      body: {
        from: { currency: "USDC", amount: input.amountUsdc },
        to: { currency: "EURC" },
        tenor: "instant",
        type: "tradable",
        recipientAddress: input.recipientEvmAddress,
      },
    },
  );
  if (!quote.typedData) {
    throw new Error(
      "[slip] StableFX quote did not include typedData (need a tradable quote).",
    );
  }

  // 2 — Sign the trade-intent Permit2 payload (domain/spender READ FROM RESPONSE).
  const tradeSignature = await signTypedData(quote.typedData, takerKey);

  // 3 — Create the trade.
  const idempotencyKey = crypto.randomUUID();
  const trade = await stablefxFetch<TradeResponse>(
    "/v1/exchange/stablefx/trades",
    {
      method: "POST",
      body: {
        idempotencyKey,
        quoteId: quote.id,
        address: input.recipientEvmAddress,
        message: quote.typedData.message,
        signature: tradeSignature,
      },
    },
  );
  if (!trade.contractTradeId) {
    throw new Error(
      `[slip] StableFX trade ${trade.id} has no contractTradeId (status ${trade.status}).`,
    );
  }

  // 4 — Funding presign (taker leg). Returns the funding Permit2 typedData.
  const funding = await stablefxFetch<FundingPresignResponse>(
    "/v1/exchange/stablefx/signatures/funding/presign",
    {
      method: "POST",
      body: {
        contractTradeIds: [trade.contractTradeId],
        type: "taker",
      },
    },
  );
  if (!funding.typedData) {
    throw new Error("[slip] StableFX funding presign returned no typedData.");
  }

  // 5 — Sign the funding Permit2 payload (domain/spender READ FROM RESPONSE).
  const fundingSignature = await signTypedData(funding.typedData, takerKey);

  // 6 — Fund the trade — relays the signed permit to FxEscrow on Arc.
  await stablefxFetch<unknown>("/v1/exchange/stablefx/fund", {
    method: "POST",
    body: {
      type: "taker",
      signature: fundingSignature,
      permit2: funding.typedData.message,
    },
  });

  // 7 — Poll until the PvP settles, fails, or stalls at taker_funded.
  let current: TradeResponse = trade;
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    current = await stablefxFetch<TradeResponse>(
      `/v1/exchange/stablefx/trades/${trade.id}?type=taker`,
      { method: "GET" },
    );
    if (isSettled(current.status) || isFailed(current.status)) break;
    if (i < POLL_ATTEMPTS - 1) await sleep(POLL_INTERVAL_MS);
  }

  const eurcAmount =
    current.to?.amount ??
    quote.to.amount ??
    (Number(input.amountUsdc) * quote.rate).toFixed(2);
  const settlementHash = current.settlementTransactionHash ?? undefined;

  let note: string | undefined;
  if (!isSettled(current.status)) {
    if (current.status === "taker_funded") {
      note =
        "USDC escrowed in FxEscrow; awaiting a maker to complete the PvP " +
        "(testnet sandbox — no maker bot guaranteed).";
    } else if (isFailed(current.status)) {
      note = `Trade ended at ${current.status} — USDC refundable, EURC not delivered.`;
    } else {
      note = `Trade still ${current.status} after polling; settlement pending.`;
    }
  }

  return {
    eurcAmount,
    rate: quote.rate,
    txHash:
      settlementHash && /^0x[0-9a-fA-F]{64}$/.test(settlementHash)
        ? (settlementHash as Hex)
        : undefined,
    status: current.status,
    simulated: false,
    note,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
