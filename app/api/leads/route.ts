import { NextRequest, NextResponse } from 'next/server';
import { IcpQualification, Prisma, ProspectOperatingState } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAuth, canAccessUser, canReferenceCampaign, getLeadWhereScope } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { parseBody, capLimit } from '@/lib/validation/core';
import { createLeadSchema, leadStage, priority as prioritySchema } from '@/lib/validation/schemas';
import { buildLeadListWhere } from '@/lib/leads/listQuery';
import { findAccentInsensitiveIds, LEAD_SEARCH_COLUMNS } from '@/lib/search/accentSearch';
import { handleApiError } from '@/lib/api/errors';
import { normalizePhone, normalizeLinkedIn } from '@/lib/leads/normalize';
import { scoreLead } from '@/lib/leads/scoring';
import { scoreNewLead } from '@/lib/leads/scoreNewLead';

export async function GET(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search') || undefined;
  const stageRaw = searchParams.get('stage') || undefined;
  const priorityRaw = searchParams.get('priority') || undefined;
  const assignedTo = searchParams.get('assignedTo') || undefined;
  const campaignId = searchParams.get('campaignId') || undefined;
  const source = searchParams.get('source') || undefined;
  const importListName = searchParams.get('importListName') || undefined;
  const emailValidation = searchParams.get('emailValidation') || undefined;
  const country = searchParams.get('country') || undefined;
  const industry = searchParams.get('industry') || undefined;
  const tag = searchParams.get('tag') || undefined;
  const dateFrom = searchParams.get('dateFrom') || undefined;
  const dateTo = searchParams.get('dateTo') || undefined;
  const limit = capLimit(searchParams.get('limit'), 200, 500);
  const archivedRaw = searchParams.get('archived') === 'true';
  const includeArchived = archivedRaw && user.role !== 'sdr';

  // Validate enum filters up front — reject bad values instead of casting blindly.
  const stageCheck = stageRaw ? leadStage.safeParse(stageRaw) : null;
  if (stageCheck && !stageCheck.success) {
    return NextResponse.json({ error: 'Invalid stage filter' }, { status: 400 });
  }
  const priorityCheck = priorityRaw ? prioritySchema.safeParse(priorityRaw) : null;
  if (priorityCheck && !priorityCheck.success) {
    return NextResponse.json({ error: 'Invalid priority filter' }, { status: 400 });
  }
  // The attention banner links to `?operatingState=unassigned`; a filter the list did not
  // honour was a button that went nowhere. Validated against the enum like the two above.
  const operatingStateRaw = searchParams.get('operatingState') || undefined;
  const operatingState = operatingStateRaw
    ? (Object.values(ProspectOperatingState) as string[]).includes(operatingStateRaw)
      ? (operatingStateRaw as ProspectOperatingState)
      : null
    : undefined;
  if (operatingState === null) {
    return NextResponse.json({ error: 'Invalid operatingState filter' }, { status: 400 });
  }
  const icpQualificationRaw = searchParams.get('icpQualification') || undefined;
  const icpQualification = icpQualificationRaw
    ? (Object.values(IcpQualification) as string[]).includes(icpQualificationRaw)
      ? (icpQualificationRaw as IcpQualification)
      : null
    : undefined;
  if (icpQualification === null) {
    return NextResponse.json({ error: 'Invalid icpQualification filter' }, { status: 400 });
  }
  const icpUnscored = searchParams.get('icpUnscored') === 'true';

  // Scope: user axis for SDR/TL/FM/Director, account axis for leadgen.
  // Director / leadgen-manager → all; leadgen-member → assigned campaigns only.
  // Composed with AND so no filter/search can override it (BUG-001).
  const roleScope = (await getLeadWhereScope(user)) as Prisma.LeadWhereInput;

  // Accent-insensitive search resolves ids in SQL first — folding only the query cannot
  // make "Nguyen Hai" match a record stored as "Nguyễn Hải". Narrowing only; the role
  // scope above is still ANDed on top and cannot be widened.
  const searchIds = await findAccentInsensitiveIds(
    'Lead',
    LEAD_SEARCH_COLUMNS,
    search,
    user.tenantId
  );

  try {
    const leads = await prisma.lead.findMany({
      take: limit,
      where: buildLeadListWhere(roleScope, {
        stage: stageCheck?.success ? stageCheck.data : undefined,
        priority: priorityCheck?.success ? priorityCheck.data : undefined,
        assignedTo,
        campaignId,
        operatingState,
        icpQualification,
        icpUnscored,
        source,
        importListName,
        emailValidation,
        country,
        industry,
        tag,
        dateFrom,
        dateTo,
        search,
        searchIds,
        includeArchived,
      }),
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        campaign: { select: { id: true, name: true } },
        contact: {
          select: {
            fullName: true,
            department: true,
            seniority: true,
            country: true,
            secondaryPhone: true,
            emailValidation: true,
            emailScore: true,
            alternateEmail: true,
          },
        },
        account: {
          select: {
            website: true,
            domain: true,
            industry: true,
            country: true,
            companyPhone: true,
            linkedIn: true,
            staffCountRange: true,
            staffCountMin: true,
            staffCountMax: true,
            size: true,
          },
        },
        _count: { select: { tasks: true, notes: true, meetings: true } },
        tasks: {
          where: { status: 'pending' },
          orderBy: { dueDate: 'asc' },
          take: 5,
          select: { dueDate: true, type: true, status: true, sequenceId: true },
        },
      },
      orderBy: [{ crmPriorityScore: 'asc' }, { updatedAt: 'desc' }],
    });

    const atRiskCutoff = new Date(Date.now() - 3 * 86400000);

    const enriched = leads.map((l: any) => ({
      ...l,
      priority: l.crmPriorityScore,
      nextTaskDue: l.tasks?.[0]?.dueDate ?? null,
      nextTaskType: l.tasks?.[0]?.type ?? null,
      atRisk: (l.tasks ?? []).some(
        (t: any) => t.sequenceId && new Date(t.dueDate) < atRiskCutoff
      ),
      // Computed the same way the detail route does, so the list and the panel agree. This
      // used to read the stored column, which was null for 87% of production leads while the
      // panel showed a live 0 for the same lead.
      aiScore: scoreLead({ ...l, meetingCount: l._count?.meetings ?? 0 }).score,
      aiLabel: l.crmPriorityScore === 'hot' ? 'hot' : l.crmPriorityScore === 'warm' ? 'warm' : 'cold',
      tasks: undefined,
    }));

    // The list is capped (default 200, max 500) and nothing told the client so. A pipeline
    // view that silently stops at 200 lets a manager bulk-assign "everyone" and miss the rest.
    // Body stays a bare array; the cap travels in headers.
    return NextResponse.json(enriched, {
      headers: { 'X-Leads-Limit': String(limit), 'X-Leads-Truncated': enriched.length >= limit ? 'true' : 'false' },
    });
  } catch (err) {
    return handleApiError('api/leads GET', err);
  }
}

