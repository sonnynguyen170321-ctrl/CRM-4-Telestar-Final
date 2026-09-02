import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createAppWorker } from '@/lib/bullmq';
import { JobType } from '@/lib/bullmq/types';
import type { ImportParsePayload, ImportChunkPayload, ImportCommitPayload } from '@/lib/bullmq/types';
import { enqueue } from '@/lib/bullmq/enqueue';
import {
  normalizeCompanyName,
  normalizeEmail,
  normalizePhone,
  normalizeLinkedIn,
} from '@/lib/leads/normalize';
import { resolveAccount } from '@/lib/identity/resolveAccount';
import { resolveContact } from '@/lib/identity/resolveContact';
import { createTaskForStep } from '@/lib/sequences/engine';
import {
  normalizeImportRow,
  validateNormalizedImportRow,
  type EmailQualityMode,
  type NormalizedImportLeadRow,
} from '@/lib/leads/importRows';
import { buildPoolDuplicateKey } from '@/lib/leadgen/pool';
import { resolveIcpVersionId, scorePoolItem } from '@/lib/leadgen/scorePoolItem';

const CHUNK_SIZE = 500;

/**
 * How the parse step hands work to the chunk/commit steps.
 *
 * The worker uses the queue-backed dispatcher (default). When Redis is
 * unreachable the API route can run the same parse logic with an inline
 * dispatcher (see `lib/workflows/importInline.ts`), so the import still lands
 * instead of dying at `queue.add`.
 */
export interface ImportDispatcher {
  chunk(payload: ImportChunkPayload, tenantId: string): Promise<unknown>;
  commit(payload: ImportCommitPayload, tenantId: string): Promise<unknown>;
}

const queueDispatcher: ImportDispatcher = {
  chunk: (payload, tenantId) => enqueue(JobType.IMPORT_CHUNK, payload, { tenantId }),
  commit: (payload, tenantId) => enqueue(JobType.IMPORT_COMMIT, payload, { tenantId }),
};

type ExistingLead = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  phone: string | null;
  linkedIn: string | null;
  normalizedEmail: string | null;
  normalizedPhone: string | null;
  normalizedLinkedIn: string | null;
  contactId: string | null;
  accountId: string | null;
  title: string | null;
};

type ImportRowData = NormalizedImportLeadRow & {
  forceDuplicateLead?: boolean;
  __failpoint?: string;
};

const nameCompanyKey = (row: Pick<NormalizedImportLeadRow, 'firstName' | 'lastName' | 'company'>) =>
  `${row.firstName.toLowerCase()}|${row.lastName.toLowerCase()}|${row.company.toLowerCase()}`;

const buildLeadSummary = (lead: Pick<ExistingLead, 'firstName' | 'lastName' | 'company' | 'email'>) =>
  `${lead.firstName} ${lead.lastName} - ${lead.company}${lead.email ? ` (${lead.email})` : ''}`;

/**
 * Strip blank/null/undefined keys, leaving only what the row actually supplied.
 *
 * The shape a Prisma `upsert`'s `create`/`update` payload needs is different from what
 * `accountData`/`contactData` return: those force every optional field to `null` so a plain
 * `create()` clears nothing it shouldn't, but that same object is unsafe as an `update` payload —
 * it would null out a field a previous row already populated. Stripping blanks makes one object
 * safe for both halves of an upsert: an omitted key writes nothing, on create *or* update, which
 * is what `fill()` computes from a prior read for the plain-update paths elsewhere in this file.
 * `upsert` takes no prior read, so it needs this instead.
 */
const nonBlank = <T extends Record<string, unknown>>(data: T): Partial<T> => {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === '' || value === null || value === undefined) continue;
    out[key as keyof T] = value as T[keyof T];
  }
  return out;
};

const fill = (
  existing: Record<string, unknown> | null | undefined,
  data: Record<string, unknown>
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === '' || value === null || value === undefined) continue;
    const current = existing?.[key];
    if (current === '' || current === null || current === undefined) {
      out[key] = value;
    }
  }
  return out;
};

const indexExistingLeads = (existingLeads: ExistingLead[]) => {
  const byEmail = new Map<string, ExistingLead>();
  const byPhone = new Map<string, ExistingLead>();
  const byLinkedIn = new Map<string, ExistingLead>();
  const byNameCompany = new Map<string, ExistingLead>();

  for (const lead of existingLeads) {
    const email = lead.normalizedEmail || normalizeEmail(lead.email);
    const phone = lead.normalizedPhone || normalizePhone(lead.phone);
    const linkedIn = lead.normalizedLinkedIn || normalizeLinkedIn(lead.linkedIn);
    if (email && !byEmail.has(email)) byEmail.set(email, lead);
    if (phone && !byPhone.has(phone)) byPhone.set(phone, lead);
    if (linkedIn && !byLinkedIn.has(linkedIn)) byLinkedIn.set(linkedIn, lead);
    const key = nameCompanyKey(lead);
    if (!byNameCompany.has(key)) byNameCompany.set(key, lead);
  }

  return { byEmail, byPhone, byLinkedIn, byNameCompany };
};

