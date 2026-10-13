import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { canAccessLead, requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { findSendableAccount } from '@/lib/email/sendableAccount';
import { mailboxRefusal, recipientRefusal } from '@/lib/email/sendGate';
import { mailboxQuota } from '@/lib/email/mailboxQuota';
import { buildChecklist } from '@/lib/email/preflight';
import { buildMergeContext } from '@/lib/templates/render';
import { loadRenderLead, loadRenderSender } from '@/lib/templates/renderContext';
import { findMissingMergeValues } from '@/lib/compose/merge';
import { unchipifyMergeTags } from '@/lib/compose/html';
import { composeRateLimit } from '@/lib/compose/rateLimit';
import { id, longText } from '@/lib/validation/core';

const schema = z.object({
  leadId: id,
  accountId: id,
  subject: z.string().max(998).default(''),
  body: longText.default(''),
  bulk: z.boolean().optional(),
});

/**
 * The pre-send checklist: recipient suppressed / do-not-contact, mailbox paused or unhealthy, sends
 * left today and this hour, merge fields with no value, and (for bulk) the unsubscribe footer.
 * Read-only - nothing is queued - and it uses the same gates the send route refuses with, so a
 * "blocking" item here is exactly a refusal there.
 */
export async function POST(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;
  const tenantId = user.tenantId;
  if (!tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
  const input = parsed.data;
  const limited = await composeRateLimit('checklist', user.id);
  if (limited) return limited;

  const lead = await prisma.lead.findFirst({ where: { id: input.leadId, tenantId } });
  if (!lead || !(await canAccessLead(user, lead))) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  const account = await findSendableAccount(user, tenantId, input.accountId);
  if (!account) return NextResponse.json({ error: 'Email account not found' }, { status: 404 });

  const [recipient, sentLastHour, renderLead, sender] = await Promise.all([
    recipientRefusal({ tenantId, email: lead.email, campaignId: lead.campaignId, emailInvalid: lead.emailInvalid }),
    prisma.outboundMessage.count({
      where: { tenantId, accountId: account.id, status: 'sent', sentAt: { gte: new Date(Date.now() - 3_600_000) } },
    }),
    loadRenderLead(tenantId, lead),
    loadRenderSender(tenantId, account.userId),
  ]);
  const context = buildMergeContext(renderLead, sender ?? user, { now: new Date() });
  const missing = [
    ...findMissingMergeValues(unchipifyMergeTags(input.subject), context),
    ...findMissingMergeValues(unchipifyMergeTags(input.body), context),
  ];

  return NextResponse.json(
    buildChecklist({
      recipientEmail: lead.email,
      recipientRefusal: recipient,
      mailboxRefusal: mailboxRefusal(account),
      mailboxEmail: account.email,
      healthLevel: account.healthLevel,
      quota: mailboxQuota(account, sentLastHour),
      missingFields: [...new Set(missing.map((m) => m.field))],
      bulk: input.bulk === true,
      body: input.body,
    }),
  );
}
