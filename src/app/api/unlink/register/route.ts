/**
 * POST /api/unlink/register — Unlink auth-route: register.
 *
 * The non-custodial browser Unlink client (src/lib/adapters/unlink.ts) POSTs its
 * public registration payload here; this route delegates to the Unlink SDK's
 * `createUnlinkAuthRoutes(...).register`, which validates it and calls
 * `admin.users.register` with the server-only admin key (`UNLINK_API_KEY`). The
 * secret never reaches this route — only the public registration material does.
 *
 * Server-only: the admin key is privileged (project-scoped) and must never ship
 * to the browser. We build the admin handle LAZILY (inside the handler), never
 * at module load — so when `UNLINK_API_KEY` is absent the module still imports
 * cleanly and demo mode (which never calls this route) is unaffected. Absent the
 * key, we return a clear 501 stub.
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
    // Unlink backend to register against. Fail clearly rather than at import.
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
  return routes.register(request);
}
