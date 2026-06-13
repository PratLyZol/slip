/**
 * POST /api/unlink/register — Unlink auth-route: register.
 *
 * Wave 0 STUB. Unlink's SDK expects the app to host a pair of server routes
 * (register + authorization-token) that the shielded-balance flow calls. This
 * is the register half, returning a 200 ack so the route exists and the wiring
 * compiles. B2 replaces the body with `createUnlinkAuthRoutes(...).register`.
 *
 * Next 16 App Router route handler — see /api/pregen/route.ts for the signature
 * grounding (next/server, NextRequest/NextResponse, per
 * node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md).
 *
 * NOTE(Wave 1): no `import "server-only"` yet (stub touches no secret). B2 MUST
 * add it once this route reads UNLINK credentials via config.ts.
 */

import { NextResponse, type NextRequest } from "next/server";

interface UnlinkRegisterResponseBody {
  ok: boolean;
}

export async function POST(_request: NextRequest) {
  // TODO(B2): createUnlinkAuthRoutes.register — delegate to the Unlink SDK's
  // register handler (validates the client's registration request and persists
  // / proxies it per the canary SDK contract). Stubbed to a 200 ack for Wave 0.
  void _request;

  const body: UnlinkRegisterResponseBody = { ok: true };
  return NextResponse.json(body);
}
