/**
 * Give every lead that is "in a sequence" the enrollment row that says so.
 *
 * `Lead.sequenceId` / `sequenceStep` / `sequenceStatus` are a cache of the cadence.
 * `SequenceEnrollment` *is* the cadence: every action on the Sequences page is keyed by
 * enrollment id, and so is `repairEnrollmentScheduleDrift`, the sweep that restarts a stalled
 * step. A lead with the cache and no row runs — the delayed job chain and the legacy branch of
 * `advanceSequence` carry it — but it cannot be listed, paused, bulk-actioned or repaired.
 *
 * Measured on production 2026-09-18: 556 leads imported the previous day were in exactly that
 * state, because `workers/import.ts` set the fields and never created the row. The import now
 * creates it (see `importEnrollmentIdFor`); this repairs the leads that predate that fix.
 *
 * ## Read before running
 *
 * Dry run by default. It prints the plan and writes nothing until `--apply`.
 *
 *   npx tsx scripts/sync-sequence-enrollments.ts            # show the plan
 *   npx tsx scripts/sync-sequence-enrollments.ts --apply     # write it
 *
 * Ids are derived from `(leadId, sequenceId)` rather than generated, so a second run converges
 * on the same rows instead of creating a parallel set if the existence check ever misses.
 *
 * A lead already held by an occupying enrollment for a *different* sequence is skipped, not
 * overwritten: one lead may have only one running cadence, the unique `occupancyKey` enforces
 * it, and deciding which of two cadences is the real one needs a human. Production had zero of
 * these at the time of writing; the branch exists so the script reports rather than aborting
 * halfway through if that changes.
 */
import { SequenceEnrollmentStatus } from '@prisma/client';
import { occupancyFor, occupancyKeyFor } from '@/lib/sequences/occupancy';
import { importEnrollmentIdFor } from '@/lib/sequences/identity';
import { createAdminClient } from '@/lib/db/adminClient.mjs';

const prisma = createAdminClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(
    APPLY
      ? 'Syncing sequence enrollments (WRITING).'
      : 'Syncing sequence enrollments (dry run — pass --apply to write).'
  );

  const leads = await prisma.lead.findMany({
    where: { sequenceId: { not: null } },
    select: {
      id: true,
      sequenceId: true,
      sequenceStep: true,
      sequenceStatus: true,
      tenantId: true,
    },
  });

  console.log(`Found ${leads.length} leads carrying a sequence.`);

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const blocked: string[] = [];

  for (const lead of leads) {
    if (!lead.sequenceId) continue;

    const existing = await prisma.sequenceEnrollment.findFirst({
      where: {
        leadId: lead.id,
        sequenceId: lead.sequenceId,
        status: { in: ['active', 'paused'] },
      },
    });

    const targetStatus = (lead.sequenceStatus || 'active') as SequenceEnrollmentStatus;
    const targetStep = lead.sequenceStep || 1;

    if (existing) {
      if (existing.status === targetStatus && existing.currentStep === targetStep) {
        unchanged++;
        continue;
      }
      if (APPLY) {
        await prisma.sequenceEnrollment.update({
          where: { id: existing.id },
          data: {
            status: targetStatus,
            currentStep: targetStep,
            occupancyKey: occupancyFor(targetStatus, lead.tenantId, lead.id),
          },
        });
      }
      updated++;
      continue;
    }

    // The lead may already be held by a cadence on another sequence. The occupancy key is
    // unique, so creating here would throw and abandon the rest of the run.
    const occupant = await prisma.sequenceEnrollment.findUnique({
      where: { occupancyKey: occupancyKeyFor(lead.tenantId, lead.id) },
      select: { id: true, sequenceId: true },
    });
    if (occupant) {
      blocked.push(
        `lead:${lead.id} wants sequence ${lead.sequenceId} but enrollment ${occupant.id} ` +
          `already occupies it on sequence ${occupant.sequenceId}`
      );
      continue;
    }

    if (APPLY) {
      await prisma.sequenceEnrollment.create({
        data: {
          id: importEnrollmentIdFor(lead.id, lead.sequenceId),
          leadId: lead.id,
          sequenceId: lead.sequenceId,
          status: targetStatus,
          currentStep: targetStep,
          tenantId: lead.tenantId,
          occupancyKey: occupancyFor(targetStatus, lead.tenantId, lead.id),
        },
      });
    }
    created++;
  }

  console.log(
    `${APPLY ? 'Wrote' : 'Would write'}: ${created} created, ${updated} updated. ` +
      `${unchanged} already correct.`
  );

  if (blocked.length > 0) {
    // Reported, never resolved automatically: picking a winner between two cadences for one
    // prospect is a decision about who is being emailed, not a data repair.
    console.log(`\n${blocked.length} lead(s) skipped — another cadence already holds them:`);
    for (const line of blocked) console.log(`  ${line}`);
  }

  if (!APPLY && (created > 0 || updated > 0)) {
    console.log('\nNothing was written. Re-run with --apply to make these changes.');
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
