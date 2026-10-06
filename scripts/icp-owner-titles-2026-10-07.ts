/**
 * Owner request, 2026-10-07: add six accepted titles to the TeleStar ICPs, and move the two
 * campaigns still scoring against the archived "TeleStar ICP" v1 onto the current version.
 *
 *   - "TeleStar ICP": new version = the published one + the titles. Tele Campaign Alpha and
 *     "Telestar - 2nd Floor campaign test" are pointed at it.
 *   - the tenant default ICP ("Telestar"): new version = the published one + the titles, so
 *     campaigns with no ICP of their own (which fall back to the default) agree.
 *
 * Goes through the ICP builder's own path (`lib/leadgen/icpAllowlistUpdate.ts`): old versions stay
 * as they were, every change is a new published version.
 *
 * ## Run
 *
 * Dry run by default — prints the plan, writes nothing.
 *
 *   npx tsx scripts/icp-owner-titles-2026-10-07.ts --tenant <tenantId>
 *   npx tsx scripts/icp-owner-titles-2026-10-07.ts --tenant <tenantId> --apply
 *
 * Then rescore so leads pick it up: `npx tsx scripts/backfill-lead-icp.ts --all` (preview), then
 * with `--apply`. Re-running after a full apply changes nothing; re-running after a failed one
 * finishes it (any campaign still on an old version of the profile is moved).
 */
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { updateIcpAllowlist } from '@/lib/leadgen/icpAllowlistUpdate';

const TITLES = ['Managing Director', 'Owner', 'President', 'Sales Director', 'CSO', 'VP Sales'];
const PROFILE_NAME = 'TeleStar ICP';
const CAMPAIGN_NAMES = ['Tele Campaign Alpha', 'Telestar - 2nd Floor campaign test'];

const APPLY = process.argv.includes('--apply');
const tenantArg = process.argv.indexOf('--tenant');
const TENANT_ID = tenantArg > -1 ? process.argv[tenantArg + 1] : undefined;

async function main() {
  if (!TENANT_ID) throw new Error('Pass --tenant <tenantId>');
  console.log(APPLY ? 'Updating ICP titles (WRITING).' : 'Updating ICP titles (dry run — pass --apply to write).');

  await tenantStorage.run({ tenantId: TENANT_ID }, async () => {
    const [named, fallback, campaigns] = await Promise.all([
      prisma.icpProfile.findFirst({ where: { tenantId: TENANT_ID, name: PROFILE_NAME }, select: { id: true } }),
      prisma.icpProfile.findFirst({ where: { tenantId: TENANT_ID, isDefault: true }, select: { id: true } }),
      prisma.campaign.findMany({ where: { tenantId: TENANT_ID, name: { in: CAMPAIGN_NAMES } }, select: { id: true, name: true } }),
    ]);
    if (!named) throw new Error(`ICP profile "${PROFILE_NAME}" not found`);
    const missing = CAMPAIGN_NAMES.filter((name) => !campaigns.some((c) => c.name === name));
    if (missing.length) throw new Error(`Campaign(s) not found: ${missing.join(', ')}`);

    const jobs = [{ profileId: named.id, campaignIds: campaigns.map((c) => c.id) }];
    if (fallback && fallback.id !== named.id) jobs.push({ profileId: fallback.id, campaignIds: [] });

    // Plan every job before writing any, so a refusal (open draft, two published versions) stops
    // the run before the first profile changes.
    for (const job of jobs) {
      const plan = await updateIcpAllowlist({ tenantId: TENANT_ID, profileId: job.profileId, addTitles: TITLES, campaignIds: job.campaignIds });
      console.log(`\n"${plan.profileName}" (from v${plan.fromVersionNumber})`);
      console.log(`  add titles: ${plan.titlesToAdd.join(', ') || 'none'}${plan.titlesAlreadyThere.length ? ` · already there: ${plan.titlesAlreadyThere.join(', ')}` : ''}`);
      console.log(`  campaigns to move: ${plan.campaignsToMove.map((c) => c.name).join(', ') || 'none'}`);
    }
    if (!APPLY) return;

    const applied: string[] = [];
    for (const job of jobs) {
      try {
        const done = await updateIcpAllowlist({ tenantId: TENANT_ID, profileId: job.profileId, addTitles: TITLES, campaignIds: job.campaignIds, apply: true });
        applied.push(`"${done.profileName}" → version ${done.publishedVersionId}`);
        console.log(`\napplied: ${applied[applied.length - 1]}`);
      } catch (error) {
        console.error(`\nFAILED after ${applied.length} of ${jobs.length} profile(s). Already applied: ${applied.join('; ') || 'nothing'}.`);
        console.error('Fix the cause and run again: a re-run finishes the moves and adds nothing twice.');
        throw error;
      }
    }
  });
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
