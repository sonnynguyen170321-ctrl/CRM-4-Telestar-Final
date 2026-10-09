/**
 * Saved AI research result for one lead (table LeadAiInsight): one row per lead, replaced on each
 * generation. Lives outside lib/ai because the agent layer must not read CRM tables directly.
 * Every call is tenant-scoped by the tenantId the caller got from the session.
 */

import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { readStoredDraft, readStoredHooks, type LeadEmailDraft, type LeadEnrichmentResponse } from '@/lib/ai/leadEnrichment';

export interface StoredPart<T> {
  data: T;
  generatedAt: string;
}

export interface LeadInsight {
  hooks: StoredPart<LeadEnrichmentResponse> | null;
  draft: StoredPart<LeadEmailDraft> | null;
}

export async function loadLeadInsight(tenantId: string, leadId: string): Promise<LeadInsight | null> {
  return tenantStorage.run({ tenantId, bypassRls: false }, async () => {
    const row = await prisma.leadAiInsight.findFirst({ where: { tenantId, leadId } });
    if (!row) return null;
    // Stored JSON is re-checked on the way out: a row that no longer fits is shown as nothing saved.
    const hooks = row.hooksGeneratedAt ? readStoredHooks(row.hooksJson) : null;
    const draft = row.draftGeneratedAt ? readStoredDraft(row.draftJson) : null;
    return {
      hooks: hooks && row.hooksGeneratedAt ? { data: hooks, generatedAt: row.hooksGeneratedAt.toISOString() } : null,
      draft: draft && row.draftGeneratedAt ? { data: draft, generatedAt: row.draftGeneratedAt.toISOString() } : null,
    };
  });
}

export async function saveLeadInsight(input: {
  tenantId: string;
  leadId: string;
  userId: string;
  hooks?: LeadEnrichmentResponse;
  draft?: LeadEmailDraft;
}): Promise<void> {
  const { tenantId, leadId, userId, hooks, draft } = input;
  const now = new Date();
  const patch = {
    generatedById: userId,
    ...(hooks ? { hooksJson: hooks as object, hooksGeneratedAt: now } : {}),
    ...(draft ? { draftJson: draft as object, draftGeneratedAt: now } : {}),
  };
  await tenantStorage.run({ tenantId, bypassRls: false }, async () => {
    await prisma.leadAiInsight.upsert({
      where: { leadId_tenantId: { leadId, tenantId } },
      create: { tenantId, leadId, ...patch },
      update: patch,
    });
  });
}
