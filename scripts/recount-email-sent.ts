/**
 * Make `Lead.emailSentCount` agree with the sent rows that actually exist.
 *
 * The counter is incremented at the moment a send is confirmed, which is correct — but every
 * incident that recorded a send which never happened left it overstated, and the repair scripts
 * written for those incidents each recounted only the leads inside their own window. What is
 * left is the residue: on production 2026-09-24, 26 leads disagreed with their sent rows, 23 of
 * them claiming one send against zero, all from failures on 2026-09-01 and 2026-09-17 — outside
 * the window `recover-refused-sequence-sends.ts` was given.
 *
 * This takes no window. It compares every lead against its own `sent` rows and writes the truth.
 * An overstated counter is not cosmetic: it is what a rep reads to decide whether a prospect has
 * already heard from them, and what reporting reads to decide whether outreach is working.
 *
 * ## Read before running
 *
 *   npx tsx scripts/recount-email-sent.ts            # report the disagreements
 *   npx tsx scripts/recount-email-sent.ts --apply    # write the real counts
 *
 * Dry run by default. Idempotent by construction: it is a recount, so running it twice changes
 * nothing the first run did not already settle. Safe to run on a schedule.
 */
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { OUTBOUND_STATUS } from '@/lib/email/idempotency';

const APPLY = process.argv.includes('--apply');

async function recountTenant(tenantName: string): Promise<void> {
  const leads = await prisma.lead.findMany({ select: { id: true, email: true, emailSentCount: true } });
  if (leads.length === 0) {
    console.log(`  ${tenantName}: no leads.`);
    return;
  }

  const truth = await prisma.outboundMessage.groupBy({
    by: ['leadId'],
    where: { status: OUTBOUND_STATUS.SENT },
    _count: { _all: true },
  });
  const realCount = new Map(truth.map((row) => [row.leadId, row._count._all]));

  const drifted = leads
    .map((lead) => ({ ...lead, real: realCount.get(lead.id) ?? 0 }))
    .filter((lead) => lead.emailSentCount !== lead.real);

  if (drifted.length === 0) {
    console.log(`  ${tenantName}: all ${leads.length} leads agree with their sent rows.`);
    return;
  }

  const overstated = drifted.filter((l) => l.emailSentCount > l.real);
  const phantom = overstated.reduce((sum, l) => sum + (l.emailSentCount - l.real), 0);
  console.log(
    `  ${tenantName}: ${drifted.length} of ${leads.length} leads disagree — ` +
      `${overstated.length} claim ${phantom} send(s) that never happened.`
  );
  for (const lead of drifted.slice(0, 10)) {
    console.log(`    ${lead.email}: claims ${lead.emailSentCount}, really ${lead.real}`);
  }

  if (!APPLY) return;

  for (const lead of drifted) {
    await prisma.lead.update({ where: { id: lead.id }, data: { emailSentCount: lead.real } });
  }
  console.log(`    recounted ${drifted.length} leads.`);
}

async function main() {
  console.log(
    APPLY
      ? 'Recounting Lead.emailSentCount from real sent rows (WRITING).'
      : 'Recounting Lead.emailSentCount (dry run — pass --apply to write).'
  );

  const tenants = await tenantStorage.run({ tenantId: 'system', bypassRls: true }, () =>
    prisma.tenant.findMany({ select: { id: true, name: true } })
  );

  for (const tenant of tenants) {
    await tenantStorage.run({ tenantId: tenant.id }, () => recountTenant(tenant.name));
  }

  console.log(APPLY ? 'Done.' : 'Dry run complete — nothing was written.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
