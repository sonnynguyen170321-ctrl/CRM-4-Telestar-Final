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
 *   2. ICP — `rescoreLeadsIcp` over unscored leads (or every lead with `--all`), batch after
 *      batch by cursor until there are no more
 *
 * ## Read before running
 *
 * Dry run by default. It prints what it would score and writes nothing until `--apply`.
 *
 *   npx tsx scripts/backfill-lead-icp.ts                 # counts only
 *   npx tsx scripts/backfill-lead-icp.ts --all           # counts + the verdict moves a full rescore would make
 *   npx tsx scripts/backfill-lead-icp.ts --apply         # write: unscored leads only
 *   npx tsx scripts/backfill-lead-icp.ts --all --apply   # write: every lead (after a rules or engine change)
 *
 * `--all` is for when the engine or an ICP changed (the verdict version moves the fingerprint, so
 * every lead gets a fresh assessment). A rep's own verdict still wins over the new score.
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
const ALL = process.argv.includes('--all');

const list = (counts: Record<string, number>) =>
  Object.keys(counts).length ? ` (${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', ')})` : '';

/** Every lead in scope, batch after batch by cursor. Dry run reports moves; apply writes. */
async function rescoreTenant(tenantId: string, dryRun: boolean) {
  const totals = { scored: 0, notScored: 0, unchanged: 0, pinned: 0, reasons: {} as Record<string, number>, transitions: {} as Record<string, number> };
  let cursor: string | undefined;
  do {
    const report = await rescoreLeadsIcp({ tenantId, onlyUnscored: !ALL, limit: RESCORE_LEADS_BATCH_LIMIT, cursor, dryRun });
    totals.scored += report.scored;
    totals.notScored += report.notScored;
    totals.unchanged += report.unchanged ?? 0;
    totals.pinned += report.pinned ?? 0;
    for (const [k, v] of Object.entries(report.reasons)) totals.reasons[k] = (totals.reasons[k] ?? 0) + v;
    for (const [k, v] of Object.entries(report.transitions ?? {})) totals.transitions[k] = (totals.transitions[k] ?? 0) + v;
    cursor = report.nextCursor ?? undefined;
  } while (cursor);
  return totals;
}

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
      if (!APPLY) {
        if (ALL) {
          const preview = await rescoreTenant(tenant.id, true);
          console.log(`  ICP preview (--all): ${preview.scored} checked, ${preview.unchanged} unchanged, ${preview.pinned} kept by a rep's verdict, not scorable ${preview.notScored}${list(preview.reasons)}`);
          console.log(`  verdict moves${list(preview.transitions) || ': none'}`);
        }
        return;
      }

      if (engagementNull > 0) {
        const summary = await tenantStorage.run({ tenantId: tenant.id, bypassRls: true }, () => recalculateTenantEngagement(tenant.id));
        console.log(`  engagement: updated ${summary.updatedCount} (hot ${summary.hotCount} / warm ${summary.warmCount} / cold ${summary.coldCount})`);
      }

      const done = await rescoreTenant(tenant.id, false);
      console.log(`  ICP${ALL ? ' (--all)' : ''}: scored ${done.scored}, not scored ${done.notScored}${list(done.reasons)}`);
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
