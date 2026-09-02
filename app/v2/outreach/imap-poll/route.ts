import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/server/prisma";
import { loadImapConnectionConfig } from "@/lib/v2/outreach/credentials/credentialLoader";
import { applyInboundEvent } from "@/lib/v2/outreach/inbound/applyInboundEvent";
import { recordWorkerHeartbeat } from "@/lib/v2/outreach/worker/heartbeat";
import type { InboundHeaders } from "@/lib/v2/outreach/inbound/correlateInbound";

// OL3: IMAP poll target. A cron / the v2-imap-poller script POSTs here on an
// interval with the worker secret. For each active sender with IMAP configured it
// fetches mailbox UIDs above the high-water mark (derived from the highest
// V2InboundMailEvent.mailboxUid already stored — no extra column), parses each
// message, and hands it to the OL2 apply runtime. Idempotent: the unique
// (senderAccountId, mailboxUid) means a re-poll re-processes nothing. Secret-gated
// (no user session); credentials are decrypted in-memory only and never logged.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PER_SENDER = 200;

type SenderImapRow = {
  id: string;
  organizationId: string;
  imapHost: string | null;
  imapPort: number | null;
  imapSecure: boolean | null;
  imapAuthEnc: unknown;
};

export async function POST(request: NextRequest) {
  const expected = process.env.V2_WORKER_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "IMAP poll disabled (V2_WORKER_SECRET not set)." }, { status: 503 });
  }
  const provided = request.headers.get("x-v2-worker-secret");
  if (!provided || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.V2_OUTREACH_CREDENTIAL_KEY) {
    return NextResponse.json({ error: "IMAP poll disabled (V2_OUTREACH_CREDENTIAL_KEY not set)." }, { status: 503 });
  }

  // Proof of life for the IMAP poller daemon.
  await recordWorkerHeartbeat("imap_poller");

  const senders = await prisma.$queryRawUnsafe<SenderImapRow[]>(
    `SELECT "id", "organizationId", "imapHost", "imapPort", "imapSecure", "imapAuthEnc"
     FROM "V2SenderAccount"
     WHERE "deletedAt" IS NULL AND "status" = 'ACTIVE' AND "imapHost" IS NOT NULL AND "imapAuthEnc" IS NOT NULL`
  );

  let imapflow: typeof import("imapflow");
  let mailparser: typeof import("mailparser");
  try {
    imapflow = await import("imapflow");
    mailparser = await import("mailparser");
  } catch {
    return NextResponse.json({ error: "IMAP libraries unavailable." }, { status: 500 });
  }

  const summary: Array<{ senderId: string; fetched: number; applied: number; errors: number }> = [];

  for (const sender of senders) {
    const stat = { senderId: sender.id, fetched: 0, applied: 0, errors: 0 };
    try {
      const config = loadImapConnectionConfig({
        smtpHost: "",
        smtpPort: 0,
        smtpSecure: true,
        smtpAuthEnc: null,
        imapHost: sender.imapHost,
        imapPort: sender.imapPort,
        imapSecure: sender.imapSecure,
        imapAuthEnc: sender.imapAuthEnc,
      });
      if (!config) {
        summary.push(stat);
        continue;
      }

      const watermark = await loadWatermark(sender.id);
      const ourIds = await loadOutboundMessageIds(sender.id, sender.organizationId);

      const client = new imapflow.ImapFlow({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: { user: config.auth.user, pass: config.auth.pass },
        logger: false,
      });
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      try {
        const uids = (await client.search({ uid: `${watermark + 1}:*` }, { uid: true })) || [];
        const batch = uids.filter((uid) => uid > watermark).sort((a, b) => a - b).slice(0, MAX_PER_SENDER);
        for (const uid of batch) {
          stat.fetched++;
          try {
            const msg = await client.fetchOne(uid, { source: true }, { uid: true });
            if (!msg || !msg.source) continue;
            const parsed = await mailparser.simpleParser(msg.source);
            const headers = toInboundHeaders(parsed);
            const result = await applyInboundEvent(prisma, {
              organizationId: sender.organizationId,
              senderAccountId: sender.id,
              mailboxUid: String(uid),
              inboundMessageId: typeof parsed.messageId === "string" ? parsed.messageId : null,
              headers,
              ourOutboundMessageIds: ourIds,
            });
            if (result.applied) stat.applied++;
          } catch {
            stat.errors++;
          }
        }
      } finally {
        lock.release();
        await client.logout().catch(() => {});
      }
    } catch {
      stat.errors++;
    }
    summary.push(stat);
  }

  return NextResponse.json({ ok: true, senders: summary.length, summary });
}

async function loadWatermark(senderAccountId: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ max: number | null }>>(
    `SELECT MAX(CAST("mailboxUid" AS BIGINT))::int AS "max"
     FROM "V2InboundMailEvent"
     WHERE "senderAccountId" = $1 AND "mailboxUid" ~ '^[0-9]+$'`,
    senderAccountId
  );
  const max = rows[0]?.max;
  return typeof max === "number" && Number.isFinite(max) ? max : 0;
}

async function loadOutboundMessageIds(
  senderAccountId: string,
  organizationId: string
): Promise<ReadonlySet<string>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ providerMessageId: string }>>(
    `SELECT "providerMessageId" FROM "V2OutreachMessage"
     WHERE "organizationId" = $1 AND "senderAccountId" = $2
       AND "providerMessageId" IS NOT NULL AND "deletedAt" IS NULL`,
    organizationId,
    senderAccountId
  );
  return new Set(rows.map((row) => row.providerMessageId));
}

function toInboundHeaders(parsed: {
  from?: { text?: string };
  subject?: string;
  inReplyTo?: string;
  references?: string | string[];
  headerLines?: ReadonlyArray<{ line: string }>;
  text?: string;
}): InboundHeaders {
  const rawHeaders = (parsed.headerLines ?? []).map((h) => h.line).join("\n");
  const references = Array.isArray(parsed.references)
    ? parsed.references.join(" ")
    : parsed.references;
  return {
    from: parsed.from?.text,
    subject: parsed.subject,
    inReplyTo: parsed.inReplyTo,
    references,
    rawHeaders,
    rawBody: parsed.text ?? "",
  };
}
