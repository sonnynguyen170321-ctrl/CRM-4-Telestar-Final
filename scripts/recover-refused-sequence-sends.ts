/**
 * Put back what the 2026-09-21 burst broke, and re-send the mail that never left.
 *
 * That night all 278 due sequence jobs fired inside one minute at 02:00. The provider accepted
 * 50 and refused 228 with `550 5.4.6 Sender Hourly Quota Exceeded`. Because the cadence was
 * settled at enqueue time rather than on the provider's answer, the CRM recorded 228 completed
 * tasks, advanced 228 enrollments to step 2, and left 251 leads with an `emailSentCount` no
 * sent row supports. The 228 messages themselves sat `failed` in a state no maintenance sweep
 * scanned, so nothing was ever going to try them again.
 *
 * The code fix stops it recurring. This repairs the leads already caught by it:
 *
 *   1. schedule — every refused message gets one time, computed once, spread across business
 *      hours at the mailbox's own `hourlyCap` via the shared `nextSendAttemptAt`, so the
 *      recovery cannot re-form the burst that caused this
 *   2. rewind — the enrollment goes back to the step whose send was refused, active, with that
 *      time as its `nextActionAt`, so step 2 cannot go out referencing a step 1 nobody received
 *   3. reopen — the task returns to `pending`, unlocked, uncompleted, due at the same time,
 *      and the *next* step's task, which exists only because of the false advance, is skipped
 *      so it cannot fire at a prospect who is back at step 1
 *   4. re-queue — the outbound row is reset to `pending` with its attempts cleared and
 *      enqueued for that same time
 *   5. recount — `Lead.emailSentCount` is recomputed from real `sent` rows rather than
 *      decremented by a guess, which also repairs drift this incident did not cause
 *
 * The one time in step 1 is used by all four. A task due at one moment, an enrollment expecting
 * another and a job firing at a third is how a cadence ends up sending twice.
 *
 * ## Read before running
 *
 * Dry run by default. It prints exactly what it would touch and writes nothing until `--apply`.
 *
 *   npx tsx scripts/recover-refused-sequence-sends.ts                     # report only
 *   npx tsx scripts/recover-refused-sequence-sends.ts --apply             # write and re-queue
 *   npx tsx scripts/recover-refused-sequence-sends.ts --since=2026-09-15 --apply
 *   npx tsx scripts/recover-refused-sequence-sends.ts --apply --no-requeue  # repair only
 *
 * Idempotent. A second run finds the messages already `pending` rather than `failed` and
 * selects nothing; the recount is a recount, so it converges. Safe to re-run after a partial
 * failure.
 *
 * It only ever touches messages that are `failed` with `sentAt IS NULL` — rows where the
 * provider definitively refused and the prospect was definitively not written to. An ambiguous
 * send (`reconciliation_required`) is never re-queued here, because it may already have landed.
 */
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { enqueueReschedule } from '@/lib/bullmq/enqueue';
import { JobType } from '@/lib/bullmq/types';
import { OUTBOUND_STATUS } from '@/lib/email/idempotency';
import { nextSendAttemptAt } from '@/lib/email/sendWindow';

const APPLY = process.argv.includes('--apply');
const REQUEUE = !process.argv.includes('--no-requeue');

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

/** Default window: the incident itself. Widen it with `--since` if another burst is found. */
const SINCE = new Date(arg('since') ?? '2026-09-20T00:00:00Z');
const UNTIL = new Date(arg('until') ?? '2026-09-23T00:00:00Z');

/** Fall back to a conservative ceiling for a mailbox that has never had one set. */
const DEFAULT_HOURLY_CAP = 40;

type Affected = {
  id: string;
  leadId: string;
  accountId: string;
  to: string;
  subject: string | null;
  body: string | null;
  sequenceId: string | null;
  sequenceStepOrder: number | null;
  abVariantId: string | null;
  lead: { timezone: string | null } | null;
};