const findDuplicate = (
  row: NormalizedImportLeadRow,
  indexes: ReturnType<typeof indexExistingLeads>
): { matchType: 'email' | 'phone' | 'linkedin' | 'name_company'; lead: ExistingLead } | null => {
  const email = normalizeEmail(row.email);
  const alternateEmail = normalizeEmail(row.alternateEmail);
  const phone = normalizePhone(row.phone);
  const linkedIn = normalizeLinkedIn(row.linkedIn);

  const byEmail = (email && indexes.byEmail.get(email)) || (alternateEmail && indexes.byEmail.get(alternateEmail));
  if (byEmail) return { matchType: 'email', lead: byEmail };
  const byPhone = phone && indexes.byPhone.get(phone);
  if (byPhone) return { matchType: 'phone', lead: byPhone };
  const byLinkedIn = linkedIn && indexes.byLinkedIn.get(linkedIn);
  if (byLinkedIn) return { matchType: 'linkedin', lead: byLinkedIn };
  const byNameCompany = indexes.byNameCompany.get(nameCompanyKey(row));
  return byNameCompany ? { matchType: 'name_company', lead: byNameCompany } : null;
};

const accountData = (row: NormalizedImportLeadRow, tenantId: string) => ({
  name: row.company,
  website: row.website || null,
  domain: row.domain || null,
  industry: row.industry || null,
  linkedIn: row.companyLinkedIn || null,
  country: row.companyCountry || null,
  companyPhone: row.companyPhone || null,
  staffCountRange: row.staffCountRange || null,
  staffCountMin: row.staffCountMin,
  staffCountMax: row.staffCountMax,
  size: row.staffSize,
  tenantId,
});

const contactData = (row: NormalizedImportLeadRow, tenantId: string) => ({
  fullName: row.fullName || `${row.firstName} ${row.lastName}`.trim(),
  firstName: row.firstName,
  lastName: row.lastName,
  company: row.company,
  title: row.title || null,
  department: row.department || null,
  seniority: row.seniority || null,
  country: row.contactCountry || null,
  email: row.email,
  emailValidation: row.emailValidation || null,
  emailScore: row.emailScore,
  alternateEmail: row.alternateEmail || null,
  alternateEmailValidation: row.alternateEmailValidation || null,
  phone: row.phone || null,
  secondaryPhone: row.secondaryPhone || null,
  linkedIn: row.linkedIn || null,
  whatsApp: row.whatsApp || null,
  normalizedEmail: normalizeEmail(row.email) || null,
  normalizedPhone: normalizePhone(row.phone) || null,
  normalizedLinkedIn: normalizeLinkedIn(row.linkedIn) || null,
  tenantId,
});

async function enrichExistingLead(
  existingLeadId: string,
  row: NormalizedImportLeadRow,
  userId: string,
  tenantId: string,
  importRowId: string
) {
  await prisma.$transaction(async (tx) => {
    const existingLead = await tx.lead.findUnique({
      where: { id: existingLeadId },
      include: { contact: true, account: true },
    });
    if (!existingLead) throw new Error('Existing lead not found');

    const leadPatch = fill(existingLead, {
      title: row.title || null,
      phone: row.phone || null,
      linkedIn: row.linkedIn || null,
      source: row.source || null,
      importListName: row.importListName || null,
      emailValidation: row.emailValidation || null,
      emailScore: row.emailScore,
      vendorSource: row.vendorSource || null,
    });
    if (Object.keys(leadPatch).length > 0) {
      await tx.lead.update({ where: { id: existingLeadId }, data: leadPatch });
    }

    if (existingLead.contactId) {
      const patch = fill(existingLead.contact, contactData(row, tenantId));
      if (Object.keys(patch).length > 0) {
        await tx.contact.update({ where: { id: existingLead.contactId }, data: patch });
      }
    }

    if (existingLead.accountId) {
      const patch = fill(existingLead.account, accountData(row, tenantId));
      if (Object.keys(patch).length > 0) {
        await tx.account.update({ where: { id: existingLead.accountId }, data: patch });
      }
    }

    await tx.importRow.update({
      where: { id: importRowId },
      data: { status: 'updated', leadId: existingLeadId },
    });

    await tx.activity.create({
      data: {
        userId,
        leadId: existingLeadId,
        type: 'lead_created',
        description: `Lead enriched from import: ${row.importListName || row.vendorSource || 'uploaded file'}`,
        tenantId,
      },
    });
  });
}

