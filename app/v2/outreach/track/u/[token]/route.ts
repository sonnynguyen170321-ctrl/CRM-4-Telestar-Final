import { type NextRequest } from "next/server";

import { prisma } from "@/lib/server/prisma";
import { markEmailUnsubscribed } from "@/lib/v2/outreach/tracking/recordTrackingEvent";
import { getTrackingSecret, verifyTrackingToken } from "@/lib/v2/outreach/tracking/trackingToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CTD unsubscribe. Public. GET = recipient clicks the link; POST = RFC 8058
// one-click. Idempotent: the suppression is written BEFORE we return success, so
// a recipient who unsubscribes is never contacted again even on a retry.
async function handle(request: NextRequest, token: string): Promise<Response> {
  let unsubscribed = false;
  const secret = getTrackingSecret();
  if (secret) {
    const payload = verifyTrackingToken(token, secret);
    if (payload?.kind === "unsub") {
      try {
        const rows = await prisma.$queryRawUnsafe<Array<{ organizationId: string; toAddress: string }>>(
          `SELECT "organizationId","toAddress" FROM "V2OutreachMessage" WHERE "id" = $1 LIMIT 1`,
          payload.messageId
        );
        if (rows[0]) {
          unsubscribed = await markEmailUnsubscribed({
            organizationId: rows[0].organizationId,
            email: rows[0].toAddress,
          });
        }
      } catch {
        unsubscribed = false;
      }
    }
  }

  const body = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#0f172a"><h1 style="font-size:1.25rem">${unsubscribed ? "You're unsubscribed" : "Unsubscribe"}</h1><p style="color:#475569">${unsubscribed ? "You will not receive further emails from this sender. No further action is needed." : "This unsubscribe link is invalid or has expired."}</p></body></html>`;

  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  return handle(request, token);
}

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  return handle(request, token);
}
