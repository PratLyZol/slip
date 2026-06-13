/**
 * POST /api/pregen — recipient identifier → pre-generated EVM payout address.
 *
 * Wave 0 STUB. Returns a deterministic fake address so the send pipeline has a
 * stable `recipientAddress` to embed in the claim payload before A1 wires the
 * real Dynamic waas pregen. Mirrors `PregenOps.pregenAddress` (engine/types.ts):
 * `{ address, existed }`. The stub always reports `existed: false`.
 *
 * Next 16 App Router route handler: `export async function POST(request)`
 * returning `NextResponse.json(...)`, importing from "next/server". Signature
 * per the AGENTS.md-mandated doc read:
 * node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
 * (NextRequest/NextResponse are the extended Request/Response — see that doc).
 *
 * NOTE(Wave 1): no `import "server-only"` yet — this route imports only the
 * client-safe demo helper `demoAddressFor` and no secret. A1 MUST add
 * `import "server-only"` once this route imports a module that reads a secret
 * (DYNAMIC_API_TOKEN via config.ts). Same applies to B2 (unlink) and D (fx).
 */

import { NextResponse, type NextRequest } from "next/server";
import { demoAddressFor } from "@/lib/engine/resolve";
import type { Address } from "viem";

interface PregenRequestBody {
  identifier?: string;
}

interface PregenResponseBody {
  address: Address;
  existed: boolean;
}

export async function POST(request: NextRequest) {
  const { identifier } = (await request.json()) as PregenRequestBody;

  if (typeof identifier !== "string" || identifier.trim() === "") {
    return NextResponse.json(
      { error: "identifier is required" },
      { status: 400 },
    );
  }

  // TODO(A1): real Dynamic waas/create — pregenerate an embedded wallet for the
  // identifier (email/phone/name) and return its EVM payout address + whether it
  // already existed. Until then, a deterministic demo address keeps the payload
  // valid and the demo deterministic.
  const body: PregenResponseBody = {
    address: demoAddressFor(identifier),
    existed: false,
  };

  return NextResponse.json(body);
}
