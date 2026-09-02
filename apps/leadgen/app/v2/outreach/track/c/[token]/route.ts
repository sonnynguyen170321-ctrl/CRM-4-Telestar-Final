import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/server/prisma";
import { recordTrackingEvent } from "@/lib/v2/outreach/tracking/recordTrackingEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CTD click redirect. Public. The token maps (in the DB) to a stored target — we
// NEVER take the destination from the request, and only redirect to HTTP(S), so
// a tracking link can never become an open redirect. Records a CLICK, then 302s.
export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;

  const rows = await prisma.$queryRawUnsafe<
    Array<{ id: string; organizationId: string; messageId: string; targetUrl: string; disabledAt: Date | null }>
  >(
    `SELECT "id","organizationId","messageId","targetUrl","disabledAt"
     FROM "V2OutreachTrackingLink" WHERE "token" = $1 LIMIT 1`,
    token
  );
  const link = rows[0];

  if (!link || link.disabledAt || !/^https?:\/\//i.test(link.targetUrl)) {
    return new Response("Link not found.", { status: 404 });
  }

  try {
    await recordTrackingEvent({
      organizationId: link.organizationId,
      messageId: link.messageId,
      eventKind: "CLICK",
      trackingLinkId: link.id,
      userAgent: request.headers.get("user-agent"),
      ip: request.headers.get("x-forwarded-for"),
    });
  } catch {
    // never block the redirect on a tracking write
  }

  return NextResponse.redirect(link.targetUrl, 302);
}
