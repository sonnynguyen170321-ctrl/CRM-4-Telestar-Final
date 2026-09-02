import { type NextRequest } from "next/server";

import { prisma } from "@/lib/server/prisma";
import { recordTrackingEvent } from "@/lib/v2/outreach/tracking/recordTrackingEvent";
import { getTrackingSecret, verifyTrackingToken } from "@/lib/v2/outreach/tracking/trackingToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CTD open pixel. Public, unauthenticated (recipients' mail clients fetch it).
// The HMAC token resolves to a message; we record an OPEN then ALWAYS return a
// 1×1 gif (never leak whether the token was valid). Bot/proxy opens are flagged
// by the event sink, and analytics counts unique human opens only.
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const secret = getTrackingSecret();
  if (secret) {
    const payload = verifyTrackingToken(token, secret);
    if (payload?.kind === "open") {
      try {
        const rows = await prisma.$queryRawUnsafe<Array<{ organizationId: string }>>(
          `SELECT "organizationId" FROM "V2OutreachMessage" WHERE "id" = $1 AND "deletedAt" IS NULL LIMIT 1`,
          payload.messageId
        );
        if (rows[0]) {
          await recordTrackingEvent({
            organizationId: rows[0].organizationId,
            messageId: payload.messageId,
            eventKind: "OPEN",
            userAgent: request.headers.get("user-agent"),
            ip: request.headers.get("x-forwarded-for"),
          });
        }
      } catch {
        // never fail the pixel
      }
    }
  }

  return new Response(PIXEL, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
    },
  });
}
