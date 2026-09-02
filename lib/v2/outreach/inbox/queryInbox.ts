import "server-only";

import { prisma } from "@/lib/server/prisma";
import { resolveContactDisplayName } from "@/lib/v2/crm/resolveContactDisplayName";
import { classifyReply, type ReplyClass } from "./classifyReply";

// Unibox read models. A "thread" is NOT a stored entity — it is derived per
// LeadAssignment (Invariant 2: the unit is LeadAssignment, never Company). The
// inbox surfaces only leads that have received at least one inbound REPLY (that is
// what an SDR must read/reply to). Both queries are tenant-scoped from the session
// organizationId (Invariant 5) and respect soft-delete (Invariant 8).

export type InboxThreadSummary = {
  leadAssignmentId: string;
  workflowStatus: string;
  contactName: string | null;
  companyName: string | null;
  lastFrom: string | null;
  lastSnippet: string | null;
  lastOutcome: string | null;
  lastInboundAt: string | null;
  lastActivityAt: string | null;
  unreadCount: number;
  replyClass: ReplyClass | null;
};

export type InboxThreadMessage = {
  id: string;
  direction: "OUTBOUND" | "INBOUND";
  subject: string | null;
  body: string | null;
  address: string | null;
  status: string | null;
  occurredAt: string | null;
  readAt: string | null;
};

export type InboxThread = {
  leadAssignmentId: string;
  workflowStatus: string;
  contactName: string | null;
  contactTitle: string | null;
  companyName: string | null;
  messages: InboxThreadMessage[];
  // True when older messages exist beyond the returned window (load-earlier UI).
  hasMore: boolean;
};

export const INBOX_THREAD_PAGE_SIZE = 50;

type ThreadRow = {
  lead_id: string;
  workflow_status: string;
  contact_name: string | null;
  company_name: string | null;
  last_from: string | null;
  last_snippet: string | null;
  last_outcome: string | null;
  last_inbound_at: Date | null;
  last_activity_at: Date | null;
  unread: number;
};

