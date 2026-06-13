/**
 * POST /api/notify — email the recipient their claim link.
 *
 * When you send funds to someone by email, the funds land (shielded) in a claim
 * account derived from a per-recipient secret, and the secret rides in the claim
 * URL. This route emails that URL to the recipient so they can open it, log in
 * with their email (OTP → creates/accesses their Dynamic wallet), and withdraw.
 *
 * Uses the Resend REST API directly (no SDK — keeps the 3-sponsor rule clean).
 * Server-only: the API key never reaches the browser. Without `RESEND_API_KEY`
 * the route returns an honest 501 — it NEVER pretends to have sent.
 *
 * NOTE: the claim URL contains the secret (in its fragment). Emailing a claim
 * link inherently puts that link through the mail provider — that is the nature
 * of "email someone a link to claim." Acceptable for the demo.
 */

import "server-only";
import { RESEND_API_KEY, EMAIL_FROM } from "@/lib/config";

export const dynamic = "force-dynamic";

interface NotifyBody {
  to?: string;
  claimUrl?: string;
  amountUsdc?: string;
  senderLabel?: string;
}

function isEmail(v: unknown): v is string {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export async function POST(request: Request): Promise<Response> {
  if (!RESEND_API_KEY) {
    return Response.json(
      { ok: false, error: "RESEND_API_KEY not configured — cannot email the claim link." },
      { status: 501 },
    );
  }

  let body: NotifyBody;
  try {
    body = (await request.json()) as NotifyBody;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const { to, claimUrl, amountUsdc, senderLabel } = body;
  if (!isEmail(to)) {
    return Response.json({ ok: false, error: "Missing or invalid `to` email." }, { status: 400 });
  }
  if (typeof claimUrl !== "string" || !/^https?:\/\//.test(claimUrl)) {
    return Response.json({ ok: false, error: "Missing or invalid `claimUrl`." }, { status: 400 });
  }

  const from = senderLabel?.trim() || "Someone";
  const amount = amountUsdc ? `$${amountUsdc}` : "money";
  const subject = `${from} sent you ${amount}`;
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#16130a">
      <h1 style="font-size:22px;margin:0 0 8px">You've received ${amount}</h1>
      <p style="font-size:14px;line-height:1.5;color:#555;margin:0 0 20px">
        ${from} sent you money. Tap below to claim it — you'll confirm it's you with a
        one-time code, no wallet or password needed.
      </p>
      <a href="${claimUrl}" style="display:inline-block;background:#16130a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:12px;font-weight:600;font-size:15px">
        Claim your money
      </a>
      <p style="font-size:12px;color:#999;margin:20px 0 0;word-break:break-all">
        Or paste this link: ${claimUrl}
      </p>
    </div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return Response.json(
      { ok: false, error: `Email send failed (${res.status}). ${detail}` },
      { status: 502 },
    );
  }

  return Response.json({ ok: true });
}
