/**
 * POST /api/fx — server route that runs the REAL Circle StableFX USDC→EURC flow
 * (TICKETS Track D1, PLAN §6). Exists so the StableFX API key AND the taker's
 * signing key (derived from the claim secret) never reach the browser: the
 * browser-side FX selector in `engine/fx.ts` POSTs here in real mode.
 *
 * NO per-adapter feature flag (user directive): the engine selects real vs sim
 * on the GLOBAL `isDemoMode()`. This route assumes it is only called in real
 * mode; it runs the real flow and returns an HONEST error on failure — it never
 * fabricates a fake success.
 *
 * Request  { secret, region, amountUsdc }
 * Response 200 { ok:true,  token, amount, rate, txHash?, status, note? }
 *          200 { ok:true,  token:"USDC", amount, rate:1 }   // US no-op
 *          5xx { ok:false, error }                          // honest failure
 */

import { isDemoMode } from "../../../lib/config";
import { quoteAndSettle } from "../../../lib/adapters/fx-stablefx";
import { recipientAddressFromSecret } from "../../../lib/engine/counterfactual";
import { localTokenForRegion } from "../../../lib/engine/fx";
import type { Region } from "../../../lib/engine/types";
import type { Hex } from "viem";

// StableFX settles a live trade — always run at request time, never cached.
export const dynamic = "force-dynamic";

interface FxRequestBody {
  secret?: string;
  region?: Region;
  amountUsdc?: string;
}

function isHexSecret(v: unknown): v is Hex {
  return typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
}

export async function POST(request: Request): Promise<Response> {
  // Demo mode never touches this route (the selector simulates client-side); if
  // it is hit anyway, refuse rather than pretend.
  if (isDemoMode()) {
    return Response.json(
      { ok: false, error: "Demo mode — FX is simulated client-side, not via /api/fx." },
      { status: 400 },
    );
  }

  let body: FxRequestBody;
  try {
    body = (await request.json()) as FxRequestBody;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const { secret, region, amountUsdc } = body;
  if (!isHexSecret(secret)) {
    return Response.json(
      { ok: false, error: "Missing or malformed `secret` (expected 32-byte hex)." },
      { status: 400 },
    );
  }
  if (typeof amountUsdc !== "string" || !/^\d+(\.\d{1,6})?$/.test(amountUsdc)) {
    return Response.json(
      { ok: false, error: "Missing or malformed `amountUsdc`." },
      { status: 400 },
    );
  }

  const token = localTokenForRegion(region);

  // US / USDC: genuine no-op — no StableFX trade at all.
  if (token === "USDC") {
    return Response.json({ ok: true, token, amount: amountUsdc, rate: 1 });
  }

  // EU / EURC: run the real StableFX taker flow, settling EURC to the recipient.
  try {
    const recipientEvmAddress = recipientAddressFromSecret(secret);
    const result = await quoteAndSettle({
      amountUsdc,
      recipientEvmAddress,
      secret,
    });
    return Response.json({
      ok: true,
      token,
      amount: result.eurcAmount,
      rate: result.rate,
      txHash: result.txHash,
      status: result.status,
      note: result.note,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "StableFX flow failed.";
    return Response.json({ ok: false, error }, { status: 502 });
  }
}