export async function queryInboxThreads(
  organizationId: string,
  options: { limit?: number } = {}
): Promise<InboxThreadSummary[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);

  const rows = await prisma.$queryRawUnsafe<ThreadRow[]>(
    `WITH threads AS (
       SELECT DISTINCT "correlatedLeadAssignmentId" AS lead_id
       FROM "V2InboundMailEvent"
       WHERE "organizationId" = $1
         AND "eventKind" IN ('REPLY', 'BOUNCE_DSN', 'UNSUBSCRIBE')
         AND "correlatedLeadAssignmentId" IS NOT NULL
     ),
     last_inbound AS (
       SELECT DISTINCT ON ("correlatedLeadAssignmentId")
         "correlatedLeadAssignmentId" AS lead_id, "snippet", "fromAddress", "createdAt"
       FROM "V2InboundMailEvent"
       WHERE "organizationId" = $1 AND "eventKind" = 'REPLY'
         AND "correlatedLeadAssignmentId" IS NOT NULL
       ORDER BY "correlatedLeadAssignmentId", "createdAt" DESC
     ),
     last_event AS (
       SELECT DISTINCT ON ("correlatedLeadAssignmentId")
         "correlatedLeadAssignmentId" AS lead_id, "eventKind"::text AS event_kind, "createdAt"
       FROM "V2InboundMailEvent"
       WHERE "organizationId" = $1
         AND "eventKind" IN ('REPLY', 'BOUNCE_DSN', 'UNSUBSCRIBE')
         AND "correlatedLeadAssignmentId" IS NOT NULL
       ORDER BY "correlatedLeadAssignmentId", "createdAt" DESC
     ),
     unread AS (
       SELECT "correlatedLeadAssignmentId" AS lead_id, COUNT(*)::int AS n
       FROM "V2InboundMailEvent"
       WHERE "organizationId" = $1 AND "eventKind" = 'REPLY' AND "readAt" IS NULL
         AND "correlatedLeadAssignmentId" IS NOT NULL
       GROUP BY "correlatedLeadAssignmentId"
     ),
     last_outbound AS (
       SELECT DISTINCT ON ("leadAssignmentId")
         "leadAssignmentId" AS lead_id, COALESCE("sentAt", "createdAt") AS at
       FROM "V2OutreachMessage"
       WHERE "organizationId" = $1 AND "deletedAt" IS NULL
       ORDER BY "leadAssignmentId", COALESCE("sentAt", "createdAt") DESC
     )
     SELECT
       t.lead_id,
       la."workflowStatus"::text AS workflow_status,
       c."fullName" AS contact_name,
       comp."name" AS company_name,
       li."fromAddress" AS last_from,
       li."snippet" AS last_snippet,
       le.event_kind AS last_outcome,
       li."createdAt" AS last_inbound_at,
       GREATEST(le."createdAt", COALESCE(lo.at, le."createdAt")) AS last_activity_at,
       COALESCE(u.n, 0) AS unread
     FROM threads t
     JOIN "V2LeadAssignment" la
       ON la."id" = t.lead_id AND la."organizationId" = $1 AND la."deletedAt" IS NULL
     LEFT JOIN "V2Contact" c ON c."id" = la."contactId" AND c."deletedAt" IS NULL
     LEFT JOIN "V2Company" comp ON comp."id" = la."companyId" AND comp."deletedAt" IS NULL
     LEFT JOIN last_inbound li ON li.lead_id = t.lead_id
     LEFT JOIN last_event le ON le.lead_id = t.lead_id
     LEFT JOIN unread u ON u.lead_id = t.lead_id
     LEFT JOIN last_outbound lo ON lo.lead_id = t.lead_id
     ORDER BY last_activity_at DESC NULLS LAST
     LIMIT $2`,
    organizationId,
    limit
  );

  return rows.map((r) => ({
    leadAssignmentId: r.lead_id,
    workflowStatus: r.workflow_status,
    contactName: r.contact_name,
    companyName: r.company_name,
    lastFrom: r.last_from,
    lastSnippet: r.last_snippet,
    lastOutcome: r.last_outcome,
    lastInboundAt: r.last_inbound_at ? new Date(r.last_inbound_at).toISOString() : null,
    lastActivityAt: r.last_activity_at ? new Date(r.last_activity_at).toISOString() : null,
    unreadCount: Number(r.unread ?? 0),
    // Triage the latest inbound reply so the inbox list can chip meeting-intent / bounce /
    // unsubscribe / not-interested without opening the thread. Deterministic; no AI.
    replyClass: r.last_inbound_at && r.last_snippet ? classifyReply({ body: r.last_snippet }) : null,
  }));
}

// --- Unibox: conversations across sent + received (not reply-only). ------------------------------
export type ConversationTab = "all" | "received" | "sent";

export type ConversationSummary = InboxThreadSummary & {
  lastDirection: "INBOUND" | "OUTBOUND" | null;
  lastSubject: string | null;
  lastOutStatus: string | null;
  sentCount: number;
};

type ConversationRow = ThreadRow & {
  last_subject: string | null;
  last_out_status: string | null;
  last_outbound_at: Date | null;
  sent_count: number;
};

/**
 * Full Unibox feed: every LeadAssignment with any outbound message OR inbound reply, newest activity
 * first. `tab` narrows to received (has a reply) or sent (has outbound). The message/event store
 * already carries direction + timestamps, so this is a pure read model — no new plumbing. Contact
 * names are resolved (no raw email-as-name). Tenant-scoped (Inv 5), soft-delete respected (Inv 8).
 */
