import Link from "next/link";
import { revalidatePath } from "next/cache";
import { ArrowLeft, Send, ShieldAlert, CornerDownLeft } from "lucide-react";

import { PageHeader } from "@/components/shared/PageHeader";
import { PanelCard } from "@/components/shared/PanelCard";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { prisma } from "@/lib/server/prisma";
import { createManualSend, type ManualSendDb } from "@/lib/v2/outreach/send/createManualSend";
import { drainIfNoWorker } from "@/lib/v2/jobs/drainIfNoWorker";
import type { V2JobDatabase } from "@/lib/v2/jobs/types";
import {
  queryInboxThread,
  queryInboxReplyContext,
  INBOX_THREAD_PAGE_SIZE,
  type InboxThreadMessage,
} from "@/lib/v2/outreach/inbox/queryInbox";
import { markThreadRead } from "@/lib/v2/outreach/inbox/markThreadRead";
import { getTenantErrorMessage, requirePermission, V2TenantError } from "@/lib/v2/tenant";

export const dynamic = "force-dynamic";

// Unibox thread view: the full conversation for one lead (outbound + inbound,
// time-ordered) plus an in-app reply box. Opening the thread marks its inbound
// replies read (idempotent, tenant-scoped). Replying reuses createManualSend, so
// the SUPPRESSION GATE still runs as the last synchronous check in the send
// handler (Invariant 10) — the inbox never bypasses it.

type SenderPick = { id: string; displayName: string; fromAddress: string; status: string };

async function replyAction(formData: FormData) {
  "use server";
  let context;
  try {
    context = await requirePermission("workflow.update");
  } catch {
    return;
  }
  const get = (k: string) => (formData.get(k)?.toString() ?? "").trim();
  const leadAssignmentId = get("leadAssignmentId");
  const senderAccountId = get("senderAccountId");
  const toAddress = get("toAddress");
  const contactId = get("contactId") || null;
  const inReplyToId = get("inReplyToId") || null;
  const subject = get("subject");
  const body = get("body");
  if (!leadAssignmentId || !senderAccountId || !toAddress || !body) return;

  try {
    await createManualSend(prisma as unknown as ManualSendDb, {
      organizationId: context.organizationId,
      createdByUserId: context.userId,
      leadAssignmentId,
      contactId,
      senderAccountId,
      toAddress,
      subject,
      body,
      inReplyToId,
      sendRequestId: `${Date.now()}`,
    });
    // Worker-aware: a live worker sends the reply async (suppression gate runs in the
    // handler); inline drain only as the zero-worker fallback. The thread reloads either way.
    await drainIfNoWorker(prisma as unknown as V2JobDatabase, {
      organizationId: context.organizationId,
      jobType: "EMAIL_SEND",
      max: 3,
    });
  } catch {
    // swallow — the message row + activity record the outcome; the thread reloads.
  }
  revalidatePath(`/v2/outreach/inbox/${leadAssignmentId}`);
}