async function handleImportParse(payload: ImportParsePayload, dispatch: ImportDispatcher = queueDispatcher) {
  if (payload.targetType === 'pool') return handlePoolParse(payload, dispatch);

  const {
    batchId,
    assignedToId,
    campaignId,
    tenantId,
    userId,
    initialStage,
    sequenceId,
    defaultResolution,
    resolutions,
    emailQualityMode,
    filename,
  } = payload;
  const mode = (emailQualityMode ?? 'recommended') as EmailQualityMode;

  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) return { skipped: true, reason: 'batch_not_found' };

  await prisma.importBatch.update({ where: { id: batchId }, data: { status: 'parsing' } });

  const rows = await prisma.importRow.findMany({
    where: { batchId, status: 'pending' },
    orderBy: { rowIndex: 'asc' },
  });

  const existingLeads = await prisma.lead.findMany({
    where: { tenantId, campaignId: campaignId! },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      company: true,
      phone: true,
      linkedIn: true,
      normalizedEmail: true,
      normalizedPhone: true,
      normalizedLinkedIn: true,
      contactId: true,
      accountId: true,
      title: true,
    },
  });
  const indexes = indexExistingLeads(existingLeads);
  const cleanRowIds: string[] = [];
  const duplicateErrors: { id: string; reason: string }[] = [];
  const updateTargets: { id: string; existingLeadId: string; data: NormalizedImportLeadRow }[] = [];
  const seenEmails = new Set<string>();
  let validationErrors = 0;

  for (const row of rows) {
    const data = normalizeImportRow(row.data as Record<string, unknown>, { filename });
    const validationReason = validateNormalizedImportRow(data, mode);
    if (validationReason) {
      validationErrors++;
      await prisma.importRow.update({
        where: { id: row.id },
        data: { status: 'error', errors: { reason: validationReason } },
      });
      continue;
    }

    const email = normalizeEmail(data.email);
    if (email && seenEmails.has(email)) {
      duplicateErrors.push({ id: row.id, reason: 'Duplicate email within this file' });
      continue;
    }
    if (email) seenEmails.add(email);

    const duplicate = findDuplicate(data, indexes);
    if (!duplicate) {
      cleanRowIds.push(row.id);
      continue;
    }

    const resolution = resolutions?.[String(row.rowIndex)] ?? defaultResolution ?? 'skip';
    if (resolution === 'skip') {
      duplicateErrors.push({
        id: row.id,
        reason: `Duplicate skipped (${duplicate.matchType} match: ${buildLeadSummary(duplicate.lead)})`,
      });
    } else if (resolution === 'update') {
      updateTargets.push({ id: row.id, existingLeadId: duplicate.lead.id, data });
    } else {
      await prisma.importRow.update({
        where: { id: row.id },
        data: { data: { ...data, forceDuplicateLead: duplicate.matchType === 'email' } as unknown as Prisma.InputJsonValue },
      });
      cleanRowIds.push(row.id);
    }
  }

  await Promise.all(
    duplicateErrors.map((dup) =>
      prisma.importRow.update({
        where: { id: dup.id },
        data: { status: 'error', errors: { reason: dup.reason } },
      })
    )
  );

  for (const target of updateTargets) {
    await enrichExistingLead(target.existingLeadId, target.data, userId, tenantId, target.id);
  }

  if (cleanRowIds.length > 0) {
    await prisma.importRow.updateMany({
      where: { id: { in: cleanRowIds } },
      data: { status: 'valid' },
    });
  }

  const chunks: string[][] = [];
  for (let i = 0; i < cleanRowIds.length; i += CHUNK_SIZE) {
    chunks.push(cleanRowIds.slice(i, i + CHUNK_SIZE));
  }

  for (let i = 0; i < chunks.length; i++) {
    await dispatch.chunk({
      batchId,
      chunkIndex: i,
      rowIds: chunks[i],
      rows: [],
      assignedToId,
      userId,
      campaignId: campaignId!,
      tenantId,
      initialStage: sequenceId ? 'sequence_active' : initialStage ?? 'new',
      sequenceId,
    } satisfies ImportChunkPayload, tenantId);
  }

  await dispatch.commit({ batchId } satisfies ImportCommitPayload, tenantId);

  const [accepted, errored] = await Promise.all([
    prisma.importRow.count({ where: { batchId, status: { in: ['valid', 'updated', 'imported'] } } }),
    prisma.importRow.count({ where: { batchId, status: 'error' } }),
  ]);
  await prisma.importBatch.update({
    where: { id: batchId },
    data: { status: 'parsed', parsedRows: accepted, errorRows: errored },
  });

  return {
    success: true,
    batchId,
    totalRows: rows.length,
    validationErrors,
    duplicates: duplicateErrors.length,
    updated: updateTargets.length,
    cleanRows: cleanRowIds.length,
    chunks: chunks.length,
  };
}

// ─── Pool (internal lead database) import ────────────────────────────────────

const poolItemToExisting = (p: {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  company: string;
  phone: string | null;
  linkedIn: string | null;
}): ExistingLead => ({
  id: p.id,
  email: p.email ?? '',
  firstName: p.firstName ?? '',
  lastName: p.lastName ?? '',
  company: p.company,
  phone: p.phone,
  linkedIn: p.linkedIn,
  normalizedEmail: normalizeEmail(p.email) || null,
  normalizedPhone: normalizePhone(p.phone) || null,
  normalizedLinkedIn: normalizeLinkedIn(p.linkedIn) || null,
  contactId: null,
  accountId: null,
  title: null,
});