export async function queryConversations(
  organizationId: string,
  options: { tab?: ConversationTab; limit?: number } = {}
): Promise<ConversationSummary[]> {
  const tab = options.tab ?? "all";
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);
  const tabWhere = tab === "received" ? "li.lead_id IS NOT NULL" : tab === "sent" ? "lo.lead_id IS NOT NULL" : "TRUE";

  const rows = await prisma.$queryRawUnsafe<ConversationRow[]>(
    `WITH inbound_leads AS (
       SELECT DISTINCT "correlatedLeadAssignmentId" AS lead_id FROM "V2InboundMailEvent"
       WHERE "organizationId" = $1 AND "eventKind" IN ('REPLY','BOUNCE_DSN','UNSUBSCRIBE') AND "correlatedLeadAssignmentId" IS NOT NULL
     ),
     outbound_leads AS (
       SELECT DISTINCT "leadAssignmentId" AS lead_id FROM "V2OutreachMessage"
       WHERE "organizationId" = $1 AND "deletedAt" IS NULL
     ),
     threads AS (SELECT lead_id FROM inbound_leads UNION SELECT lead_id FROM outbound_leads),
     last_inbound AS (
       SELECT DISTINCT ON ("correlatedLeadAssignmentId") "correlatedLeadAssignmentId" AS lead_id, "snippet", "fromAddress", "createdAt"
       FROM "V2InboundMailEvent" WHERE "organizationId" = $1 AND "eventKind" = 'REPLY' AND "correlatedLeadAssignmentId" IS NOT NULL
       ORDER BY "correlatedLeadAssignmentId", "createdAt" DESC
     ),
     last_event AS (
       SELECT DISTINCT ON ("correlatedLeadAssignmentId") "correlatedLeadAssignmentId" AS lead_id, "eventKind"::text AS event_kind, "createdAt"
       FROM "V2InboundMailEvent" WHERE "organizationId" = $1 AND "eventKind" IN ('REPLY','BOUNCE_DSN','UNSUBSCRIBE') AND "correlatedLeadAssignmentId" IS NOT NULL
       ORDER BY "correlatedLeadAssignmentId", "createdAt" DESC
     ),
     unread AS (
       SELECT "correlatedLeadAssignmentId" AS lead_id, COUNT(*)::int AS n
       FROM "V2InboundMailEvent" WHERE "organizationId" = $1 AND "eventKind" = 'REPLY' AND "readAt" IS NULL AND "correlatedLeadAssignmentId" IS NOT NULL
       GROUP BY "correlatedLeadAssignmentId"
     ),
     last_outbound AS (
       SELECT DISTINCT ON ("leadAssignmentId") "leadAssignmentId" AS lead_id, "subject", "status"::text AS status, COALESCE("sentAt","createdAt") AS at
       FROM "V2OutreachMessage" WHERE "organizationId" = $1 AND "deletedAt" IS NULL
       ORDER BY "leadAssignmentId", COALESCE("sentAt","createdAt") DESC
     ),
     sent_count AS (
       SELECT "leadAssignmentId" AS lead_id, COUNT(*)::int AS n
       FROM "V2OutreachMessage" WHERE "organizationId" = $1 AND "deletedAt" IS NULL GROUP BY "leadAssignmentId"
     )
     SELECT
       t.lead_id,
       la."workflowStatus"::text AS workflow_status,
       c."fullName" AS contact_name,
       comp."name" AS company_name,
       li."fromAddress" AS last_from,
       li."snippet" AS last_snippet,
       le.event_kind AS last_outcome,
       li."createdAt" AS last_inbound_at,
       lo."subject" AS last_subject,
       lo.status AS last_out_status,
       lo.at AS last_outbound_at,
       GREATEST(COALESCE(li."createdAt", 'epoch'::timestamp), COALESCE(lo.at, 'epoch'::timestamp)) AS last_activity_at,
       COALESCE(u.n, 0) AS unread,
       COALESCE(sc.n, 0) AS sent_count
     FROM threads t
     JOIN "V2LeadAssignment" la ON la."id" = t.lead_id AND la."organizationId" = $1 AND la."deletedAt" IS NULL
     LEFT JOIN "V2Contact" c ON c."id" = la."contactId" AND c."deletedAt" IS NULL
     LEFT JOIN "V2Company" comp ON comp."id" = la."companyId" AND comp."deletedAt" IS NULL
     LEFT JOIN last_inbound li ON li.lead_id = t.lead_id
     LEFT JOIN last_event le ON le.lead_id = t.lead_id
     LEFT JOIN unread u ON u.lead_id = t.lead_id
     LEFT JOIN last_outbound lo ON lo.lead_id = t.lead_id
     LEFT JOIN sent_count sc ON sc.lead_id = t.lead_id
     WHERE ${tabWhere}
     ORDER BY last_activity_at DESC NULLS LAST
     LIMIT $2`,
    organizationId,
    limit
  );

  return rows.map((r) => {
    const inboundAt = r.last_inbound_at ? new Date(r.last_inbound_at).getTime() : 0;
    const outboundAt = r.last_outbound_at ? new Date(r.last_outbound_at).getTime() : 0;
    const lastDirection: "INBOUND" | "OUTBOUND" | null =
      inboundAt === 0 && outboundAt === 0 ? null : inboundAt >= outboundAt ? "INBOUND" : "OUTBOUND";
    return {
      leadAssignmentId: r.lead_id,
      workflowStatus: r.workflow_status,
      contactName: resolveContactDisplayName({ fullName: r.contact_name, companyName: r.company_name }),
      companyName: r.company_name,
      lastFrom: r.last_from,
      lastSnippet: r.last_snippet,
      lastOutcome: r.last_outcome,
      lastInboundAt: r.last_inbound_at ? new Date(r.last_inbound_at).toISOString() : null,
      lastActivityAt: r.last_activity_at ? new Date(r.last_activity_at).toISOString() : null,
      unreadCount: Number(r.unread ?? 0),
      replyClass: r.last_inbound_at && r.last_snippet ? classifyReply({ body: r.last_snippet }) : null,
      lastDirection,
      lastSubject: r.last_subject,
      lastOutStatus: r.last_out_status,
      sentCount: Number(r.sent_count ?? 0),
    };
  });
}

