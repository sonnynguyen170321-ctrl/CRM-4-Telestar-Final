#!/usr/bin/env node
/**
 * Identity backfill, phase 2: stamp the identity columns, merge the duplicate Accounts they reveal,
 * link contacts to the account they work for, and re-normalise the columns the writers key on.
 *
 * Dry run is the default and prints the full merge plan. `--apply` is one-way: take a snapshot first.
 *
 * Usage:
 *   npx tsx scripts/backfill-account-identity.ts --dry-run
 *   npx tsx scripts/backfill-account-identity.ts --dry-run --tenant <tenantId> --csv plan.csv
 *   npx tsx scripts/backfill-account-identity.ts --apply --tenant <tenantId>
 */

import { writeFileSync } from 'node:fs';

import { backfillAccountIdentity, mergePlansToCsv } from '../lib/identity/backfill';
import { prisma, tenantStorage } from '../lib/prisma';

async function main() {
  const args = process.argv.slice(2);
  const isApply = args.includes('--apply');
  const dryRun = !isApply;

  const tenantIdx = args.indexOf('--tenant');
  const tenantId = tenantIdx !== -1 && args[tenantIdx + 1] ? args[tenantIdx + 1] : null;

  const csvIdx = args.indexOf('--csv');
  const csvPath = csvIdx !== -1 && args[csvIdx + 1] ? args[csvIdx + 1] : null;

  console.log('────────────────────────────────────────────────────────');
  console.log('Account identity backfill — phase 2');
  console.log('────────────────────────────────────────────────────────');
  console.log(`Mode:      ${dryRun ? 'DRY-RUN (nothing is written)' : 'APPLY (one-way; snapshot first)'}`);
  console.log(`Tenant:    ${tenantId ?? 'ALL TENANTS'}`);
  console.log('');

  // The client extension scopes every query by the ambient tenant. A backfill deliberately spans
  // tenants, so it runs with the bypass the workers use — and each row is still written back with its
  // own `tenantId` in the WHERE clause, never a shared one.
  const report = await tenantStorage.run({ tenantId: tenantId ?? 'system', bypassRls: true }, () =>
    backfillAccountIdentity({ db: prisma as never, tenantId, dryRun })
  );

  console.log('Accounts');
  console.log(`  scanned:            ${report.accountsScanned}`);
  console.log(`  identity stamped:   ${report.accountsStamped}`);
  console.log(`  merge groups:       ${report.mergePlans.length}`);
  console.log(`  accounts merged:    ${report.accountsMerged}`);
  console.log('');
  console.log('Contacts');
  console.log(`  linked to account:  ${report.contactsLinked}`);
  console.log(`  employments created:${report.employmentsCreated}`);
  console.log(`  re-normalised:      ${report.contactsRenormalized}`);
  console.log('');
  console.log('Re-normalised');
  console.log(`  leads:              ${report.leadsRenormalized}`);
  console.log(`  pool items:         ${report.poolItemsRenormalized}`);
  console.log('');

  if (report.mergePlans.length > 0) {
    console.log('Merge plan (first 20 groups):');
    for (const plan of report.mergePlans.slice(0, 20)) {
      console.log(`  ${plan.survivorName}  ←  ${plan.losers.map((l) => l.name).join(', ')}   [${plan.reason}]`);
    }
    if (report.mergePlans.length > 20) console.log(`  … and ${report.mergePlans.length - 20} more`);
    console.log('');
  }

  if (csvPath) {
    writeFileSync(csvPath, mergePlansToCsv(report.mergePlans), 'utf8');
    console.log(`Merge plan written to ${csvPath}`);
  }

  if (dryRun && report.accountsMerged > 0) {
    console.log('Nothing was written. Review the plan, snapshot the database, then re-run with --apply.');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
