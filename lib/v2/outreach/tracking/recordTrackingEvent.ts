import "server-only";

import { createHash } from "node:crypto";

import { prisma } from "@/lib/server/prisma";

// CTD event sink. Append-only raw observations (V2OutreachTrackingEvent);
// analytics counts UNIQUE messages separately. IP/UA are hashed (privacy); a
// coarse bot classification flags non-human opens (prefetch/proxy/crawler).

const BOT_UA = /bot|crawl|spider|preview|proxy|monitor|fetch|curl|wget|python-requests|headless|google.*image|ggpht|feedfetcher/i;

function classifyBot(userAgent: string | null): "HUMAN" | "BOT" | "SUSPECTED" | "UNKNOWN" {
  if (!userAgent) return "UNKNOWN";
  if (BOT_UA.test(userAgent)) return "BOT";
  // Mail-app image proxies (Apple/Gmail) inflate opens but aren't malicious bots.
  if (/GoogleImageProxy|YahooMailProxy|Microsoft Office/i.test(userAgent)) return "SUSPECTED";
  return "HUMAN";
}

function hash(value: string | null): string | null {
  return value ? createHash("sha256").update(value).digest("hex").slice(0, 32) : null;
}

export async function recordTrackingEvent(input: {
  organizationId: string;
  messageId: string;
  eventKind: "OPEN" | "CLICK";
  trackingLinkId?: string | null;
  userAgent?: string | null;
  ip?: string | null;
}): Promise<void> {
  const id = `trk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "V2OutreachTrackingEvent"
       ("id","organizationId","messageId","trackingLinkId","eventKind","botClassification",
        "userAgentHash","ipHash","occurredAt","createdAt")
     VALUES ($1,$2,$3,$4,$5::"V2TrackingEventKind",$6::"V2TrackingBotClassification",
        $7,$8,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    id,
    input.organizationId,
    input.messageId,
    input.trackingLinkId ?? null,
    input.eventKind,
    classifyBot(input.userAgent ?? null),
    hash(input.userAgent ?? null),
    hash(input.ip ?? null)
  );
}

/**
 * Idempotent unsubscribe: write a tenant-level EMAIL suppression if one is not
 * already active. Returns true if the address is suppressed afterward (always,
 * unless the write fails). Suppression is written BEFORE the route returns
 * success (RFC 8058 one-click).
 */
export async function markEmailUnsubscribed(input: {
  organizationId: string;
  email: string;
  reason?: string;
}): Promise<boolean> {
  const email = input.email.trim().toLowerCase();
  if (!email) return false;

  const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT "id" FROM "V2SuppressionEntry"
     WHERE "organizationId" = $1 AND "identifierType" = 'EMAIL'
       AND "identifierValueNormalized" = $2 AND "suppressionType" = 'UNSUBSCRIBE'
       AND "deletedAt" IS NULL LIMIT 1`,
    input.organizationId,
    email
  );
  if (existing[0]) return true;

  const id = `sup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "V2SuppressionEntry"
       ("id","organizationId","scopeType","identifierType","identifierValueNormalized",
        "suppressionType","reason","source","createdAt")
     VALUES ($1,$2,'ORGANIZATION','EMAIL',$3,'UNSUBSCRIBE',$4,'tracking_unsubscribe',CURRENT_TIMESTAMP)`,
    id,
    input.organizationId,
    email,
    input.reason ?? "One-click unsubscribe"
  );
  return true;
}