type HeaderRow = {
  workflow_status: string;
  contact_name: string | null;
  contact_title: string | null;
  company_name: string | null;
};

type MessageRow = {
  id: string;
  direction: "OUTBOUND" | "INBOUND";
  subject: string | null;
  body: string | null;
  address: string | null;
  status: string | null;
  occurred_at: Date | null;
  read_at: Date | null;
};

export async function queryInboxThread(
  organizationId: string,
  leadAssignmentId: string,
  options: { limit?: number } = {}
): Promise<InboxThread | null> {
  const limit = Math.min(Math.max(options.limit ?? INBOX_THREAD_PAGE_SIZE, 1), 500);
  const headerRows = await prisma.$queryRawUnsafe<HeaderRow[]>(
    `SELECT
       la."workflowStatus"::text AS workflow_status,
       c."fullName" AS contact_name,
       c."title" AS contact_title,
       comp."name" AS company_name
     FROM "V2LeadAssignment" la
     LEFT JOIN "V2Contact" c ON c."id" = la."contactId" AND c."deletedAt" IS NULL
     LEFT JOIN "V2Company" comp ON comp."id" = la."companyId" AND comp."deletedAt" IS NULL
     WHERE la."id" = $1 AND la."organizationId" = $2 AND la."deletedAt" IS NULL
     LIMIT 1`,
    leadAssignmentId,
    organizationId
  );
  const header = headerRows[0];
  if (!header) return null;

  // Fetch the newest `limit` messages (DESC) + 1 extra to detect older history,
  // then reverse to chronological order for display. Keeps long threads bounded.
  const messageRows = await prisma.$queryRawUnsafe<MessageRow[]>(
    `SELECT * FROM (
       SELECT "id", 'OUTBOUND' AS direction, "subject", "bodyRef" AS body,
              "toAddress" AS address, "status"::text AS status,
              COALESCE("sentAt", "createdAt") AS occurred_at, NULL::timestamp AS read_at
       FROM "V2OutreachMessage"
       WHERE "organizationId" = $1 AND "leadAssignmentId" = $2 AND "deletedAt" IS NULL
       UNION ALL
       SELECT "id", 'INBOUND' AS direction, "subject", "bodyText" AS body,
              "fromAddress" AS address, "eventKind"::text AS status,
              "createdAt" AS occurred_at, "readAt" AS read_at
       FROM "V2InboundMailEvent"
       WHERE "organizationId" = $1 AND "correlatedLeadAssignmentId" = $2 AND "eventKind" = 'REPLY'
     ) u
     ORDER BY occurred_at DESC NULLS LAST, id DESC
     LIMIT $3`,
    organizationId,
    leadAssignmentId,
    limit + 1
  );

  const hasMore = messageRows.length > limit;
  const windowRows = (hasMore ? messageRows.slice(0, limit) : messageRows).reverse();

  return {
    leadAssignmentId,
    workflowStatus: header.workflow_status,
    contactName: header.contact_name,
    contactTitle: header.contact_title,
    companyName: header.company_name,
    hasMore,
    messages: windowRows.map((m) => ({
      id: m.id,
      direction: m.direction,
      subject: m.subject,
      body: m.body,
      address: m.address,
      status: m.status,
      occurredAt: m.occurred_at ? new Date(m.occurred_at).toISOString() : null,
      readAt: m.read_at ? new Date(m.read_at).toISOString() : null,
    })),
  };
}

