/**
 * POST /api/fx — quote/settle USDC → recipient's local stablecoin.
 *
 * Wave 0 STUB. Calls the existing simulated `fxAtClaim` (engine/fx.ts) and
 * returns its `FxResult` (engine/types.ts: `{ token, amount, rateUsed?, txHash? }`).
 * This route is a demo/inspection surface only — the REAL FX-at-claim runs
 * client-side inside `runClaim`, where the actual claim secret (URL fragment) is
 * in hand. Per AGENTS.md the claim secret must NEVER hit the network/server, so
 * this route body is `{ amountUsdc, region }` ONLY — it does NOT accept a secret.
 * Instead it derives a deterministic stub secret server-side purely so the
 * simulated quote is reproducible for the demo.
 *
 * Next 16 App Router route handler — see /api/pregen/route.ts for the signature
 * grounding (next/server, NextRequest/NextResponse, per
 * node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md).
 *
 * NOTE(Wave 1): no `import "server-only"` yet — calls only the client-safe
 * simulated `fxAtClaim` and no secret. D MUST add `import "server-only"` once
 * this route reads STABLEFX_API_KEY / CIRCLE_KIT_KEY via config.ts.
 */

import { NextResponse, type NextRequest } from "next/server";
import { keccak256, toHex, type Hex } from "viem";
import { fxAtClaim } from "@/lib/engine/fx";
import type { FxResult, Region } from "@/lib/engine/types";

interface FxRequestBody {
  amountUsdc?: string;
  region?: Region;
}

export async function POST(request: NextRequest) {
  const { amountUsdc, region } = (await request.json()) as FxRequestBody;

  if (typeof amountUsdc !== "string" || amountUsdc.trim() === "") {
    return NextResponse.json(
      { error: "amountUsdc is required" },
      { status: 400 },
    );
  }

  // TODO(D): StableFX → Swap → sim cascade. The real cascade passes the actual
  // claim secret (held client-side in runClaim) — never sent here. For this
  // demo/inspection stub we derive a deterministic secret from the inputs so the
  // simulated quote is reproducible without ever putting a real secret on the wire.
  const stubSecret = keccak256(
    toHex(`slip:fx-route-stub:${amountUsdc}:${region ?? "US"}`),
  ) as Hex;

  const body: FxResult = await fxAtClaim(amountUsdc, region, stubSecret);
  return NextResponse.json(body);
}