export async function POST(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const parsed = await parseBody(req, createLeadSchema, 'Invalid lead create');
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  const targetAssignedToId = body.assignedToId ?? user.id;
  if (targetAssignedToId !== user.id && !(await canAccessUser(user, targetAssignedToId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Checked here, before the `try` below creates or updates an Account and a Contact.
  // Validating only at `lead.create` would still refuse the lead, but the request would already
  // have written two durable rows into the tenant on its way to failing — a rejected request
  // must not leave partial state behind.
  if (body.campaignId) {
    const campaignCheck = await canReferenceCampaign(user, body.campaignId);
    if (campaignCheck === 'not_found') {
      // Same answer for "does not exist" and "belongs to another tenant": distinguishing them
      // would confirm the existence of foreign rows to anyone willing to guess ids.
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }
    if (campaignCheck === 'forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  try {
    // No explicit priority → derive it from the AI lead score (hot/warm/cold)
    const aiScore = body.priority ? null : scoreLead({
      ...body,
      id: 'new',
      stage: body.stage ?? 'new',
      crmPriorityScore: body.priority ?? 'warm',
      tags: body.tags ?? [],
      lastContactedAt: null,
      nextTaskDue: null,
      createdAt: new Date().toISOString(),
      activities: [],
      tasks: [],
    });
    const priority: 'hot' | 'warm' | 'cold' = body.priority ?? aiScore?.label ?? 'warm';

    // Create or find Account by company
    let account: { id: string } | null = null;
    if (body.company?.trim()) {
      account = await prisma.account.findUnique({
        where: { tenantId_name: { tenantId: user.tenantId!, name: body.company.trim() } },
      });
      if (!account) {
        account = await prisma.account.create({
          data: { name: body.company.trim(), tenantId: user.tenantId! },
        });
      }
    }

    // Create or find Contact (person-level dedup)
    const normalizedEmail = body.email.toLowerCase().trim();
    let contact = await prisma.contact.findUnique({
      where: { tenantId_normalizedEmail: { tenantId: user.tenantId!, normalizedEmail } },
    });
    if (contact) {
      contact = await prisma.contact.update({
        where: { id: contact.id },
        data: { firstName: body.firstName, lastName: body.lastName, company: body.company, title: body.title, email: body.email, phone: body.phone, linkedIn: body.linkedIn, whatsApp: body.whatsApp, normalizedEmail, normalizedPhone: normalizePhone(body.phone), normalizedLinkedIn: normalizeLinkedIn(body.linkedIn) },
      });
    } else {
      contact = await prisma.contact.create({
        data: { firstName: body.firstName, lastName: body.lastName, company: body.company, title: body.title, email: body.email, phone: body.phone, linkedIn: body.linkedIn, whatsApp: body.whatsApp, normalizedEmail, normalizedPhone: normalizePhone(body.phone), normalizedLinkedIn: normalizeLinkedIn(body.linkedIn), tenantId: user.tenantId! },
      });
    }

    const lead = await prisma.lead.create({
      data: {
        contactId: contact.id,
        accountId: account?.id ?? null,
        firstName: body.firstName,
        lastName: body.lastName,
        company: body.company,
        title: body.title,
        email: body.email,
        phone: body.phone,
        linkedIn: body.linkedIn,
        whatsApp: body.whatsApp,
        stage: body.stage ?? 'new',
        assignedToId: body.assignedToId ?? user.id,
        campaignId: body.campaignId,
        source: body.source,
        importListName: body.importListName,
        emailValidation: body.emailValidation,
        emailScore: body.emailScore,
        vendorSource: body.vendorSource,
        tags: body.tags ?? [],
        crmPriorityScore: priority,
        engagementScore: aiScore?.score ?? null,
        normalizedEmail, normalizedPhone: normalizePhone(body.phone), normalizedLinkedIn: normalizeLinkedIn(body.linkedIn),
      },
    });

    // Auto-log lead_created activity
    await prisma.activity.create({
      data: {
        userId: user.id,
        leadId: lead.id,
        type: 'lead_created',
        description: `Lead ${lead.firstName} ${lead.lastName} created`,
      },
    });

    // Engagement was already written above; this adds the ICP verdict through the same hook
    // every other door uses, and returns the lead as it now stands so the modal shows the
    // score it just earned rather than the row from a moment before.
    const scores = await scoreNewLead({ tenantId: lead.tenantId, leadId: lead.id });
    const scored = await prisma.lead.findUnique({ where: { id: lead.id } });

    return NextResponse.json({ ...(scored ?? lead), icp: scores.icp }, { status: 201 });
  } catch (err) {
    return handleApiError('api/leads POST', err);
  }
}
