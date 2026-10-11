/**
 * Before deploying "every campaign scores against its own ICP" (owner decision 2026-10-10: no silent
 * fallback to the company default): list the campaigns that have no usable ICP, how many active
 * leads each has, and how many of them carry a verdict today that a rescore will clear to NOT SCORED.
 *
 * READ-ONLY. Writes nothing, takes no --apply.
 *
 *   npx tsx scripts/campaign-icp-dry-run.ts --tenant <tenantId>
 *
 * The tenant context is required: without it the tenant-scoped client returns empty lists on
 * production and the report would say "nothing to do" while blind.
 */
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { listCampaignsWithoutIcp } from '@/lib/leadgen/campaignIcpAudit';

const tenantArg = process.argv.indexOf('--tenant');
const TENANT_ID = tenantArg > -1 ? process.argv[tenantArg + 1] : undefined;

async function main() {
  if (!TENANT_ID) throw new Error('Pass --tenant <tenantId>');
  console.log('Campaigns without a usable ICP (dry run — this script never writes).');

  const rows = await tenantStorage.run({ tenantId: TENANT_ID }, async () => {
    const total = await prisma.campaign.count({ where: { tenantId: TENANT_ID } });
    if (total === 0) throw new Error(`No campaigns visible for tenant ${TENANT_ID}; refusing to report an empty list while blind.`);
    return listCampaignsWithoutIcp(TENANT_ID);
  });

  if (rows.length === 0) {
    console.log('Every campaign has a usable ICP. A rescore changes nothing.');
    return;
  }
  for (const row of rows) {
    console.log(
      `- ${row.name} [${row.status}] ${row.reason}: ${row.leads} active lead(s), ${row.withVerdict} carry a verdict that a rescore will clear; ${row.prospects} pool prospect(s), ${row.prospectsWithVerdict} with an assessment a pool rescore will clear`,
    );
  }
  const leads = rows.reduce((sum, r) => sum + r.leads, 0);
  const flipping = rows.reduce((sum, r) => sum + r.withVerdict, 0);
  const prospectsFlipping = rows.reduce((sum, r) => sum + r.prospectsWithVerdict, 0);
  console.log(
    `\n${rows.length} campaign(s), ${leads} lead(s), ${flipping} lead verdict(s) and ${prospectsFlipping} prospect assessment(s) will flip to NOT SCORED.`,
  );
  console.log(
    'Lead verdicts clear on POST /api/leads/rescore-icp (the default call includes them); prospects clear on the pool rescore of the campaign.',
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