async function enrichExistingPoolItem(
  existingPoolItemId: string,
  row: NormalizedImportLeadRow,
  userId: string,
  tenantId: string,
  importRowId: string
) {
  const existing = await prisma.leadPoolItem.findUnique({ where: { id: existingPoolItemId }, select: { id: true } });
  if (!existing) throw new Error('Pool item not found');

  const patch = fill(existing, {
    title: row.title || null,
    phone: row.phone || null,
    linkedIn: row.linkedIn || null,
    website: row.website || null,
    country: row.contactCountry || row.companyCountry || null,
    industry: row.industry || null,
    emailValidation: row.emailValidation || null,
    emailScore: row.emailScore,
  });
  if (Object.keys(patch).length > 0) {
    await prisma.leadPoolItem.update({ where: { id: existingPoolItemId }, data: patch });
  }

  await prisma.importRow.update({
    where: { id: importRowId },
    data: { status: 'updated', poolItemId: existingPoolItemId },
  });

  await prisma.leadgenActivity.create({
    data: {
      userId,
      poolItemId: existingPoolItemId,
      type: 'enriched',
      description: `Pool record enriched from import: ${row.importListName || row.vendorSource || 'uploaded file'}`,
      tenantId,
    },
  });
}

async function handlePoolParse(payload: ImportParsePayload, dispatch: ImportDispatcher = queueDispatcher) {
  const { batchId, tenantId, userId, defaultResolution, resolutions, emailQualityMode, filename } = payload;
  const mode = (emailQualityMode ?? 'recommended') as EmailQualityMode;

  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) return { skipped: true, reason: 'batch_not_found' };

  await prisma.importBatch.update({ where: { id: batchId }, data: { status: 'parsing' } });

  const rows = await prisma.importRow.findMany({
    where: { batchId, status: 'pending' },
    orderBy: { rowIndex: 'asc' },
  });

  const existingItems = await prisma.leadPoolItem.findMany({
    where: { tenantId },
    select: { id: true, email: true, firstName: true, lastName: true, company: true, phone: true, linkedIn: true },
  });
  const indexes = indexExistingLeads(existingItems.map(poolItemToExisting));
  const cleanRowIds: string[] = [];
  const duplicateErrors: { id: string; reason: string }[] = [];
  const updateTargets: { id: string; existingPoolItemId: string; data: NormalizedImportLeadRow }[] = [];
  const seenEmails = new Set<string>();
  let validationErrors = 0;

  for (const row of rows) {
    const data = normalizeImportRow(row.data as Record<string, unknown>, { filename });
    const validationReason = validateNormalizedImportRow(data, mode);
    if (validationReason) {
      validationErrors++;
      await prisma.importRow.update({
        where: { id: row.id },
        data: { status: 'error', errors: { reason: validationReason } },
      });
      continue;
    }

    const email = normalizeEmail(data.email);
    if (email && seenEmails.has(email)) {
      duplicateErrors.push({ id: row.id, reason: 'Duplicate email within this file' });
      continue;
    }
    if (email) seenEmails.add(email);

    const duplicate = findDuplicate(data, indexes);
    if (!duplicate) {
      cleanRowIds.push(row.id);
      continue;
    }

    const resolution = resolutions?.[String(row.rowIndex)] ?? defaultResolution ?? 'skip';
    if (resolution === 'skip') {
      duplicateErrors.push({
        id: row.id,
        reason: `Duplicate skipped (${duplicate.matchType} match: ${buildLeadSummary(duplicate.lead)})`,
      });
    } else if (resolution === 'update') {
      updateTargets.push({ id: row.id, existingPoolItemId: duplicate.lead.id, data });
    } else {
      await prisma.importRow.update({
        where: { id: row.id },
        data: { data: { ...data, forceDuplicateLead: true } as unknown as Prisma.InputJsonValue },
      });
      cleanRowIds.push(row.id);
    }
  }

  await Promise.all(
    duplicateErrors.map((dup) =>
      prisma.importRow.update({
        where: { id: dup.id },
        data: { status: 'error', errors: { reason: dup.reason } },
      })
    )
  );

  for (const target of updateTargets) {
    await enrichExistingPoolItem(target.existingPoolItemId, target.data, userId, tenantId, target.id);
  }

  if (cleanRowIds.length > 0) {
    await prisma.importRow.updateMany({
      where: { id: { in: cleanRowIds } },
      data: { status: 'valid' },
    });
  }

  const chunks: string[][] = [];
  for (let i = 0; i < cleanRowIds.length; i += CHUNK_SIZE) {
    chunks.push(cleanRowIds.slice(i, i + CHUNK_SIZE));
  }

  for (let i = 0; i < chunks.length; i++) {
    await dispatch.chunk(
      {
        batchId,
        chunkIndex: i,
        rowIds: chunks[i],
        rows: [],
        assignedToId: userId,
        userId,
        tenantId,
        targetType: 'pool',
        initialStage: 'new',
      } satisfies ImportChunkPayload,
      tenantId
    );
  }

  await dispatch.commit({ batchId } satisfies ImportCommitPayload, tenantId);

  const [accepted, errored] = await Promise.all([
    prisma.importRow.count({ where: { batchId, status: { in: ['valid', 'updated', 'imported'] } } }),
    prisma.importRow.count({ where: { batchId, status: 'error' } }),
  ]);
  await prisma.importBatch.update({
    where: { id: batchId },
    data: { status: 'parsed', parsedRows: accepted, errorRows: errored },
  });

  return {
    success: true,
    batchId,
    totalRows: rows.length,
    validationErrors,
    duplicates: duplicateErrors.length,
    updated: updateTargets.length,
    cleanRows: cleanRowIds.length,
    chunks: chunks.length,
  };
}

