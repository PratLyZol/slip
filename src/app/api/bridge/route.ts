/**
 * POST /api/bridge — DEPRECATED.
 *
 * The CCTP bridge (Base Sepolia → Arc) now runs CLIENT-SIDE: the burn is signed
 * by and funded from the connected wallet's viem WalletClient via
 * `bridgeWithWalletClient` (see src/lib/adapters/bridge.ts). The old server-side
 * path that paid the burn with a `CCTP_PRIVATE_KEY` secret has been removed — a
 * server key burning its own USDC would mean the recipient never owns the funds
 * and the Arc mint recipient wouldn't match the connected wallet.
 *
 * The engine no longer calls this route. It is kept only to return an honest 410
 * so any stale client that still POSTs here gets a clear signal instead of a
 * silent failure.
 */

// Static response — nothing to compute, nothing to cache that matters.
export const dynamic = "force-static";

const DEPRECATION =
  "POST /api/bridge is deprecated. The CCTP bridge is now wallet-signed and runs client-side (bridgeWithWalletClient). There is no server burn path.";

export async function POST(): Promise<Response> {
  return Response.json({ ok: false, error: DEPRECATION }, { status: 410 });
}

export async function GET(): Promise<Response> {
  return Response.json({ ok: false, error: DEPRECATION }, { status: 410 });
}