/**
 * One send time per message, paced per mailbox.
 *
 * Messages are walked in the order they were created, so the prospect who has waited longest is
 * scheduled first. Each full `hourlyCap` of backlog pushes the next group an hour further out,
 * and `nextSendAttemptAt` then lands each one inside the prospect's working day with jitter
 * keyed to the message id — the same spread the worker uses, so a deferral and a recovery agree.
 */
async function scheduleFor(messages: Affected[]): Promise<Map<string, Date>> {
  const caps = new Map<string, number>();
  for (const accountId of new Set(messages.map((m) => m.accountId))) {
    const account = await prisma.emailAccount.findUnique({
      where: { id: accountId },
      select: { hourlyCap: true },
    });
    caps.set(
      accountId,
      account?.hourlyCap && account.hourlyCap > 0 ? account.hourlyCap : DEFAULT_HOURLY_CAP
    );
  }

  const now = new Date();
  const used = new Map<string, number>();
  const schedule = new Map<string, Date>();

  for (const msg of messages) {
    const index = used.get(msg.accountId) ?? 0;
    used.set(msg.accountId, index + 1);
    const cap = caps.get(msg.accountId) ?? DEFAULT_HOURLY_CAP;
    schedule.set(
      msg.id,
      nextSendAttemptAt({
        now,
        minHours: Math.floor(index / cap),
        timezone: msg.lead?.timezone ?? null,
        seed: msg.id,
      })
    );
  }

  return schedule;
}