/**
 * Score one freshly-imported pool record.
 *
 * Deliberately swallows its own failures. The record is already in the pool and the import is
 * already a success by the time this runs; letting a missing ICP or a malformed rule set turn that
 * into a failed row would lose the import to protect a number. A record with no assessment reads as
 * NOT SCORED, which is true, and a later rescore can fill it in once the ICP exists.
 */
async function scoreImportedPoolItem(poolItemId: string, tenantId: string): Promise<void> {
  try {
    const item = await prisma.leadPoolItem.findFirst({
      where: { id: poolItemId, tenantId },
      select: {
        id: true, company: true, title: true, email: true, country: true,
        industry: true, website: true, accountId: true, assignedCampaignId: true,
      },
    });
    if (!item) return;

    const icpVersionId = await resolveIcpVersionId(tenantId, item.assignedCampaignId ?? null);
    if (!icpVersionId) return; // no ICP configured — NOT SCORED is the honest state

    const version = await prisma.icpVersion.findFirst({
      where: { id: icpVersionId, tenantId },
      select: { rulesJson: true },
    });
    if (!version?.rulesJson) return;

    await scorePoolItem({
      tenantId,
      item,
      icpVersionId,
      rules: version.rulesJson as never,
    });
  } catch (error) {
    console.error('[import.chunk] scoring failed for pool item', poolItemId, error);
  }
}

async function handlePoolChunk(payload: ImportChunkPayload) {
  const { batchId, chunkIndex, rowIds, userId, tenantId } = payload;

  const importRows = await prisma.importRow.findMany({
    where: { id: { in: rowIds }, status: { in: ['valid', 'imported'] } },
  });
  if (importRows.length === 0) return { skipped: true, reason: 'no_rows_found' };

  let created = 0;
  let errors = 0;

  for (const row of importRows) {
    const rawData = row.data as unknown as ImportRowData;
    const data: ImportRowData = {
      ...normalizeImportRow(rawData as any),
      forceDuplicateLead: rawData.forceDuplicateLead,
      __failpoint: rawData.__failpoint ?? (payload as any)?.__failpoint,
    };

    try {
      const duplicateKey = buildPoolDuplicateKey(data);
      let poolItem = row.poolItemId
        ? await prisma.leadPoolItem.findUnique({ where: { id: row.poolItemId } })
        : null;

      if (!poolItem && duplicateKey) {
        poolItem = await prisma.leadPoolItem.findFirst({
          where: { tenantId, duplicateKey, importBatchId: batchId },
        });
      }

      if (!poolItem) {
        try {
          poolItem = await prisma.leadPoolItem.create({
            data: {
              firstName: data.firstName,
              lastName: data.lastName,
              fullName: data.fullName || `${data.firstName} ${data.lastName}`.trim(),
              company: data.company,
              normalizedCompany: normalizeCompanyName(data.company),
              title: data.title || null,
              email: data.email,
              phone: data.phone || null,
              linkedIn: data.linkedIn || null,
              website: data.website || null,
              country: data.contactCountry || data.companyCountry || null,
              industry: data.industry || null,
              emailValidation: data.emailValidation || null,
              emailScore: data.emailScore,
              sourceType: data.vendorSource ? 'vendor' : 'csv_import',
              sourceName: data.importListName || data.vendorSource || 'csv_import',
              tags: data.tags ?? [],
              duplicateKey: buildPoolDuplicateKey(data),
              status: 'imported',
              qualification: 'unreviewed',
              importBatchId: batchId,
              rawPayload: row.data as never,
              tenantId,
            },
          });
        } catch (err: unknown) {
          if ((err as { code?: string })?.code === 'P2002') {
            poolItem = await prisma.leadPoolItem.findFirst({
              where: { tenantId, duplicateKey: buildPoolDuplicateKey(data) },
            });
            if (!poolItem) throw err;
          } else {
            throw err;
          }
        }
      }

      // Score the record against the campaign's ICP as it lands, so the pool arrives filtered rather
      // than being measured for adherence weeks later. A scoring failure must not lose the import:
      // the record is already in the pool and simply stays NOT SCORED, which the console shows
      // honestly and the rescore queue can pick up later.
      await scoreImportedPoolItem(poolItem.id, tenantId);

      if (data.__failpoint === 'after_pool_item') {
        throw new Error('FAILPOINT_AFTER_POOL_ITEM');
      }

      await prisma.importRow.update({
        where: { id: row.id },
        data: { status: 'imported', poolItemId: poolItem.id },
      });

      if (data.__failpoint === 'after_pool_import_row') {
        throw new Error('FAILPOINT_AFTER_POOL_IMPORT_ROW');
      }

      const existingActivity = await prisma.leadgenActivity.findFirst({
        where: { tenantId, poolItemId: poolItem.id, type: 'imported' },
      });
      if (!existingActivity) {
        await prisma.leadgenActivity.create({
          data: {
            userId,
            poolItemId: poolItem.id,
            type: 'imported',
            description: `Lead ${data.firstName} ${data.lastName} imported to internal lead database`,
            tenantId,
          },
        });
      }

      if (data.__failpoint === 'after_pool_activity') {
        throw new Error('FAILPOINT_AFTER_POOL_ACTIVITY');
      }

      created++;
    } catch (err) {
      if (typeof err === 'object' && err !== null && 'message' in err && typeof (err as Error).message === 'string' && (err as Error).message.startsWith('FAILPOINT_')) {
        throw err;
      }
      console.error(`[import.chunk] row ${row.rowIndex} failed:`, err);
      await prisma.importRow.update({
        where: { id: row.id },
        data: { status: 'error', errors: { reason: 'Database error while creating pool record' } },
      });
      errors++;
    }
  }

  return { success: true, batchId, chunkIndex, created, errors };
}

