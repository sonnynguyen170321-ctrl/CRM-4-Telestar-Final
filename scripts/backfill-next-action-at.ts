#!/usr/bin/env node
/**
 * Backfill historical SequenceEnrollment.nextActionAt from authoritative pending task dueDate.
 *
 * Usage:
 *   npx tsx scripts/backfill-next-action-at.ts --dry-run
 *   npx tsx scripts/backfill-next-action-at.ts --apply
 *   npx tsx scripts/backfill-next-action-at.ts --apply --tenant <tenantId>
 */

import { backfillHistoricalNextActionAt } from '../lib/sequences/backfillNextActionAt';
import { prisma } from '../lib/prisma';

async function main() {
  const args = process.argv.slice(2);
  const isApply = args.includes('--apply');
  const isDryRun = args.includes('--dry-run') || !isApply;

  const tenantIdx = args.indexOf('--tenant');
  const tenantId = tenantIdx !== -1 && args[tenantIdx + 1] ? args[tenantIdx + 1] : undefined;

  console.log('────────────────────────────────────────────────────────');
  console.log('SequenceEnrollment nextActionAt Historical Backfill Tool');
  console.log('────────────────────────────────────────────────────────');
  console.log(`Mode:      ${isDryRun ? 'DRY-RUN (no changes will be written)' : 'APPLY (writing repairs to database)'}`);
  if (tenantId) {
    console.log(`Tenant:    ${tenantId}`);
  }
  console.log('');

  const result = await backfillHistoricalNextActionAt({
    dryRun: isDryRun,
    tenantId,
    client: prisma,
  });

  console.log('Results:');
  console.log(`  Total Evaluated:    ${result.totalEvaluated}`);
  console.log(`  Already Populated:  ${result.alreadyPopulated}`);
  console.log(`  Terminal Skipped:   ${result.terminalSkipped}`);
  console.log(`  ${isDryRun ? 'Repairs Candidate:' : 'Repairs Applied:'}  ${result.repaired}`);
  console.log(`  Unmatched / Manual: ${result.unmatched.length}`);

  if (result.unmatched.length > 0) {
    console.log('\nUnmatched enrollments (no authoritative task found):');
    for (const item of result.unmatched) {
      console.log(`  - Enrollment ${item.id} (Lead: ${item.leadId}, Step: ${item.currentStep}, Status: ${item.status}) -> ${item.reason}`);
    }
  }

  console.log('\nDone.');
}

main()
  .catch((err) => {
    console.error('Backfill error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
