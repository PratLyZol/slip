/**
 * POST /api/unlink/authorization-token — Unlink auth-route: authorization token.
 *
 * The non-custodial browser Unlink client (src/lib/adapters/unlink.ts) asks this
 * route for a short-lived authorization token scoped to its unlink1 address
 * before each privacy op. This route delegates to the Unlink SDK's
 * `createUnlinkAuthRoutes(...).authorizationToken`, which mints the token via
 * `admin.authorizationTokens.issue` using the server-only admin key
 * (`UNLINK_API_KEY`). The admin key never reaches the browser.
 *
 * Server-only: the admin handle is built LAZILY (inside the handler), never at
 * module load — so when `UNLINK_API_KEY` is absent the module imports cleanly
 * and demo mode (which never calls this route) is unaffected. Absent the key, we
 * return a clear 501 stub.
 *
 * Next App Router route handler — accepts the native Request (per
 * node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md).
 */

import "server-only";
import { createUnlinkAdmin, createUnlinkAuthRoutes } from "@unlink-xyz/sdk/admin";
import { UNLINK_API_KEY } from "@/lib/config";
import { UNLINK_ARC_ENVIRONMENT } from "@/lib/adapters/arc";

export async function POST(request: Request) {
  if (!UNLINK_API_KEY) {
    // Demo mode never calls this route; without the admin key there is no real
    // Unlink backend to mint tokens. Fail clearly rather than at import.
    return Response.json(
      { error: "UNLINK_API_KEY not configured — real Unlink path disabled." },
      { status: 501 },
    );
  }

  const admin = createUnlinkAdmin({
    environment: UNLINK_ARC_ENVIRONMENT,
    apiKey: UNLINK_API_KEY,
  });
  const routes = createUnlinkAuthRoutes({
    admin,
    // Demo/hackathon scope: every caller is trusted. Tighten for prod.
    authenticate: async () => ({}),
    authorizeUnlinkAddress: async () => true,
  });
  return routes.authorizationToken(request);
}