/**
 * Performs a write that must happen exactly once, letting the database enforce it.
 *
 * The pattern this replaces was "read for an existing row, create it if absent". Two workers
 * handed the same chunk both read nothing and both create, because nothing between the read
 * and the write stops them — and the surrounding `catch` could not help, since with no
 * constraint there was no error to catch. CI found exactly that (TEL-P1-022): two
 * `lead_created` rows where the invariant is one.
 *
 * With a unique `idempotencyKey`, the loser gets P2002 and that *is* the success signal: the
 * row exists, written by whoever won. Any other error still propagates, so a genuine failure
 * is not quietly swallowed.
 */
async function createOnceByKey<T>(
  idempotencyKey: string,
  create: (idempotencyKey: string) => Promise<T>,
): Promise<T | null> {
  try {
    return await create(idempotencyKey);
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === 'P2002') return null;
    throw err;
  }
}

/**
 * Finds the lead that won a unique-constraint race, tolerating the commit window.
 *
 * When two workers are handed the same chunk, one `lead.create` succeeds and the other gets
 * P2002. The loser then has to adopt the winner's row instead of creating a duplicate — but
 * the winning transaction may not have committed at the moment the loser looks, so a single
 * read can legitimately see nothing. Retrying briefly closes that window; a row that is still
 * absent after it has genuinely not been written, and the caller rethrows.
 */
async function findLeadAfterConflict(
  tenantId: string,
  campaignId: string,
  normalizedEmail: string,
  attempts = 5,
  delayMs = 100,
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const found = await prisma.lead.findFirst({ where: { tenantId, campaignId, normalizedEmail } });
    if (found) return found;
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
}

