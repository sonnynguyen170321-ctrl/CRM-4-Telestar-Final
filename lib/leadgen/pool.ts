import { prisma } from '@/lib/prisma';
import { normalizeEmail, normalizePhone, normalizeLinkedIn } from '@/lib/leads/normalize';
import type { SessionUser } from '@/lib/auth';
import type { LeadgenActivityType, LeadPoolItem, LeadSourceType } from '@prisma/client';
import { buildTermClauses } from '@/lib/search/terms';
import { findAccentInsensitiveIds, POOL_SEARCH_COLUMNS } from '@/lib/search/accentSearch';
import { tenantIdOrThrow } from '@/lib/api/tenant';

// ─── Duplicate detection ─────────────────────────────────────────────────────

export function buildPoolDuplicateKey(row: {
  email?: string | null;
  phone?: string | null;
  linkedIn?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  company?: string;
}): string | null {
  const email = normalizeEmail(row.email);
  if (email) return `email:${email}`;
  const phone = normalizePhone(row.phone);
  if (phone) return `phone:${phone}`;
  const linkedIn = normalizeLinkedIn(row.linkedIn);
  if (linkedIn) return `linkedin:${linkedIn}`;
  if (row.firstName && row.lastName && row.company) {
    return `name:${row.firstName.trim().toLowerCase()}|${row.lastName.trim().toLowerCase()}|${row.company.trim().toLowerCase()}`;
  }
  return null;
}

export type PoolItemInput = {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  company: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedIn?: string | null;
  website?: string | null;
  country?: string | null;
  industry?: string | null;
  emailValidation?: string | null;
  emailScore?: number | null;
  sourceType?: LeadSourceType;
  sourceName?: string | null;
  tags?: string[];
  rawPayload?: Record<string, unknown> | null;
};

export async function logLeadgenActivity(params: {
  actor: SessionUser;
  type: LeadgenActivityType;
  poolItemId?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  await prisma.leadgenActivity.create({
    data: {
      userId: params.actor.id,
      type: params.type,
      poolItemId: params.poolItemId ?? null,
      description: params.description ?? null,
      metadata: (params.metadata ?? null) as never,
      // `tenantId` is stamped by the client extension in `lib/prisma.ts`. Passing it here meant
      // carrying a `|| 'default-tenant'` fallback, which writes into a real tenant nobody owns
      // rather than failing.
    },
  });
}

export type PoolListQuery = {
  status?: string;
  qualification?: string;
  search?: string;
  sourceType?: string;
  assignedCampaignId?: string;
  assignedSdrId?: string;
  page?: number;
  pageSize?: number;
};

/** Columns the Internal Database free-text search covers. */
const POOL_SEARCH_FIELDS = [
  'email',
  'firstName',
  'lastName',
  'fullName',
  'company',
  'title',
  'sourceName',
] as const;

export function buildPoolWhere(query: Pick<PoolListQuery, 'status' | 'qualification' | 'search' | 'sourceType' | 'assignedCampaignId' | 'assignedSdrId'>, tenantId: string) {
  const where: Record<string, unknown> = { tenantId };
  if (query.status) where.status = query.status;
  if (query.qualification) where.qualification = query.qualification;
  if (query.sourceType) where.sourceType = query.sourceType;
  if (query.assignedCampaignId) where.assignedCampaignId = query.assignedCampaignId;
  if (query.assignedSdrId) where.assignedSdrId = query.assignedSdrId;
  if (query.search) {
    // One AND-ed clause per whitespace-separated term, not the whole raw string against
    // each column. "Marcus Webb" used to return nothing because no single column holds
    // that literal — firstName is "Marcus", lastName is "Webb" — so the most natural
    // lookup in the product always looked like a missing record. `fullName` is searched
    // too; the importer populates it (workers/import.ts) and it was previously ignored.
    const clauses = buildTermClauses<Record<string, unknown>>(query.search, POOL_SEARCH_FIELDS);
    if (clauses.length > 0) where.AND = clauses;
  }
  return where;
}

export async function listPoolItems(query: PoolListQuery, tenantId: string) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));

  const baseWhere = buildPoolWhere(query, tenantId) as Record<string, unknown>;

  // Accent-insensitive matching happens in SQL, because the *stored* value has to be
  // folded too — "Giam" can only find "Giám" if both sides are normalised. Resolve the
  // matching ids first, then let the existing Prisma where handle every other filter.
  const matchedIds = await findAccentInsensitiveIds(
    'LeadPoolItem',
    POOL_SEARCH_COLUMNS,
    query.search,
    tenantId
  );

  const where = (
    matchedIds === null
      ? baseWhere
      : // Drop the Prisma term clauses; the raw query already applied them, accent-folded.
        { ...Object.fromEntries(Object.entries(baseWhere).filter(([k]) => k !== 'AND')), id: { in: matchedIds } }
  ) as never;

  const [items, total] = await Promise.all([
    prisma.leadPoolItem.findMany({
      where: where as never,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        duplicateOf: { select: { id: true, firstName: true, lastName: true, company: true, email: true } },
        qualifiedBy: { select: { id: true, firstName: true, lastName: true } },
        assignedCampaign: { select: { id: true, name: true } },
        assignedSdr: { select: { id: true, firstName: true, lastName: true } },
        convertedLead: { select: { id: true, firstName: true, lastName: true, stage: true } },
      },
    }),
    prisma.leadPoolItem.count({ where: where as never }),
  ]);

  return { items, total, page, pageSize, pages: Math.ceil(total / pageSize) };
}