async function recoverTenant(tenantId: string, tenantName: string): Promise<void> {
  const refused: Affected[] = await prisma.outboundMessage.findMany({
    where: {
      status: OUTBOUND_STATUS.FAILED,
      sentAt: null,
      createdAt: { gte: SINCE, lt: UNTIL },
    },
    select: {
      id: true,
      leadId: true,
      accountId: true,
      to: true,
      subject: true,
      body: true,
      sequenceId: true,
      sequenceStepOrder: true,
      abVariantId: true,
      lead: { select: { timezone: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (refused.length === 0) {
    console.log(`  ${tenantName}: nothing refused in the window.`);
    return;
  }

  const cadenceSends = refused.filter((m) => m.sequenceId && m.sequenceStepOrder !== null);
  console.log(
    `  ${tenantName}: ${refused.length} refused, ${cadenceSends.length} of them cadence steps.`
  );

  const schedule = await scheduleFor(refused);
  const times = [...schedule.values()].sort((a, b) => a.getTime() - b.getTime());
  console.log(
    `    spread from ${times[0]?.toISOString()} to ${times[times.length - 1]?.toISOString()}`
  );

  // ── what is wrong, before anything is touched ─────────────────────────────
  const leadIds = [...new Set(refused.map((m) => m.leadId))];
  const drift = await countDrift(leadIds);
  const phantom = drift.reduce((sum, d) => sum + d.claimed - d.real, 0);
  console.log(
    `    ${drift.length} leads disagree with their sent rows (${phantom} phantom sends in total).`
  );

  if (!APPLY) {
    console.log(
      `    would reset ${refused.length} messages, rewind the cadences behind them, recount ` +
        `${drift.length} leads and re-queue across that window.`
    );
    return;
  }

  // ── repair, recount and re-queue — one message at a time ──────────────────
  //
  // Each message is carried all the way through before the next is started, and one that throws
  // does not stop the rest. Repairing all 228 first and recounting and re-queueing afterwards
  // looked tidier and was wrong: a crash partway through would leave the already-repaired
  // messages `pending` — no longer selected by this script's `failed` query on a re-run — with
  // their counts never recomputed and their business-hours schedule discarded. Silent,
  // permanent, and in exactly the category this script exists to repair.
  let reset = 0;
  let reopened = 0;
  let rewound = 0;
  let retracted = 0;
  let recounted = 0;
  let queued = 0;
  const failures: string[] = [];

  for (const msg of refused) {
    const dueAt = schedule.get(msg.id)!;
    try {
      await prisma.$transaction(async (tx) => {
        // The message goes back into the claimable pool with a clean attempt count. Without the
        // reset it would be refused by the redrive cap the moment a sweep picked it up.
        const back = await tx.outboundMessage.updateMany({
          where: { id: msg.id, status: OUTBOUND_STATUS.FAILED, sentAt: null },
          data: {
            status: OUTBOUND_STATUS.PENDING,
            errorMessage: null,
            attemptCount: 0,
            claimedAt: null,
          },
        });
        reset += back.count;

        if (!msg.sequenceId || msg.sequenceStepOrder === null) return;

        // Read before writing: whether this cadence was pushed ahead by the false advance decides
        // whether the next step's task is a phantom to retract or legitimate work to leave alone.
        const current = await tx.sequenceEnrollment.findFirst({
          where: {
            leadId: msg.leadId,
            sequenceId: msg.sequenceId,
            status: { in: ['active', 'paused'] },
          },
          select: { id: true, currentStep: true },
        });
        const wasAhead = (current?.currentStep ?? 0) > msg.sequenceStepOrder;

        const task = await tx.task.findFirst({
          where: {
            leadId: msg.leadId,
            sequenceId: msg.sequenceId,
            sequenceStep: msg.sequenceStepOrder,
          },
          select: { id: true, status: true },
          orderBy: { createdAt: 'desc' },
        });
        if (task && task.status !== 'pending') {
          await tx.task.update({
            where: { id: task.id },
            data: { status: 'pending', completedAt: null, lockedAt: null, dueDate: dueAt },
          });
          reopened++;
        } else if (task) {
          await tx.task.update({ where: { id: task.id }, data: { dueDate: dueAt, lockedAt: null } });
        }

        // Back to the step that was refused, and active: a cadence sitting at step 2 would send
        // a follow-up to a prospect who has never heard from us. `nextActionAt` is the same
        // instant the job is queued for — a null there is what made 278 enrollments invisible to
        // `repairEnrollmentScheduleDrift`, and two different times would let it queue a duplicate.
        const enrollment = await tx.sequenceEnrollment.updateMany({
          where: {
            leadId: msg.leadId,
            sequenceId: msg.sequenceId,
            status: { in: ['active', 'paused'] },
          },
          data: {
            status: 'active',
            currentStep: msg.sequenceStepOrder,
            pausedReason: null,
            nextActionAt: dueAt,
            lastTransitionAt: new Date(),
          },
        });
        rewound += enrollment.count;

        if (wasAhead) {
          // The step-2 task exists only because step 1 was recorded as sent. Left pending it would
          // go out as "just circling back" to someone who has never heard from us. `skipped`
          // rather than deleted, so what this incident did stays readable in the history;
          // `advanceSequence` creates a fresh one when step 1 genuinely lands.
          const phantom = await tx.task.updateMany({
            where: {
              leadId: msg.leadId,
              sequenceId: msg.sequenceId,
              sequenceStep: { gt: msg.sequenceStepOrder },
              status: 'pending',
            },
            data: {
              status: 'skipped',
              lockedAt: null,
              notes: 'Retracted: created by an advance for a send the provider refused (2026-09-21).',
            },
          });
          retracted += phantom.count;
        }

        // The lead's own mirror of its cadence position, used by the legacy advance path.
        await tx.lead.updateMany({
          where: { id: msg.leadId, sequenceId: msg.sequenceId },
          data: { sequenceStep: msg.sequenceStepOrder, sequenceStatus: 'active' },
        });
      });
      // Recomputed from real sent rows, so running it once per message of the same lead
      // converges rather than double-counting.
      const [stillDrifted] = await countDrift([msg.leadId]);
      if (stillDrifted) {
        await prisma.lead.update({
          where: { id: msg.leadId },
          data: { emailSentCount: stillDrifted.real },
        });
        recounted++;
      }

      if (REQUEUE) {
        await enqueueReschedule(
          JobType.EMAIL_SEND,
          {
            outboundMessageId: msg.id,
            accountId: msg.accountId,
            to: msg.to,
            subject: msg.subject ?? '',
            body: msg.body ?? '',
            leadId: msg.leadId,
            ...(msg.sequenceId && msg.sequenceStepOrder !== null
              ? { sequenceStepRef: await buildStepRef(msg) }
              : {}),
          },
          {
            tenantId,
            delay: Math.max(0, dueAt.getTime() - Date.now()),
            discriminator: `recovery:${dueAt.toISOString()}`,
          }
        );
        queued++;
      }
    } catch (err) {
      // Named, not swallowed. This message stays `failed`, so a re-run picks it up again with
      // everything it needs; the ones already carried through are finished and stay finished.
      failures.push(`${msg.id} (${msg.to}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(
    `    reset ${reset} messages, reopened ${reopened} tasks, rewound ${rewound} enrollments,` +
      ` retracted ${retracted} phantom follow-ups, recounted ${recounted} leads, re-queued ${queued}.`
  );
  if (!REQUEUE) {
    console.log('    --no-requeue: the messages are claimable but nothing was enqueued.');
  }
  if (failures.length) {
    console.log(`
    ${failures.length} message(s) could not be recovered — re-run to retry:`);
    for (const f of failures.slice(0, 10)) console.log(`      ${f}`);
  }
}

/** What each lead claims to have sent, against the sent rows that actually exist. */
async function countDrift(
  leadIds: string[]
): Promise<{ id: string; claimed: number; real: number }[]> {
  const truth = await prisma.outboundMessage.groupBy({
    by: ['leadId'],
    where: { leadId: { in: leadIds }, status: OUTBOUND_STATUS.SENT },
    _count: { _all: true },
  });
  const realCount = new Map(truth.map((row) => [row.leadId, row._count._all]));

  const claimed = await prisma.lead.findMany({
    where: { id: { in: leadIds } },
    select: { id: true, emailSentCount: true },
  });
  return claimed
    .map((l) => ({ id: l.id, claimed: l.emailSentCount, real: realCount.get(l.id) ?? 0 }))
    .filter((d) => d.claimed !== d.real);
}

/** The reopened task and the rewound enrollment, so the recovered send settles its own step. */
async function buildStepRef(msg: Affected) {
  const task = await prisma.task.findFirst({
    where: {
      leadId: msg.leadId,
      sequenceId: msg.sequenceId!,
      sequenceStep: msg.sequenceStepOrder!,
      status: 'pending',
    },
    select: { id: true, lead: { select: { assignedToId: true } } },
    orderBy: { createdAt: 'desc' },
  });
  if (!task) return undefined;

  const enrollment = await prisma.sequenceEnrollment.findFirst({
    where: { leadId: msg.leadId, sequenceId: msg.sequenceId!, status: { in: ['active', 'paused'] } },
    select: { id: true },
  });

  return {
    taskId: task.id,
    leadId: msg.leadId,
    actorUserId: task.lead.assignedToId,
    sequenceId: msg.sequenceId!,
    sequenceStep: msg.sequenceStepOrder!,
    enrollmentId: enrollment?.id,
    abVariantId: msg.abVariantId,
  };
}

async function main() {
  console.log(
    APPLY
      ? 'Recovering refused sequence sends (WRITING).'
      : 'Recovering refused sequence sends (dry run — pass --apply to write).'
  );
  console.log(`Window: ${SINCE.toISOString()} .. ${UNTIL.toISOString()}`);

  const tenants = await tenantStorage.run({ tenantId: 'system', bypassRls: true }, () =>
    prisma.tenant.findMany({ select: { id: true, name: true } })
  );

  for (const tenant of tenants) {
    await tenantStorage.run({ tenantId: tenant.id }, () => recoverTenant(tenant.id, tenant.name));
  }

  console.log(APPLY ? 'Done.' : 'Dry run complete — nothing was written.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
