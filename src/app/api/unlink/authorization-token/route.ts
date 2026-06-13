/**
 * POST /api/unlink/authorization-token — Unlink auth-route: authorization token.
 *
 * Wave 0 STUB. The authorization-token half of the Unlink auth routes: the
 * shielded-balance client asks the app server to mint/return an authorization
 * token for the privacy operation. This stub returns a clearly-fake token so
 * the route exists and callers compile. B2 replaces the body with
 * `createUnlinkAuthRoutes(...).authorizationToken`.
 *
 * Next 16 App Router route handler — see /api/pregen/route.ts for the signature
 * grounding (next/server, NextRequest/NextResponse, per
 * node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md).
 *
 * NOTE(Wave 1): no `import "server-only"` yet (stub touches no secret). B2 MUST
 * add it once this route reads UNLINK credentials via config.ts.
 */

import { NextResponse, type NextRequest } from "next/server";

interface AuthorizationTokenResponseBody {
  token: string;
}

export async function POST(_request: NextRequest) {
  // TODO(B2): createUnlinkAuthRoutes.authorizationToken — delegate to the Unlink
  // SDK to issue the real authorization token for the shielded operation.
  // Stubbed to a clearly-fake token for Wave 0 (NOT a real credential).
  void _request;

  const body: AuthorizationTokenResponseBody = {
    token: "stub-unlink-authorization-token",
  };
  return NextResponse.json(body);
}
