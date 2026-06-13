/**
 * POST /api/bridge — server route that runs the REAL Circle CCTP bridge
 * (Base Sepolia → Arc) via @circle-fin/bridge-kit. Exists because bridge-kit is
 * Node-only and the burn is paid by `CCTP_PRIVATE_KEY` (a secret) — neither may
 * reach the browser. The frontend (BridgePanel / the engine's aggregate step in
 * real mode) POSTs here; the route runs the bridge server-side and returns the
 * two public edges (burn on Base Sepolia, mint on Arc).
 *
 * Request  { amountUsdc, recipientAddress }
 * Response 200 { ok:true, burnTx, mintTx }
 *          400 { ok:false, error }   // demo mode / bad input
 *          502 { ok:false, error }   // bridge failed (honest, no fake success)
 */

import { getBridgeOps } from "../../../lib/adapters/bridge";
import { isDemoMode } from "../../../lib/config";

// A live CCTP bridge — never cache.
export const dynamic = "force-dynamic";
// bridge-kit + attestation polling can take ~20s; give the function headroom.
export const maxDuration = 120;

interface BridgeRequestBody {
  amountUsdc?: string;
  recipientAddress?: string;
}

function isAddress(v: unknown): v is string {
  return typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
}

export async function POST(request: Request): Promise<Response> {
  if (isDemoMode()) {
    return Response.json(
      { ok: false, error: "Demo mode — the bridge is simulated client-side, not via /api/bridge." },
      { status: 400 },
    );
  }

  let body: BridgeRequestBody;
  try {
    body = (await request.json()) as BridgeRequestBody;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const { amountUsdc, recipientAddress } = body;
  if (typeof amountUsdc !== "string" || !/^\d+(\.\d{1,6})?$/.test(amountUsdc)) {
    return Response.json({ ok: false, error: "Missing or malformed `amountUsdc`." }, { status: 400 });
  }
  if (!isAddress(recipientAddress)) {
    return Response.json({ ok: false, error: "Missing or malformed `recipientAddress`." }, { status: 400 });
  }

  try {
    // Not demo → getBridgeOps() returns the real bridge-kit path (server-side).
    const result = await getBridgeOps().bridgeToArc({ amountUsdc, recipientAddress });
    return Response.json({ ok: true, burnTx: result.burnTx, mintTx: result.mintTx });
  } catch (err) {
    const error = err instanceof Error ? err.message : "CCTP bridge failed.";
    return Response.json({ ok: false, error }, { status: 502 });
  }
}
