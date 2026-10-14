import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { canAccessLead, requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { isHtmlBlank } from '@/lib/compose/html';
import { composeRateLimit } from '@/lib/compose/rateLimit';
import { copyRecipientList, composeAttachmentIds } from '@/lib/validation/schemas';
import { id, longText } from '@/lib/validation/core';

/**
 * Draft autosave for the composer and the inbox reply box. One draft per (user, place): the lead
 * composer or an inbox thread. Owner-only and tenant-scoped - every query names the session user and
 * tenant, so a colleague's draft is invisible, not forbidden. Deleted when the email is queued
 * (the send routes) or discarded (DELETE).
 */
/** Drafts one user may keep; saving a new one past this prunes the least recently edited. */
export const MAX_DRAFTS_PER_USER = 200;

const scopeOf = (leadId: string, threadId?: string | null) => (threadId ? `thread:${threadId}` : `lead:${leadId}`);

const putSchema = z.object({
  leadId: id,
  threadId: z.string().min(1).max(500).optional(),
  accountId: id.optional(),
  subject: z.string().max(998).default(''),
  bodyHtml: longText.default(''),
  cc: copyRecipientList.optional(),
  bcc: copyRecipientList.optional(),
  attachmentIds: composeAttachmentIds.optional(),
});

async function guard(user: SessionUser, leadId: string) {
  if (!user.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 401 });
  const lead = await prisma.lead.findFirst({ where: { id: leadId, tenantId: user.tenantId }, select: { assignedToId: true, campaignId: true, tenantId: true } });
  if (!lead || !(await canAccessLead(user, lead))) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  return null;
}

export async function GET(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;
  const url = new URL(req.url);
  const leadId = url.searchParams.get('leadId');
  if (!leadId) return NextResponse.json({ error: 'leadId is required' }, { status: 400 });
  const refused = await guard(user, leadId);
  if (refused) return refused;

  const draft = await prisma.emailDraft.findFirst({
    where: { tenantId: user.tenantId!, userId: user.id, scopeKey: scopeOf(leadId, url.searchParams.get('threadId')) },
  });
  if (!draft) return NextResponse.json({ draft: null });
  // A file that was swept, or went out with another email, is dropped - the draft never vouches for it.
  const attachments = draft.attachmentIds.length
    ? await prisma.attachment.findMany({
        where: { id: { in: draft.attachmentIds }, tenantId: user.tenantId!, uploadedById: user.id, outboundMessageId: null, cid: null },
        select: { id: true, name: true, contentType: true, sizeBytes: true },
      })
    : [];
  return NextResponse.json({
    draft: {
      subject: draft.subject, bodyHtml: draft.bodyHtml, cc: draft.cc, bcc: draft.bcc,
      accountId: draft.accountId, attachments, updatedAt: draft.updatedAt,
    },
  });
}

export async function PUT(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid draft' }, { status: 400 });
  const input = parsed.data;
  const refused = await guard(user, input.leadId);
  if (refused) return refused;
  const limited = await composeRateLimit('draft', user.id);
  if (limited) return limited;

  const tenantId = user.tenantId!;
  const scopeKey = scopeOf(input.leadId, input.threadId);
  // Nothing worth keeping: the draft is removed rather than stored empty.
  if (isHtmlBlank(input.bodyHtml) && !input.subject.trim() && !(input.attachmentIds?.length)) {
    await prisma.emailDraft.deleteMany({ where: { tenantId, userId: user.id, scopeKey } });
    return NextResponse.json({ saved: false });
  }
  const data = {
    leadId: input.leadId,
    threadId: input.threadId ?? null,
    accountId: input.accountId ?? null,
    subject: input.subject,
    bodyHtml: input.bodyHtml,
    cc: input.cc ?? [],
    bcc: input.bcc ?? [],
    attachmentIds: input.attachmentIds ?? [],
  };
  const existing = await prisma.emailDraft.findFirst({ where: { tenantId, userId: user.id, scopeKey }, select: { id: true } });
  if (!existing) {
    const count = await prisma.emailDraft.count({ where: { tenantId, userId: user.id } });
    if (count >= MAX_DRAFTS_PER_USER) {
      const stale = await prisma.emailDraft.findMany({
        where: { tenantId, userId: user.id },
        orderBy: { updatedAt: 'asc' },
        take: count - MAX_DRAFTS_PER_USER + 1,
        select: { id: true },
      });
      await prisma.emailDraft.deleteMany({ where: { tenantId, userId: user.id, id: { in: stale.map((d) => d.id) } } });
    }
  }
  const saved = await prisma.emailDraft.upsert({
    where: { tenantId_userId_scopeKey: { tenantId, userId: user.id, scopeKey } },
    create: { ...data, tenantId, userId: user.id, scopeKey },
    update: data,
    select: { updatedAt: true },
  });
  return NextResponse.json({ saved: true, updatedAt: saved.updatedAt });
}

export async function DELETE(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;
  if (!user.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 401 });
  const url = new URL(req.url);
  const leadId = url.searchParams.get('leadId');
  if (!leadId) return NextResponse.json({ error: 'leadId is required' }, { status: 400 });
  await prisma.emailDraft.deleteMany({
    where: { tenantId: user.tenantId, userId: user.id, scopeKey: scopeOf(leadId, url.searchParams.get('threadId')) },
  });
  return NextResponse.json({ success: true });
}