async function handleImportChunk(payload: ImportChunkPayload) {
  if (payload.targetType === 'pool') return handlePoolChunk(payload);

  const { batchId, chunkIndex, rowIds, assignedToId, userId, campaignId, tenantId, initialStage, sequenceId } = payload;

  const importRows = await prisma.importRow.findMany({
    where: { id: { in: rowIds }, status: { in: ['valid', 'imported'] } },
  });
  if (importRows.length === 0) return { skipped: true, reason: 'no_rows_found' };

  const sequence = sequenceId
    ? await prisma.sequence.findUnique({
        where: { id: sequenceId },
        include: { steps: { orderBy: { order: 'asc' } } },
      })
    : null;

  let created = 0;
  let errors = 0;

  for (const row of importRows) {
    const rawData = row.data as unknown as ImportRowData;
    const data: ImportRowData = {
      ...normalizeImportRow(rawData as any),
      forceDuplicateLead: rawData.forceDuplicateLead,
      __failpoint: rawData.__failpoint ?? (payload as any)?.__failpoint,
    };
    const normalizedEmail = normalizeEmail(data.email);
    const normalizedPhone = normalizePhone(data.phone);
    const normalizedLinkedIn = normalizeLinkedIn(data.linkedIn);

    try {
      // Identity resolution goes through the shared writer: the raw company name is no longer the
      // key, so "Công ty TNHH ABC" and "CTY TNHH ABC" land on one Account instead of two. Enriching
      // an existing row with newly-supplied fields is kept — that behaviour was the point of the
      // `nonBlank` upsert this replaces.
      const resolvedAccount = await resolveAccount(prisma, {
        tenantId,
        name: data.company,
        website: data.website,
        domain: data.domain,
        industry: data.industry,
        linkedIn: data.companyLinkedIn,
        country: data.companyCountry,
        companyPhone: data.companyPhone,
        staffCountRange: data.staffCountRange,
        staffCountMin: data.staffCountMin,
        staffCountMax: data.staffCountMax,
        size: data.staffSize,
      });
      if (!resolvedAccount.created) {
        const patch = nonBlank(accountData(data, tenantId));
        if (Object.keys(patch).length > 0) {
          await prisma.account.update({ where: { id: resolvedAccount.accountId }, data: patch });
        }
      }
      // Only the id is used downstream, so there is no second read to go stale or to mock.
      const account = { id: resolvedAccount.accountId };

      if (data.__failpoint === 'after_account') {
        throw new Error('FAILPOINT_AFTER_ACCOUNT');
      }

      const resolvedContact = await resolveContact(prisma, {
        tenantId,
        accountId: resolvedAccount.accountId,
        company: data.company,
        firstName: data.firstName,
        lastName: data.lastName,
        fullName: data.fullName,
        email: data.email,
        title: data.title,
        department: data.department,
        seniority: data.seniority,
        country: data.contactCountry,
        phone: data.phone,
        secondaryPhone: data.secondaryPhone,
        linkedIn: data.linkedIn,
        whatsApp: data.whatsApp,
        emailValidation: data.emailValidation,
        emailScore: data.emailScore,
        alternateEmail: data.alternateEmail,
        alternateEmailValidation: data.alternateEmailValidation,
      });
      if (!resolvedContact.created) {
        const patch = nonBlank(contactData(data, tenantId));
        if (Object.keys(patch).length > 0) {
          await prisma.contact.update({ where: { id: resolvedContact.contactId }, data: patch });
        }
      }
      const contact = { id: resolvedContact.contactId };

      if (data.__failpoint === 'after_contact') {
        throw new Error('FAILPOINT_AFTER_CONTACT');
      }

      // Check if lead was already created for this import row (crash recovery)
      let createdLead = row.leadId
        ? await prisma.lead.findUnique({ where: { id: row.leadId } })
        : null;

      if (!createdLead) {
        try {
          const leadNormalizedEmail = data.forceDuplicateLead ? null : normalizedEmail || null;
          createdLead = await prisma.lead.create({
            data: {
              contactId: contact.id,
              accountId: account.id,
              firstName: data.firstName,
              lastName: data.lastName,
              company: data.company,
              title: data.title || null,
              email: data.email,
              phone: data.phone || null,
              linkedIn: data.linkedIn || null,
              whatsApp: data.whatsApp || null,
              stage: sequence ? 'sequence_active' : (initialStage as any),
              crmPriorityScore: data.priority,
              assignedToId,
              campaignId: campaignId!,
              source: data.source,
              importListName: data.importListName || null,
              emailValidation: data.emailValidation || null,
              emailScore: data.emailScore,
              vendorSource: data.vendorSource || null,
              tags: data.tags ?? [],
              normalizedEmail: leadNormalizedEmail,
              normalizedPhone: normalizedPhone || null,
              normalizedLinkedIn: normalizedLinkedIn || null,
              tenantId,
              ...(sequence ? { sequenceId: sequence.id, sequenceStep: 1, sequenceStatus: 'active' as const } : {}),
            },
          });
        } catch (err: unknown) {
          if ((err as { code?: string })?.code === 'P2002' && normalizedEmail) {
            // The constraint fired, so the winning row exists - but it may not be *committed*
            // yet at the instant we look, and a single read that lands in that window returns
            // null and rethrows. That is the whole failure this branch exists to prevent, and
            // it surfaced on CI (TEL-P1-007) while passing locally, because the window is
            // measured in milliseconds and only a slower machine widens it enough to hit.
            //
            // Re-read a few times before giving up. Time-bounded, because a genuinely absent
            // row must still raise rather than spin.
            createdLead = await findLeadAfterConflict(tenantId, campaignId!, normalizedEmail);
            if (!createdLead) throw err;
          } else {
            throw err;
          }
        }
      }

      if (data.__failpoint === 'after_lead') {
        throw new Error('FAILPOINT_AFTER_LEAD');
      }

      await prisma.importRow.update({
        where: { id: row.id },
        data: { status: 'imported', leadId: createdLead.id },
      });

      if (data.__failpoint === 'after_import_row') {
        throw new Error('FAILPOINT_AFTER_IMPORT_ROW');
      }

      // Exactly one `lead_created` row, guaranteed by the database.
      //
      // This used to read for an existing activity and create one if absent. Two workers
      // handed the same chunk both saw none and both created — the check-then-act window is
      // real, and CI caught it (TEL-P1-022) writing two rows where the invariant is one. The
      // `catch` around it claimed to handle "the concurrency insert race", but nothing threw:
      // there was no constraint to violate.
      await createOnceByKey(
        `import:lead_created:${createdLead.id}`,
        (idempotencyKey) =>
          prisma.activity.create({
            data: {
              idempotencyKey,
              userId,
              leadId: createdLead!.id,
              type: 'lead_created',
              description: `Lead ${data.firstName} ${data.lastName} imported from ${data.importListName || data.vendorSource || 'uploaded file'}`,
              tenantId,
            },
          }),
      );

      if (data.__failpoint === 'after_activity_lead_created') {
        throw new Error('FAILPOINT_AFTER_ACTIVITY_LEAD_CREATED');
      }

      if (sequence && sequence.steps.length > 0) {
        await createOnceByKey(
          `import:sequence_enrolled:${createdLead.id}:${sequence.id}`,
          (idempotencyKey) =>
            prisma.activity.create({
              data: {
                idempotencyKey,
                userId,
                leadId: createdLead!.id,
                type: 'sequence_enrolled',
                description: `Enrolled in ${sequence.name} (import)`,
                metadata: { sequenceId: sequence.id, sequenceName: sequence.name },
                tenantId,
              },
            }),
        );

        if (data.__failpoint === 'after_activity_sequence_enrolled') {
          throw new Error('FAILPOINT_AFTER_ACTIVITY_SEQUENCE_ENROLLED');
        }

        // Deterministic id, so two workers handed the same chunk collide on the Task primary
        // key and the loser reuses the winner's row. The previous findFirst-then-create pair
        // let both through and scheduled the cadence twice - the same race that produced two
        // `lead_created` activities.
        await createTaskForStep(createdLead, sequence, sequence.steps[0], new Date(), {
          taskId: `import-${createdLead.id}-${sequence.id}-step${sequence.steps[0].order}`,
        });

        if (data.__failpoint === 'after_task') {
          throw new Error('FAILPOINT_AFTER_TASK');
        }
      }

      created++;
    } catch (err: unknown) {
      if ((err as Error)?.message?.startsWith('FAILPOINT_')) {
        throw err;
      }
      console.error(`[import.chunk] row ${row.rowIndex} failed:`, err);
      await prisma.importRow.update({
        where: { id: row.id },
        data: { status: 'error', errors: { reason: 'Database error while creating lead' } },
      });
      errors++;
    }
  }

  // Auto-dispatch commit if this was the last in-flight chunk
  const remainingInFlight = await prisma.importRow.count({
    where: { batchId, status: { in: ['pending', 'valid'] } },
  });
  if (remainingInFlight === 0) {
    await enqueue(JobType.IMPORT_COMMIT, { batchId }, { tenantId });
  }

  return { success: true, batchId, chunkIndex, created, errors };
}

