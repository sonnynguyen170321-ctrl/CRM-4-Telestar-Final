/**
 * Finish approvals whose draft never got created (Task 3B).
 *
 * `reviewProposal` claims the decision before it builds anything, so a crash between the two
 * leaves a proposal reading `approved` with no draft — and `reviewProposal` will not re-enter,
 * because the status is no longer `proposed`. That guard is right and stays. This is the other
 * half: an operator-run repair that **finishes** the decision instead of retaking it.
 *
 * `completeApprovedProposal` existed for this and had no caller, which meant the recovery path
 * was a function nobody could invoke. A repair that cannot be run is not a repair.
 *
 * ```bash
 * npm run repair:approved-proposals                 # report only — writes nothing
 * npm run repair:approved-proposals -- --apply
 * npm run repair:approved-proposals -- --apply --tenant=<id>
 * ```
 *
 * Dry-run is the default on purpose: this writes policy rows, and the first thing an operator
 * needs is a list of what is actually broken. Applying is idempotent — the draft is found through
 * the same unique key that would refuse a duplicate — so a second run reports zero repairs rather
 * than a second draft.
 */
import { prisma, tenantStorage } from '@/lib/prisma';
import { completeApprovedProposal, ProposalError } from '@/lib/learning/proposals';

interface Options {
  apply: boolean;
  tenantId: string | null;
}

function parseArgs(argv: string[]): Options {
  const tenant = argv.find((a) => a.startsWith('--tenant='));
  return {
    apply: argv.includes('--apply'),
    tenantId: tenant ? tenant.slice('--tenant='.length) : null,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  // Read across tenants under an explicit system scope. The repair itself then runs inside each
  // proposal's own tenant context, so every write is scoped exactly as the application scopes it.
  const stranded = await tenantStorage.run({ tenantId: 'system', bypassRls: true }, async () =>
    prisma.playbookProposal.findMany({
      where: {
        status: 'approved',
        createdVersion: { is: null },
        ...(options.tenantId ? { tenantId: options.tenantId } : {}),
      },
      select: {
        id: true,
        tenantId: true,
        campaignId: true,
        title: true,
        reviewedById: true,
        reviewedAt: true,
      },
      orderBy: { reviewedAt: 'asc' },
    })
  );

  if (stranded.length === 0) {
    console.log('No approved proposal is missing its draft. Nothing to repair.');
    return;
  }

  console.log(
    `${stranded.length} approved proposal(s) have no draft${options.apply ? '' : ' — dry run, nothing will be written'}:`
  );

  let repaired = 0;
  let failed = 0;

  for (const proposal of stranded) {
    const label = `${proposal.id} (tenant ${proposal.tenantId}, campaign ${proposal.campaignId}) — ${proposal.title}`;

    if (!options.apply) {
      console.log(`  would repair: ${label}`);
      continue;
    }

    try {
      const result = await tenantStorage.run(
        { tenantId: proposal.tenantId, bypassRls: true },
        () => completeApprovedProposal({ tenantId: proposal.tenantId, proposalId: proposal.id })
      );
      repaired += 1;
      console.log(`  repaired: ${label} → draft version ${result.createdVersionNumber}`);
    } catch (err) {
      failed += 1;
      // Reported, not thrown: one proposal whose base version was deleted must not stop the
      // repair of every other one. A refusal here is information the operator needs, and the
      // remaining rows are still repairable.
      const reason = err instanceof ProposalError ? `${err.code}: ${err.message}` : String(err);
      console.error(`  REFUSED: ${label}\n    ${reason}`);
    }
  }

  if (options.apply) {
    console.log(`\nRepaired ${repaired}, refused ${failed}, of ${stranded.length}.`);
  } else {
    console.log('\nRe-run with --apply to write the drafts.');
  }

  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
