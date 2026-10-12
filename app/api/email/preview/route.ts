import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { canAccessLead, requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { canViewOwned } from '@/lib/visibility';
import { findSendableAccount } from '@/lib/email/sendableAccount';
import { buildMergeContext, renderTemplate } from '@/lib/templates/render';
import { findMissingMergeValues } from '@/lib/compose/merge';
import { plainTextToHtml, sanitizeComposeHtml, unchipifyMergeTags } from '@/lib/compose/html';
import { isHtml } from '@/lib/email/sanitize';
import { id, longText } from '@/lib/validation/core';
import { composeRateLimit } from '@/lib/compose/rateLimit';

/**
 * "Preview as this lead": the draft (or a template) rendered with the real lead and the real
 * sender - the mailbox the email would leave from - so the rep sees "Hi Linh" and not
 * "Hi {{firstName}}", and which merge fields the lead has no value for.
 *
 * Read-only: nothing is stored or queued. It uses exactly `renderTemplate`, the function the send
 * route and the worker use, so the preview cannot say something the email will not.
 */
const previewSchema = z
  .object({
    leadId: id,
    accountId: id.optional(),
    templateId: id.optional(),
    subject: z.string().max(998).optional(),
    body: longText.optional(),
  })
  .refine((value) => value.templateId || value.body !== undefined, { message: 'Give a templateId or a body' });

async function preview(user: SessionUser, input: z.infer<typeof previewSchema>) {
  const tenantId = user.tenantId;
  if (!tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 401 });
  const limited = await composeRateLimit('preview', user.id);
  if (limited) return limited;

  const lead = await prisma.lead.findFirst({ where: { id: input.leadId, tenantId } });
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  if (!(await canAccessLead(user, lead))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // The sender is whoever owns the mailbox, as in the send route. Without a mailbox id: the
  // caller's own first mailbox, then the caller.
  let account = input.accountId ? await findSendableAccount(user, tenantId, input.accountId) : null;
  if (input.accountId && !account) return NextResponse.json({ error: 'Email account not found' }, { status: 404 });
  if (!account) {
    account = await prisma.emailAccount.findFirst({
      where: { tenantId, isActive: true, userId: user.id },
      orderBy: { createdAt: 'asc' },
    });
  }
  const sender =
    (account
      ? await prisma.user.findFirst({ where: { id: account.userId, tenantId }, select: { firstName: true, lastName: true, role: true } })
      : null) ?? user;

  let subject = input.subject ?? '';
  let body = input.body ?? '';
  if (input.templateId) {
    const template = await prisma.template.findFirst({ where: { id: input.templateId, tenantId } });
    // A template the caller may not see is "not found", not "forbidden" (lib/visibility.ts).
    if (!template || !(await canViewOwned(user, template))) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }
    subject = template.subject ?? '';
    body = template.body;
  }

  const context = buildMergeContext(lead, sender);
  const missing = [
    ...findMissingMergeValues(subject, context).map((m) => ({ ...m, where: 'subject' as const })),
    ...findMissingMergeValues(body, context).map((m) => ({ ...m, where: 'body' as const })),
  ];

  const rawBody = unchipifyMergeTags(body);
  const rendered = renderTemplate(rawBody, lead, sender);
  return NextResponse.json({
    subject: renderTemplate(subject, lead, sender),
    // Always HTML for display; sanitised here as well as on send.
    bodyHtml: isHtml(rendered) ? sanitizeComposeHtml(rendered) : plainTextToHtml(rendered),
    missing,
    lead: { firstName: lead.firstName, lastName: lead.lastName, company: lead.company, email: lead.email },
    sender: {
      name: [sender.firstName, sender.lastName].filter(Boolean).join(' '),
      email: account?.email ?? null,
    },
  });
}

export async function GET(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  // A saved template only. A draft's text does not travel in a query string (it lands in access
  // logs and browser history); POST carries it.
  const url = new URL(req.url);
  const parsed = previewSchema.safeParse({
    leadId: url.searchParams.get('leadId') ?? undefined,
    accountId: url.searchParams.get('accountId') ?? undefined,
    templateId: url.searchParams.get('templateId') ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid preview' }, { status: 400 });
  return preview(userOrRes as SessionUser, parsed.data);
}

/** A preview of draft text (or a template): the body stays out of the URL. */
export async function POST(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const parsed = previewSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid preview' }, { status: 400 });
  return preview(userOrRes as SessionUser, parsed.data);
}