export type InboxReplyContext = {
  contactId: string | null;
  toAddress: string | null;
  inReplyToMessageId: string | null;
  suggestedSubject: string | null;
};

type ReplyContextRow = {
  contact_id: string | null;
  contact_email: string | null;
  in_reply_to_message_id: string | null;
  last_from: string | null;
  last_subject: string | null;
};

/** Prefer the contact's valid email; fall back to the address on the last inbound reply. */
function extractEmail(raw: string | null): string | null {
  if (!raw) return null;
  const angle = raw.match(/<([^>]+)>/);
  const candidate = (angle ? angle[1] : raw).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate.toLowerCase() : null;
}

/** Reply pre-fill for a thread: who to send to, what to thread against, a "Re:" subject. */
export async function queryInboxReplyContext(
  organizationId: string,
  leadAssignmentId: string
): Promise<InboxReplyContext | null> {
  const rows = await prisma.$queryRawUnsafe<ReplyContextRow[]>(
    `SELECT
       la."contactId" AS contact_id,
       (SELECT ci."normalizedValue" FROM "V2ContactIdentifier" ci
          WHERE ci."contactId" = la."contactId" AND ci."type" = 'EMAIL' AND ci."isValid" = true
          ORDER BY ci."createdAt" ASC LIMIT 1) AS contact_email,
       li."messageId" AS in_reply_to_message_id,
       li."fromAddress" AS last_from,
       li."subject" AS last_subject
     FROM "V2LeadAssignment" la
     LEFT JOIN LATERAL (
       SELECT "messageId", "fromAddress", "subject"
       FROM "V2InboundMailEvent"
       WHERE "organizationId" = $2 AND "correlatedLeadAssignmentId" = $1 AND "eventKind" = 'REPLY'
       ORDER BY "createdAt" DESC LIMIT 1
     ) li ON true
     WHERE la."id" = $1 AND la."organizationId" = $2 AND la."deletedAt" IS NULL
     LIMIT 1`,
    leadAssignmentId,
    organizationId
  );
  const r = rows[0];
  if (!r) return null;

  const subject = r.last_subject
    ? /^re:/i.test(r.last_subject)
      ? r.last_subject
      : `Re: ${r.last_subject}`
    : null;

  return {
    contactId: r.contact_id,
    toAddress: extractEmail(r.contact_email) ?? extractEmail(r.last_from),
    inReplyToMessageId: r.in_reply_to_message_id,
    suggestedSubject: subject,
  };
}
