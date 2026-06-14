/**
 * POST /api/fx — server route that runs the REAL Circle StableFX USDC→EURC flow
 * (TICKETS Track D1, PLAN §6). Exists so the StableFX API key AND the taker's
 * signing key (derived from the claim secret) never reach the browser: the
 * browser-side FX selector in `engine/fx.ts` POSTs here.
 *
 * REAL-ONLY (no demo/simulation fallback): this route runs the real FX flow and
 * returns an HONEST error on failure — it never fabricates a fake success.
 *
 * Request  { secret, region, amountUsdc }
 * Response 200 { ok:true,  token, amount, rate, txHash?, status, note? }
 *          200 { ok:true,  token:"USDC", amount, rate:1 }   // US no-op
 *          5xx { ok:false, error }                          // honest failure
 */

import { swapUsdcToEurc } from "../../../lib/adapters/swap";
import { localTokenForRegion } from "../../../lib/engine/fx";
import type { Region } from "../../../lib/engine/types";
import type { Hex } from "viem";

// A live swap — always run at request time, never cached.
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

  // US / USDC: genuine no-op — no swap at all.
  if (token === "USDC") {
    return Response.json({ ok: true, token, amount: amountUsdc, rate: 1 });
  }

  // EU / EURC: swap USDC → EURC via Circle Swap Kit, signed by the recipient's
  // claim account. If there's no route on Arc testnet (the expected case — LiFi
  // has no USDC↔EURC pool there), deliver USDC honestly instead of faking EURC.
  try {
    const result = await swapUsdcToEurc(amountUsdc, secret);
    if (!result.routed) {
      return Response.json({
        ok: true,
        token: "USDC",
        amount: result.amount,
        rate: 1,
        note: result.note,
      });
    }
    return Response.json({
      ok: true,
      token: "EURC",
      amount: result.amount,
      rate: result.rate,
      txHash: result.txHash,
      note: result.note,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Swap failed.";
    return Response.json({ ok: false, error }, { status: 502 });
  }
}
