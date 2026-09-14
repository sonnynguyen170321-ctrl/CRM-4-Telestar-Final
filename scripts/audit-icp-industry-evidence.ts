#!/usr/bin/env node
/**
 * Read-only audit: how much of the ICP verdict is riding on industry evidence?
 *
 * Recomputes every *latest* assessment of one tenant from its persisted input and rules snapshots
 * (`lib/leadgen/icpIndustryEvidenceAudit.ts`) and prints one JSON summary to stdout. It never
 * writes: the only database calls are `findMany`, under tenant context, and there is no apply mode.
 *
 * The two numbers that matter, and what they decide:
 *   industrySoleBlocker             — records in Review only because the industry is unknown.
 *                                     A company classifier would move exactly these.
 *   allowlistMissUploadedLabelOnly  — records rejected on nothing but the uploaded label.
 *                                     These are the ones a classifier could wrongly confirm.
 *
 * Usage:
 *   npx tsx scripts/audit-icp-industry-evidence.ts --tenant <tenantId> [--sample 10]
 */

import type { IcpQualification } from '@prisma/client';

import {
  summarizeIcpIndustryEvidence,
  type AuditableAssessment,
} from '../lib/leadgen/icpIndustryEvidenceAudit';
import { prisma, tenantStorage } from '../lib/prisma';

const FETCH_CHUNK = 500;

const readArg = (args: string[], flag: string): string | null => {
  const index = args.indexOf(flag);
  return index !== -1 && args[index + 1] ? args[index + 1] : null;
};

const chunk = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

/**
 * The assessments the product currently reads: each campaign prospect's pointer, plus the tenant
 * default pointer on the pool record. Superseded assessments are history, not a verdict.
 */
const latestAssessmentIds = async (tx: typeof prisma, tenantId: string): Promise<string[]> => {
  const [prospects, poolItems] = await Promise.all([
    tx.campaignProspect.findMany({
      where: { tenantId, status: { not: 'removed' }, latestAssessmentId: { not: null } },
      select: { latestAssessmentId: true },
    }),
    tx.leadPoolItem.findMany({
      where: { tenantId, latestAssessmentId: { not: null } },
      select: { latestAssessmentId: true },
    }),
  ]);
  const ids = [...prospects, ...poolItems]
    .map((row) => row.latestAssessmentId)
    .filter((id): id is string => Boolean(id));
  return Array.from(new Set(ids));
};

const loadAssessments = async (
  tx: typeof prisma,
  tenantId: string,
  ids: readonly string[],
): Promise<AuditableAssessment[]> => {
  const rows: AuditableAssessment[] = [];
  for (const batch of chunk(ids, FETCH_CHUNK)) {
    const found = await tx.leadPoolAssessment.findMany({
      where: { tenantId, id: { in: batch } },
      select: {
        id: true,
        poolItemId: true,
        icpVersionId: true,
        qualification: true,
        inputSnapshot: true,
        rulesSnapshot: true,
      },
    });
    for (const row of found) {
      rows.push({
        assessmentId: row.id,
        poolItemId: row.poolItemId,
        icpVersionId: row.icpVersionId,
        persistedQualification: row.qualification as IcpQualification,
        inputSnapshot: row.inputSnapshot as AuditableAssessment['inputSnapshot'],
        rulesSnapshot: row.rulesSnapshot as AuditableAssessment['rulesSnapshot'],
      });
    }
  }
  return rows;
};

async function main() {
  const args = process.argv.slice(2);
  const tenantId = readArg(args, '--tenant');
  if (!tenantId) {
    console.error('Usage: audit-icp-industry-evidence.ts --tenant <tenantId> [--sample <n>]');
    process.exitCode = 2;
    return;
  }
  const sampleArg = readArg(args, '--sample');
  const sampleSize = sampleArg ? Number.parseInt(sampleArg, 10) : undefined;

  // Tenant context, no bypass: the client extension scopes every read to this tenant. The reads
  // are plain `findMany` calls on the extended client rather than an interactive transaction,
  // because with DB RLS enforced the extension opens its own per-query transaction to set the
  // tenant GUCs, and a wrapping transaction would not be the one those queries run in.
  const rows = await tenantStorage.run({ tenantId }, async () => {
    const ids = await latestAssessmentIds(prisma, tenantId);
    return loadAssessments(prisma, tenantId, ids);
  });

  const summary = summarizeIcpIndustryEvidence(rows, { sampleSize });
  console.log(
    JSON.stringify({ tenantId, generatedAt: new Date().toISOString(), ...summary }, null, 2),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().catch(() => {}));