async function handleImportCommit(payload: ImportCommitPayload) {
  const { batchId } = payload;

  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) return { skipped: true, reason: 'batch_not_found' };
  if (batch.status === 'committed') return { skipped: true, reason: 'already_committed' };

  // State-driven commit barrier: ensure no chunks are still in-flight
  const pendingOrValidCount = await prisma.importRow.count({
    where: { batchId, status: { in: ['pending', 'valid'] } },
  });
  if (pendingOrValidCount > 0) {
    // Re-enqueue commit with delay to guarantee eventual completion
    await enqueue(
      JobType.IMPORT_COMMIT,
      { batchId },
      { tenantId: batch.tenantId, delay: 1000 }
    );
    return {
      success: false,
      batchId,
      inProgress: true,
      pendingOrValidCount,
      reason: 'chunks_still_in_flight',
    };
  }

  await prisma.importBatch.update({ where: { id: batchId }, data: { status: 'committing' } });

  const [imported, updated, errored] = await Promise.all([
    prisma.importRow.count({ where: { batchId, status: 'imported' } }),
    prisma.importRow.count({ where: { batchId, status: 'updated' } }),
    prisma.importRow.count({ where: { batchId, status: 'error' } }),
  ]);

  await prisma.importBatch.update({
    where: { id: batchId },
    data: {
      status: 'committed',
      parsedRows: imported + updated,
      errorRows: errored,
    },
  });

  return { success: true, batchId, imported, updated, errored };
}

export { handleImportParse, handleImportChunk, handleImportCommit };

function createImportWorker() {
  return createAppWorker(
    'import',
    async (job) => {
      if (job.name === JobType.IMPORT_PARSE) {
        return handleImportParse(job.data as ImportParsePayload);
      }
      if (job.name === JobType.IMPORT_CHUNK) {
        return handleImportChunk(job.data as ImportChunkPayload);
      }
      if (job.name === JobType.IMPORT_COMMIT) {
        return handleImportCommit(job.data as ImportCommitPayload);
      }
    },
    { concurrency: 3 }
  );
}

export { createImportWorker };
