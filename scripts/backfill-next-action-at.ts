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
import { forEachTenant, asOperator } from './lib/tenantContext';

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

  // Inside tenant context, always. Without it `lib/prisma.ts` returns `[]` from every read on
  // production and this tool prints `Total Evaluated: 0` as though it had looked — which is
  // exactly what it did on 2026-09-24 while 278 enrollments had a null `nextActionAt`.
  const runs = tenantId
    ? [await asOperator(() => backfillHistoricalNextActionAt({ dryRun: isDryRun, tenantId, client: prisma }))]
    : await forEachTenant((tenant) =>
        backfillHistoricalNextActionAt({ dryRun: isDryRun, tenantId: tenant.id, client: prisma })
      );

  const result = runs.reduce(
    (acc, r) => ({
      dryRun: r.dryRun,
      totalEvaluated: acc.totalEvaluated + r.totalEvaluated,
      alreadyPopulated: acc.alreadyPopulated + r.alreadyPopulated,
      terminalSkipped: acc.terminalSkipped + r.terminalSkipped,
      repaired: acc.repaired + r.repaired,
      unmatched: [...acc.unmatched, ...r.unmatched],
    }),
    { dryRun: isDryRun, totalEvaluated: 0, alreadyPopulated: 0, terminalSkipped: 0, repaired: 0, unmatched: [] as (typeof runs)[number]['unmatched'] }
  );

  console.log('Results:');
  console.log(`  Tenants scanned:    ${runs.length}`);
  console.log(`  Total Evaluated:    ${result.totalEvaluated}`);
  console.log(`  Already Populated:  ${result.alreadyPopulated}`);
  console.log(`  Terminal Skipped:   ${result.terminalSkipped}`);
  console.log(`  ${isDryRun ? 'Repairs Candidate:' : 'Repairs Applied:'}  ${result.repaired}`);
  console.log(`  Unmatched / Manual: ${result.unmatched.length}`);

  // Zero of everything used to be indistinguishable from "nothing to do". It is not: it is also
  // what a tool that could not read a single row prints.
  if (runs.length > 0 && result.totalEvaluated === 0) {
    console.log(
      '\n  No enrollments were visible at all. If this database has any, the run had no tenant\n' +
        '  context and read nothing — do not read this as a clean result.'
    );
  }

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
