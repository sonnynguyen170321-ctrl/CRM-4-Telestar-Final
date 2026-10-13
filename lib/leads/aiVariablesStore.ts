/**
 * Saved AI merge variables for one lead (LeadAiInsight.variablesJson): one row per lead, replaced on
 * each save. Every call is tenant-scoped by the tenantId the caller got from the session.
 */

import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { readAiVariables, type AiVariables } from '@/lib/leads/aiVariablesShape';

export interface StoredAiVariables {
  values: AiVariables;
  generatedAt: string | null;
}

export async function loadAiVariables(tenantId: string, leadId: string): Promise<StoredAiVariables | null> {
  return tenantStorage.run({ tenantId, bypassRls: false }, async () => {
    const row = await prisma.leadAiInsight.findFirst({
      where: { tenantId, leadId },
      select: { variablesJson: true, variablesGeneratedAt: true },
    });
    if (!row) return null;
    const values = readAiVariables(row.variablesJson);
    return { values, generatedAt: row.variablesGeneratedAt?.toISOString() ?? null };
  });
}

/** Replace the lead's saved variables. The values are cleaned again here, so no caller can skip it. */
export async function saveAiVariables(input: {
  tenantId: string;
  leadId: string;
  userId: string;
  values: AiVariables;
}): Promise<AiVariables> {
  const { tenantId, leadId, userId } = input;
  const values = readAiVariables(input.values);
  const patch = { generatedById: userId, variablesJson: values as object, variablesGeneratedAt: new Date() };
  await tenantStorage.run({ tenantId, bypassRls: false }, async () => {
    await prisma.leadAiInsight.upsert({
      where: { leadId_tenantId: { leadId, tenantId } },
      create: { tenantId, leadId, ...patch },
      update: patch,
    });
  });
  return values;
}