// ─── Create / enrich ─────────────────────────────────────────────────────────

export async function createPoolItem(params: {
  input: PoolItemInput;
  actor: SessionUser;
  importBatchId?: string | null;
  status?: LeadPoolItem['status'];
  qualification?: LeadPoolItem['qualification'];
  skipDuplicateCheck?: boolean;
}) {
  const { input, actor } = params;
  const tenantId = tenantIdOrThrow(actor);
  const duplicateKey = buildPoolDuplicateKey(input);

  const item = await prisma.leadPoolItem.create({
    data: {
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      fullName: input.fullName ?? null,
      company: input.company,
      title: input.title ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      linkedIn: input.linkedIn ?? null,
      website: input.website ?? null,
      country: input.country ?? null,
      industry: input.industry ?? null,
      emailValidation: input.emailValidation ?? null,
      emailScore: input.emailScore ?? null,
      sourceType: input.sourceType ?? 'manual',
      sourceName: input.sourceName ?? null,
      tags: input.tags ?? [],
      rawPayload: (input.rawPayload ?? null) as never,
      duplicateKey,
      status: params.status ?? 'imported',
      qualification: params.qualification ?? 'unreviewed',
      importBatchId: params.importBatchId ?? null,
      tenantId,
    },
  });

  if (duplicateKey && !params.skipDuplicateCheck) {
    const existing = await prisma.leadPoolItem.findFirst({
      where: { tenantId, duplicateKey, id: { not: item.id }, duplicateOfId: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) {
      await prisma.leadPoolItem.update({
        where: { id: item.id },
        data: { duplicateOfId: existing.id, qualification: 'duplicate' },
      });
      await logLeadgenActivity({
        actor,
        type: 'duplicate_marked',
        poolItemId: item.id,
        description: 'Marked duplicate of existing pool record',
        metadata: { duplicateOfId: existing.id },
      });
    }
  }

  await logLeadgenActivity({
    actor,
    type: 'imported',
    poolItemId: item.id,
    description: `Added ${input.firstName || ''} ${input.lastName || ''} (${input.company}) to internal lead database`,
  });

  return item;
}

export async function enrichPoolItem(params: {
  id: string;
  patch: Partial<PoolItemInput>;
  actor: SessionUser;
  tenantId: string;
}) {
  const { id, patch, actor, tenantId } = params;
  const item = await prisma.leadPoolItem.findFirst({ where: { id, tenantId }, select: { id: true } });
  if (!item) return null;

  const duplicateKey = patch.email || patch.phone || patch.linkedIn
    ? buildPoolDuplicateKey({ email: patch.email, phone: patch.phone, linkedIn: patch.linkedIn })
    : undefined;

  const updated = await prisma.leadPoolItem.update({
    where: { id },
    data: {
      ...(patch.firstName !== undefined ? { firstName: patch.firstName } : {}),
      ...(patch.lastName !== undefined ? { lastName: patch.lastName } : {}),
      ...(patch.fullName !== undefined ? { fullName: patch.fullName } : {}),
      ...(patch.company !== undefined ? { company: patch.company } : {}),
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.email !== undefined ? { email: patch.email } : {}),
      ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
      ...(patch.linkedIn !== undefined ? { linkedIn: patch.linkedIn } : {}),
      ...(patch.website !== undefined ? { website: patch.website } : {}),
      ...(patch.country !== undefined ? { country: patch.country } : {}),
      ...(patch.industry !== undefined ? { industry: patch.industry } : {}),
      ...(patch.emailValidation !== undefined ? { emailValidation: patch.emailValidation } : {}),
      ...(patch.emailScore !== undefined ? { emailScore: patch.emailScore } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      ...(duplicateKey !== undefined ? { duplicateKey } : {}),
    },
  });

  await logLeadgenActivity({
    actor,
    type: 'enriched',
    poolItemId: id,
    description: 'Enriched pool record',
  });

  return updated;
}

// ─── Qualify / duplicate ─────────────────────────────────────────────────────

export async function qualifyPoolItems(params: {
  itemIds: string[];
  qualification: 'qualified' | 'disqualified' | 'needs_research' | 'invalid_contact' | 'invalid_company' | 'out_of_icp';
  reason?: string;
  qaNotes?: string;
  actor: SessionUser;
  tenantId: string;
}) {
  const { itemIds, qualification, reason, qaNotes, actor, tenantId } = params;

  const items = await prisma.leadPoolItem.findMany({
    where: { id: { in: itemIds }, tenantId },
    select: { id: true, firstName: true, lastName: true, company: true },
  });
  const foundIds = items.map((i) => i.id);

  const isQualified = qualification === 'qualified';
  await prisma.leadPoolItem.updateMany({
    where: { id: { in: foundIds } },
    data: {
      qualification,
      status: isQualified ? 'qualified' : qualification === 'needs_research' ? 'qa_pending' : 'disqualified',
      ...(isQualified
        ? { qualifiedById: actor.id, qualifiedAt: new Date(), disqualifiedReason: null }
        : {}),
      ...(qualification === 'disqualified' ? { disqualifiedReason: reason ?? null } : {}),
      ...(qaNotes !== undefined ? { qaNotes } : {}),
    },
  });

  await Promise.all(
    items.map((item) =>
      logLeadgenActivity({
        actor,
        type: isQualified ? 'qualified' : 'disqualified',
        poolItemId: item.id,
        description: `${isQualified ? 'Qualified' : 'Disqualified'} ${item.firstName || ''} ${item.lastName || ''} (${item.company})`,
        metadata: { qualification, reason: reason ?? null },
      })
    )
  );

  return { count: foundIds.length };
}

export async function markDuplicate(params: {
  itemIds: string[];
  duplicateOfId?: string;
  actor: SessionUser;
  tenantId: string;
}) {
  const { itemIds, duplicateOfId, actor, tenantId } = params;
  const items = await prisma.leadPoolItem.findMany({
    where: { id: { in: itemIds }, tenantId },
    select: { id: true },
  });
  const foundIds = items.map((i) => i.id);

  await prisma.leadPoolItem.updateMany({
    where: { id: { in: foundIds } },
    data: {
      qualification: 'duplicate',
      status: 'archived',
      duplicateOfId: duplicateOfId ?? null,
    },
  });

  await Promise.all(
    foundIds.map((id) =>
      logLeadgenActivity({
        actor,
        type: 'duplicate_marked',
        poolItemId: id,
        description: 'Marked as duplicate',
        metadata: duplicateOfId ? { duplicateOfId } : null,
      })
    )
  );

  return { count: foundIds.length };
}

// ─── Assign / convert ────────────────────────────────────────────────────────

export type DistributionMethod = 'single' | 'round_robin';

function assignSdrId(sdrIds: string[], method: DistributionMethod, index: number): string | null {
  if (sdrIds.length === 0) return null;
  if (method === 'single') return sdrIds[0];
  return sdrIds[index % sdrIds.length];
}

export async function assignPoolItems(params: {
  itemIds: string[];
  campaignId?: string;
  sdrIds: string[];
  method: DistributionMethod;
  actor: SessionUser;
  tenantId: string;
}) {
  const { itemIds, campaignId, sdrIds, method, actor, tenantId } = params;

  const items = await prisma.leadPoolItem.findMany({
    where: { id: { in: itemIds }, tenantId },
    select: { id: true, firstName: true, lastName: true, company: true },
  });
  const now = new Date();

  let index = 0;
  for (const item of items) {
    const sdrId = assignSdrId(sdrIds, method, index++);
    await prisma.leadPoolItem.update({
      where: { id: item.id },
      data: {
        ...(campaignId ? { assignedCampaignId: campaignId } : {}),
        ...(sdrId ? { assignedSdrId: sdrId } : {}),
        assignedAt: now,
        assignedById: actor.id,
        status: 'assigned_to_campaign',
      },
    });
    await logLeadgenActivity({
      actor,
      type: sdrId ? 'assigned_to_sdr' : 'assigned_to_campaign',
      poolItemId: item.id,
      description: `Assigned ${item.firstName || ''} ${item.lastName || ''} to ${sdrId ? 'SDR' : 'campaign'}`,
      metadata: campaignId ? { campaignId } : null,
    });
  }

  return { count: items.length };
}

export async function convertPoolToLeads(params: {
  itemIds: string[];
  campaignId: string;
  sdrIds: string[];
  method: DistributionMethod;
  actor: SessionUser;
  tenantId: string;
}) {
  const { itemIds, campaignId, sdrIds, method, actor, tenantId } = params;

  const items = await prisma.leadPoolItem.findMany({
    where: { id: { in: itemIds }, tenantId, convertedLeadId: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      company: true,
      title: true,
      email: true,
      phone: true,
      linkedIn: true,
      website: true,
      country: true,
      industry: true,
      emailValidation: true,
      emailScore: true,
      sourceType: true,
      sourceName: true,
      tags: true,
    },
  });

  const created: Array<{ poolItemId: string; leadId: string }> = [];
  const errors: Array<{ poolItemId: string; reason: string }> = [];
  const now = new Date();

  let index = 0;
  for (const item of items) {
    const sdrId = assignSdrId(sdrIds, method, index++);
    if (!sdrId) {
      errors.push({ poolItemId: item.id, reason: 'no_sdr_available' });
      continue;
    }

    try {
      const normalizedEmail = normalizeEmail(item.email);
      const normalizedPhone = normalizePhone(item.phone);
      const normalizedLinkedIn = normalizeLinkedIn(item.linkedIn);

      let account = await prisma.account.findUnique({
        where: { tenantId_name: { tenantId, name: item.company } },
        select: { id: true },
      });
      if (!account) {
        account = await prisma.account.create({
          data: { name: item.company, website: item.website, industry: item.industry, country: item.country, tenantId },
          select: { id: true },
        });
      }

      let contactId: string | null = null;
      if (normalizedEmail) {
        let contact = await prisma.contact.findUnique({
          where: { tenantId_normalizedEmail: { tenantId, normalizedEmail } },
          select: { id: true },
        });
        if (!contact) {
          const createdContact = await prisma.contact.create({
            data: {
              fullName: [item.firstName, item.lastName].filter(Boolean).join(' ') || item.company,
              firstName: item.firstName || item.company,
              lastName: item.lastName || '—',
              company: item.company,
              title: item.title,
              country: item.country,
              email: item.email || normalizedEmail,
              phone: item.phone,
              linkedIn: item.linkedIn,
              emailValidation: item.emailValidation,
              emailScore: item.emailScore,
              normalizedEmail,
              normalizedPhone,
              normalizedLinkedIn,
              tenantId,
            },
            select: { id: true },
          });
          contact = createdContact;
        }
        contactId = contact.id;
      }

      const lead = await prisma.lead.create({
        data: {
          contactId,
          accountId: account.id,
          firstName: item.firstName || item.company,
          lastName: item.lastName || '—',
          company: item.company,
          title: item.title || null,
          email: item.email || `${normalizedEmail ?? 'noemail'}@telestar.vn`,
          phone: item.phone || null,
          linkedIn: item.linkedIn || null,
          stage: 'new',
          assignedToId: sdrId,
          campaignId,
          source: item.sourceType === 'csv_import' ? 'csv_import' : item.sourceType,
          importListName: item.sourceName,
          emailValidation: item.emailValidation || null,
          emailScore: item.emailScore,
          vendorSource: item.sourceName,
          tags: item.tags,
          normalizedEmail: normalizedEmail,
          normalizedPhone,
          normalizedLinkedIn,
          tenantId,
        },
        select: { id: true },
      });

      await prisma.leadPoolItem.update({
        where: { id: item.id },
        data: {
          convertedLeadId: lead.id,
          assignedCampaignId: campaignId,
          assignedSdrId: sdrId,
          assignedAt: now,
          assignedById: actor.id,
          status: 'assigned_to_campaign',
        },
      });

      await logLeadgenActivity({
        actor,
        type: 'assigned_to_sdr',
        poolItemId: item.id,
        description: `Converted to Lead for campaign, assigned to SDR`,
        metadata: { campaignId, sdrId, leadId: lead.id },
      });

      created.push({ poolItemId: item.id, leadId: lead.id });
    } catch (err) {
      errors.push({ poolItemId: item.id, reason: err instanceof Error ? err.message : 'unknown' });
    }
  }

  return { count: created.length, created, errors };
}

// ─── Export ──────────────────────────────────────────────────────────────────

export function poolItemsToCsv(items: Array<{
  firstName: string | null;
  lastName: string | null;
  company: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedIn: string | null;
  website: string | null;
  country: string | null;
  industry: string | null;
  status: string;
  qualification: string;
  sourceType: string;
  sourceName: string | null;
  icpFitScore: number | null;
  dataQualityScore: number | null;
  emailValidation: string | null;
  emailScore: number | null;
}>): string {
  const headers = [
    'firstName', 'lastName', 'company', 'title', 'email', 'phone', 'linkedIn',
    'website', 'country', 'industry', 'status', 'qualification', 'sourceType',
    'sourceName', 'icpFitScore', 'dataQualityScore', 'emailValidation', 'emailScore',
  ];
  const escape = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = items.map((row) =>
    [
      row.firstName, row.lastName, row.company, row.title, row.email, row.phone,
      row.linkedIn, row.website, row.country, row.industry, row.status, row.qualification,
      row.sourceType, row.sourceName, row.icpFitScore, row.dataQualityScore,
      row.emailValidation, row.emailScore,
    ].map(escape).join(',')
  );
  return [headers.join(','), ...lines].join('\n');
}
