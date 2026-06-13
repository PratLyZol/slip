/**
 * POST /api/pregen — recipient identifier → pre-generated EVM payout address.
 *
 * Wave 1 (A1): wires the real Dynamic WaaS pregen behind {@link getPregenOps}.
 * The selector returns the real Dynamic `waas/create` impl when
 * `isPregenConfigured()` (env id + server token present, not demo mode), else
 * the deterministic demo impl — same observable shape `{ address, existed }`
 * (PregenOps.pregenAddress, engine/types.ts) either way, so the demo path keeps
 * working with ZERO credentials.
 *
 * SECRET HANDLING: this route now transitively imports `adapters/pregen.ts`,
 * which reads the server-only `DYNAMIC_API_TOKEN`. That module is marked
 * `import "server-only"`, so the token can never reach the browser; this route
 * is itself server-side (API route handler), and the token is used only here.
 *
 * Next 16 App Router route handler: `export async function POST(request)`
 * returning `NextResponse.json(...)`, importing from "next/server"
 * (NextRequest/NextResponse — the extended Request/Response). Signature per:
 * node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
 */

import { NextResponse, type NextRequest } from "next/server";
import { getPregenOps } from "@/lib/adapters/pregen";

interface PregenRequestBody {
  identifier?: string;
}

export async function POST(request: NextRequest) {
  const { identifier } = (await request.json()) as PregenRequestBody;

  if (typeof identifier !== "string" || identifier.trim() === "") {
    return NextResponse.json(
      { error: "identifier is required" },
      { status: 400 },
    );
  }

  // In demo mode the selector returns the demo impl, which never throws. In real
  // mode a Dynamic failure throws an honest error — surface it as a 502 so the
  // engine (the caller) can fall back to the demo address per PLAN §8, rather
  // than masking it as a success.
  try {
    const { address, existed } =
      await getPregenOps().pregenAddress(identifier);
    return NextResponse.json({ address, existed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "pregen failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