export default async function V2OutreachThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ leadAssignmentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { leadAssignmentId } = await params;
  const sp = await searchParams;
  const limitRaw = Array.isArray(sp.limit) ? sp.limit[0] : sp.limit;
  const limit = Math.min(Math.max(Number(limitRaw) || INBOX_THREAD_PAGE_SIZE, INBOX_THREAD_PAGE_SIZE), 500);
  const context = await getContext();
  if (context instanceof V2TenantError) {
    const msg = getTenantErrorMessage(context);
    return (
      <WorkspaceFrame>
        <div className="max-w-xl rounded-lg border border-border bg-white p-6">
          <div className="text-sm font-semibold text-foreground">{msg.title}</div>
          <p className="mt-2 text-sm text-muted-foreground">{msg.message}</p>
        </div>
      </WorkspaceFrame>
    );
  }

  // Opening the thread marks its inbound replies read (idempotent) before render.
  await markThreadRead(context.organizationId, leadAssignmentId);

  const [thread, replyCtx, senders] = await Promise.all([
    queryInboxThread(context.organizationId, leadAssignmentId, { limit }),
    queryInboxReplyContext(context.organizationId, leadAssignmentId),
    loadSenders(context.organizationId),
  ]);

  if (!thread) {
    return (
      <WorkspaceFrame>
        <div className="max-w-xl rounded-lg border border-border bg-white p-6">
          <div className="text-sm font-semibold text-foreground">Thread not found</div>
          <p className="mt-2 text-sm text-muted-foreground">This conversation does not exist or is not in your organization.</p>
          <Link href="/v2/outreach/inbox" className="mt-3 inline-flex text-sm font-medium text-primary hover:text-primary">
            Back to inbox
          </Link>
        </div>
      </WorkspaceFrame>
    );
  }

  const toAddress = replyCtx?.toAddress ?? null;
  const suppressed = toAddress ? await isSuppressed(context.organizationId, toAddress) : false;
  const healthySender = senders.find((s) => s.status === "ACTIVE") ?? null;
  const canReply = Boolean(toAddress && !suppressed && healthySender);
  const title = [thread.companyName, thread.contactName].filter(Boolean).join(" · ") || "Conversation";

  return (
    <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0">
      <PageHeader eyebrow="Outreach · Inbox" title={title} description={thread.contactTitle ?? undefined} />

      <div className="space-y-5 p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <Link href="/v2/outreach/inbox" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to inbox
          </Link>
          <Link
            href={`/v2/workspace/leads?selectedLeadId=${leadAssignmentId}`}
            className="text-xs font-medium text-primary hover:text-primary"
          >
            Open the lead
          </Link>
        </div>

        <PanelCard title="Conversation" contentClassName="p-4">
          {thread.messages.length === 0 ? (
            <div className="px-2 py-8 text-center text-sm text-muted-foreground">No messages on this thread yet.</div>
          ) : (
            <>
              {thread.hasMore ? (
                <div className="mb-3 text-center">
                  <Link
                    href={`/v2/outreach/inbox/${leadAssignmentId}?limit=${limit + INBOX_THREAD_PAGE_SIZE}`}
                    className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/40"
                  >
                    Load earlier messages
                  </Link>
                </div>
              ) : null}
              <ol className="space-y-3">
                {thread.messages.map((m) => (
                  <MessageBubble key={m.id} message={m} />
                ))}
              </ol>
            </>
          )}
        </PanelCard>

        <PanelCard title="Reply" contentClassName="p-4">
          {!canReply ? (
            <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
              <div className="text-sm text-amber-800">
                {!toAddress
                  ? "No recipient email on this lead — cannot reply."
                  : suppressed
                    ? "Recipient is suppressed (unsubscribed/bounced) — replies are blocked."
                    : "No healthy sender available. Add or activate a sender first."}
              </div>
            </div>
          ) : null}

          <form action={replyAction} className="space-y-3">
            <input type="hidden" name="leadAssignmentId" value={leadAssignmentId} />
            <input type="hidden" name="toAddress" value={toAddress ?? ""} />
            <input type="hidden" name="contactId" value={replyCtx?.contactId ?? ""} />
            <input type="hidden" name="inReplyToId" value={replyCtx?.inReplyToMessageId ?? ""} />

            <div className="grid gap-3 sm:grid-cols-2">
              <Labeled label="To">
                <div className="flex h-9 items-center rounded-md border border-border bg-muted/40 px-3 text-sm text-foreground">
                  {toAddress ?? "No email on file"}
                </div>
              </Labeled>
              <Labeled label="From sender">
                <select name="senderAccountId" className={inputCls} defaultValue={healthySender?.id ?? ""}>
                  {senders.map((s) => (
                    <option key={s.id} value={s.id} disabled={s.status !== "ACTIVE"}>
                      {s.displayName} ({s.fromAddress}){s.status !== "ACTIVE" ? ` — ${s.status}` : ""}
                    </option>
                  ))}
                </select>
              </Labeled>
            </div>

            <Labeled label="Subject">
              <input name="subject" className={inputCls} defaultValue={replyCtx?.suggestedSubject ?? ""} required />
            </Labeled>
            <Labeled label="Message">
              <textarea name="body" rows={8} className={`${inputCls} h-auto py-2`} placeholder="Write your reply…" required />
            </Labeled>

            <div className="flex items-center justify-between border-t border-border pt-3">
              <span className="text-xs text-muted-foreground">The suppression gate runs at send time (Invariant 10).</span>
              <button
                type="submit"
                disabled={!canReply}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-primary disabled:cursor-not-allowed disabled:bg-foreground"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
                Send reply (gated)
              </button>
            </div>
          </form>
        </PanelCard>
      </div>
    </WorkspaceFrame>
  );
}

function MessageBubble({ message }: { message: InboxThreadMessage }) {
  const outbound = message.direction === "OUTBOUND";
  return (
    <li className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[80%] rounded-2xl border px-4 py-2.5 ${outbound ? "border-primary/20 bg-accent" : "border-border bg-white"}`}>
        <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
          {outbound ? <CornerDownLeft className="h-3 w-3" aria-hidden="true" /> : null}
          <span className="font-medium text-muted-foreground">{outbound ? "You" : message.address ?? "Them"}</span>
          {message.status ? <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">{message.status}</span> : null}
          <span>{message.occurredAt ? new Date(message.occurredAt).toLocaleString() : ""}</span>
        </div>
        {message.subject ? <div className="text-xs font-semibold text-foreground">{message.subject}</div> : null}
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground">
          {message.body ?? "(no body stored)"}
        </p>
      </div>
    </li>
  );
}

const inputCls =
  "h-9 w-full rounded-md border border-border bg-white px-3 text-sm text-foreground outline-none focus:border-primary/20 focus:ring-2 focus:ring-primary/20";

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

async function loadSenders(organizationId: string): Promise<SenderPick[]> {
  return prisma.$queryRawUnsafe<SenderPick[]>(
    `SELECT "id", "displayName", "fromAddress", "status"::text AS "status"
     FROM "V2SenderAccount"
     WHERE "organizationId" = $1 AND "deletedAt" IS NULL
     ORDER BY "createdAt" DESC`,
    organizationId
  );
}

async function isSuppressed(organizationId: string, email: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT COUNT(*)::int AS n FROM "V2SuppressionEntry"
     WHERE "organizationId" = $1 AND "deletedAt" IS NULL
       AND "identifierType" = 'EMAIL' AND "identifierValueNormalized" = $2
       AND ("expiresAt" IS NULL OR "expiresAt" > CURRENT_TIMESTAMP)`,
    organizationId,
    email.toLowerCase()
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

async function getContext() {
  try {
    return await requirePermission("crm.read");
  } catch (error) {
    if (error instanceof V2TenantError) return error;
    throw error;
  }
}
