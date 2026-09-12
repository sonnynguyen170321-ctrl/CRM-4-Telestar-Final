#!/usr/bin/env node
/**
 * Backfill legacy LeadPoolItem assignment mirrors into CampaignProspect.
 *
 * Dry-run is the default. Apply is deliberately tenant-by-tenant:
 *   npm run backfill:campaign-prospects -- --dry-run
 *   npm run backfill:campaign-prospects -- --dry-run --tenant <tenantId>
 *   npm run backfill:campaign-prospects -- --apply --tenant <tenantId>
 */

import { backfillCampaignProspectsForTenant } from '../lib/leadgen/campaignProspectBackfill';
import { prisma, tenantStorage } from '../lib/prisma';

function valueAfter(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : null;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const tenantId = valueAfter(args, '--tenant');
  const requestedBatchSize = Number(valueAfter(args, '--batch-size') ?? '500');
  if (!Number.isInteger(requestedBatchSize) || requestedBatchSize < 1 || requestedBatchSize > 1000) {
    throw new Error('--batch-size must be an integer from 1 to 1000');
  }
  if (apply && !tenantId) {
    throw new Error('--apply requires --tenant <tenantId>; cross-tenant writes are refused');
  }

  const tenants = tenantId
    ? [{ id: tenantId }]
    : await tenantStorage.run({ tenantId: 'system', bypassRls: true }, () =>
        prisma.tenant.findMany({ select: { id: true }, orderBy: { id: 'asc' } })
      );

  let hasConflicts = false;
  for (const tenant of tenants) {
    const report = await tenantStorage.run(
      { tenantId: tenant.id, bypassRls: true },
      () =>
        backfillCampaignProspectsForTenant({
          tenantId: tenant.id,
          dryRun: !apply,
          batchSize: requestedBatchSize,
        })
    );
    hasConflicts ||= report.conflicts.length > 0;
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...report }, null, 2));
  }

  if (hasConflicts) {
    process.exitCode = 2;
    console.error('Conflicts found; no conflicting row was written.');
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
