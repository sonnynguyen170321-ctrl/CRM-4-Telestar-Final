/**
 * Score every lead that was created before leads could carry a score.
 *
 * On production 2026-09-19, 987 of 1,138 leads had a null `engagementScore` and none had an
 * ICP verdict — every Import CSV row ever uploaded, because the importer scored pool items and
 * nothing else, and because a `Lead` had no ICP fields to write to. Both are fixed at the
 * doors now; this repairs what came through before.
 *
 * Two passes per tenant:
 *   1. engagement — `recalculateTenantEngagement`, the existing single-statement repair
 *   2. ICP — `rescoreLeadsIcp` over unscored leads, in batches until it reports no more
 *
 * ## Read before running
 *
 * Dry run by default. It prints what it would score and writes nothing until `--apply`.
 *
 *   npx tsx scripts/backfill-lead-icp.ts            # counts only
 *   npx tsx scripts/backfill-lead-icp.ts --apply     # write
 *
 * Idempotent: a re-run finds nothing unscored and the fingerprint makes a re-score of an
 * unchanged lead free. NOT SCORED stays NOT SCORED where a campaign has no published ICP —
 * that is reported per tenant, not papered over. Nothing here configures an ICP.
 */
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { recalculateTenantEngagement } from '@/lib/leads/recalculateEngagement';
import { rescoreLeadsIcp, RESCORE_LEADS_BATCH_LIMIT } from '@/lib/leads/icpScoring';

const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(APPLY ? 'Backfilling lead scores (WRITING).' : 'Backfilling lead scores (dry run — pass --apply to write).');

  const tenants = await tenantStorage.run({ tenantId: 'system', bypassRls: true }, () =>
    prisma.tenant.findMany({ select: { id: true, name: true } })
  );

  for (const tenant of tenants) {
    await tenantStorage.run({ tenantId: tenant.id }, async () => {
      const [total, engagementNull, icpUnscored, publishedIcps] = await Promise.all([
        prisma.lead.count({ where: { tenantId: tenant.id, archivedAt: null } }),
        prisma.lead.count({ where: { tenantId: tenant.id, archivedAt: null, engagementScore: null } }),
        prisma.lead.count({ where: { tenantId: tenant.id, archivedAt: null, latestIcpAssessmentId: null } }),
        prisma.icpVersion.count({ where: { tenantId: tenant.id, status: 'published' } }),
      ]);

      console.log(`\n${tenant.name} (${tenant.id}): ${total} leads · engagement null ${engagementNull} · ICP unscored ${icpUnscored} · published ICP versions ${publishedIcps}`);
      if (publishedIcps === 0) {
        console.log('  no published ICP — leads will stay NOT SCORED for ICP until a manager publishes one');
      }
      if (!APPLY) return;

      if (engagementNull > 0) {
        const summary = await tenantStorage.run({ tenantId: tenant.id, bypassRls: true }, () => recalculateTenantEngagement(tenant.id));
        console.log(`  engagement: updated ${summary.updatedCount} (hot ${summary.hotCount} / warm ${summary.warmCount} / cold ${summary.coldCount})`);
      }

      let scored = 0;
      let notScored = 0;
      const reasons: Record<string, number> = {};
      // Each batch only picks up leads still unscored, so a lead that stays NOT SCORED is
      // considered once per batch — bound the loop by the number of batches the count implies.
      const maxBatches = Math.ceil(icpUnscored / RESCORE_LEADS_BATCH_LIMIT) + 1;
      for (let i = 0; i < maxBatches; i++) {
        const report = await rescoreLeadsIcp({ tenantId: tenant.id, onlyUnscored: true, limit: RESCORE_LEADS_BATCH_LIMIT });
        scored += report.scored;
        notScored += report.notScored;
        for (const [k, v] of Object.entries(report.reasons)) reasons[k] = (reasons[k] ?? 0) + v;
        if (report.considered === 0 || report.scored === 0) break;
      }
      console.log(`  ICP: scored ${scored}, not scored ${notScored}${Object.keys(reasons).length ? ` (${Object.entries(reasons).map(([k, v]) => `${k}: ${v}`).join(', ')})` : ''}`);
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
