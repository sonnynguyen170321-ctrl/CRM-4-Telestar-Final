import { prisma } from '@/lib/prisma';
import { createAppWorker } from '@/lib/bullmq';
import { JobType } from '@/lib/bullmq/types';
import { runHealthcheck } from './healthcheck';
import { enrollmentIdFromStepTaskId, enrollmentStepTaskId } from '@/lib/sequences/identity';
import type { MaintenanceRepairPayload } from '@/lib/bullmq/types';
import { OUTBOUND_STATUS, SENDING_CLAIM_LEASE_MS } from '@/lib/email/idempotency';
import { enqueueReschedule } from '@/lib/bullmq/enqueue';
import { ensureOccurrenceStepTask } from '@/lib/sequences/occurrenceTask';
import { finalizeSequenceStep, releaseSequenceStep, resolveStepRefForOutbound } from '@/lib/sequences/stepOutcome';

/**
 * Shared with the send path, which uses the same window to decide whether a `sending` claim is
 * still live. Two independent constants could drift into disagreeing, and both would then act
 * on the same row — the sweeper recovering it while a worker still believes it owns it.
 */
const STALE_SENDING_THRESHOLD_MS = SENDING_CLAIM_LEASE_MS;
const STUCK_RUNNING_THRESHOLD_MS = 15 * 60 * 1000;
/** How long an ambiguous send may wait for delivery evidence before we give up on it. */
const RECONCILE_GRACE_MS = 24 * 60 * 60 * 1000;
const RECONCILE_BATCH = 200;
/** Grace period before a claimable outbound with no live job counts as stalled. */
const STALE_PENDING_OUTBOUND_MS = 60 * 60 * 1000;
/** Re-drive ceiling — matches the send worker's own deferral cap. */
const MAX_OUTBOUND_REDRIVES = 5;

async function repairOrphanTasks(): Promise<{ fixed: number; details: string[] }> {
  const details: string[] = [];
  let fixed = 0;

  const tasks = await prisma.task.findMany({
    where: { status: 'pending' },
    select: { id: true, leadId: true, userId: true },
  });

  for (const task of tasks) {
    const lead = await prisma.lead.findUnique({ where: { id: task.leadId }, select: { id: true } });
    const user = await prisma.user.findUnique({ where: { id: task.userId }, select: { id: true } });
    if (!lead || !user) {
      await prisma.task.update({
        where: { id: task.id, status: 'pending' },
        data: { status: 'skipped', notes: `Deleted due to orphan: ${!lead ? 'lead missing' : ''} ${!user ? 'user missing' : ''}`.trim() },
      });
      fixed++;
      details.push(`task:${task.id} -> skipped (${!lead ? 'no lead' : 'no user'})`);
    }
  }

  return { fixed, details };
}

/**
 * Sweep sends that were claimed and never finished.
 *
 * A claim with a provider id is a lost final write and settles as `sent`. A claim
 * *without* one is ambiguous — the worker may have died before, during or after the
 * provider call — so it moves to `reconciliation_required`, **not** `failed`. This used
 * to write `failed`, which put the row back in the claimable pool and made a duplicate
 * delivery one manual retry away.
 */
async function repairStaleSending(): Promise<{ fixed: number; details: string[] }> {
  const details: string[] = [];
  let fixed = 0;
  const cutoff = new Date(Date.now() - STALE_SENDING_THRESHOLD_MS);

  // Age off `claimedAt`, not `updatedAt`: any unrelated write bumps `updatedAt` and would
  // keep resetting the staleness clock on a genuinely stuck row.
  const stale = await prisma.outboundMessage.findMany({
    where: { status: OUTBOUND_STATUS.SENDING, claimedAt: { lt: cutoff } },
    select: { id: true, providerMessageId: true },
  });

  for (const msg of stale) {
    if (msg.providerMessageId) {
      await prisma.outboundMessage.update({
        where: { id: msg.id },
        data: { status: OUTBOUND_STATUS.SENT, sentAt: new Date() },
      });
      details.push(`msg:${msg.id} -> sent (provider reconciled)`);
    } else {
      await prisma.outboundMessage.update({
        where: { id: msg.id },
        data: {
          status: OUTBOUND_STATUS.RECONCILIATION_REQUIRED,
          errorMessage: 'Ambiguous send, awaiting reconciliation: claimed but never confirmed',
        },
      });
      details.push(`msg:${msg.id} -> reconciliation_required (no provider id)`);
    }
    fixed++;
  }

  return { fixed, details };
}

async function repairStuckRunning(): Promise<{ fixed: number; details: string[] }> {
  const details: string[] = [];
  let fixed = 0;
  const cutoff = new Date(Date.now() - STUCK_RUNNING_THRESHOLD_MS);

  const stuck = await prisma.jobRun.findMany({
    where: { status: 'active', startedAt: { lt: cutoff } },
    select: { id: true },
  });

  for (const run of stuck) {
    await prisma.jobRun.update({
      where: { id: run.id },
      data: { status: 'failed', completedAt: new Date(), failedReason: 'Stuck — exceeded 15m threshold' },
    });
    fixed++;
    details.push(`jobRun:${run.id} -> failed (stuck)`);
  }

  return { fixed, details };
}

async function repairMissingDelayed(): Promise<{ fixed: number; details: string[] }> {
  const details: string[] = [];
  let fixed = 0;
  const now = new Date();

  const missing = await prisma.task.findMany({
    where: { status: 'pending', type: 'email', dueDate: { lt: now }, lockedAt: null },
    take: 100,
  });

  for (const task of missing) {
    // Compare-and-set the repair claim, so two sweeps cannot both re-enqueue the same task. The
    // execution lock in the sequence worker now requires `lockedAt: null`, which makes this claim
    // genuinely exclusive — and makes releasing it below mandatory.
    const claimed = await prisma.task.updateMany({
      where: { id: task.id, status: 'pending', lockedAt: null },
      data: { lockedAt: now },
    });
    if (claimed.count !== 1) continue;

    try {
      // The original job's dedupe key still resolves to this same payload, so a plain
      // enqueue would be swallowed and the repair would report success while restoring
      // nothing. The due date is the discriminator: repeated repair passes over the same
      // overdue task collapse to one job instead of stacking.
      await enqueueReschedule(
        JobType.SEQUENCE_EXECUTE_TASK,
        // A repair must carry the occurrence too. The task's deterministic id names the
        // enrollment it belongs to, so this is recovered rather than guessed; a pre-Phase-8a
        // task has none, and only then does the worker use legacy lead+sequence matching.
        {
          taskId: task.id,
          expectedEnrollmentId: enrollmentIdFromStepTaskId(task.id) ?? undefined,
        },
        {
          delay: 0,
          tenantId: task.tenantId,
          discriminator: `repair:${task.dueDate.toISOString()}`,
        }
      );
      details.push(`task:${task.id} -> re-enqueued BullMQ job (due ${task.dueDate.toISOString()})`);
      fixed++;
    } catch (err) {
      details.push(`task:${task.id} -> re-enqueue failed: ${err}`);
    } finally {
      // Always release. The repair claim exists only to serialise sweeps; leaving it set would
      // make the task invisible to the next sweep (this query filters `lockedAt: null`) *and*
      // unclaimable by the worker's execution lock — pending, unlocked by nobody, and unrunnable.
      await prisma.task.updateMany({
        where: { id: task.id, status: 'pending' },
        data: { lockedAt: null },
      });
    }
  }

  return { fixed, details };
}

async function repairEnrollmentScheduleDrift(): Promise<{ fixed: number; details: string[] }> {
  const details: string[] = [];
  let fixed = 0;
  const now = new Date();

  const driftEnrollments = await prisma.sequenceEnrollment.findMany({
    where: {
      status: 'active',
      nextActionAt: { lt: now },
    },
    include: {
      lead: { select: { id: true, assignedToId: true, crmPriorityScore: true } },
      sequence: { select: { id: true, name: true } },
    },
    take: 100,
  });

  for (const enr of driftEnrollments) {
    const expectedTaskId = enrollmentStepTaskId(enr.id, enr.currentStep);
    let existingTask = await prisma.task.findFirst({
      where: { id: expectedTaskId, status: 'pending' },
    });

    if (!existingTask) {
      const legacyTask = await prisma.task.findFirst({
        where: { leadId: enr.leadId, sequenceId: enr.sequenceId, sequenceStep: enr.currentStep, status: 'pending' },
      });
      if (legacyTask) {
        const legacyEnrollmentId = enrollmentIdFromStepTaskId(legacyTask.id);
        if (!legacyEnrollmentId || legacyEnrollmentId === enr.id) {
          existingTask = legacyTask;
        }
      }
    }

    if (!existingTask) {
      const step = await prisma.sequenceStep.findFirst({
        where: { sequenceId: enr.sequenceId, order: enr.currentStep },
      });
      if (step) {
        // The step is already overdue, so the replacement task must land now — not a
        // further delayDays out. createTaskForStep measures the cadence from the base it
        // is handed, so backdating the base by exactly that cadence yields a due date of
        // ~now, still subject to the send window and weekend policy.
        const cadenceMs = step.delayDays * 86_400_000 + step.delayHours * 3_600_000;
        const base = new Date(now.getTime() - cadenceMs);

        try {
          // The exact enrollment is in hand, so its identity must survive into the task id and
          // the execution payload. Creating an anonymous task here would hand the worker a
          // legacy-shaped job and reopen lead+sequence correlation for a Phase 8a cadence.
          await ensureOccurrenceStepTask({
            enrollment: enr,
            lead: enr.lead,
            sequence: enr.sequence,
            step,
            baseDate: base,
          });
          fixed++;
          details.push(`enrollment:${enr.id} -> recreated task for step ${enr.currentStep}`);
        } catch (err) {
          // Strict scheduling refused: the occurrence stopped owning the lead between the query
          // above and now. Fail closed — no executable job for a replaced cadence.
          details.push(`enrollment:${enr.id} -> repair refused: ${err}`);
        }
      }
    }
  }

  return { fixed, details };
}

/**
 * Re-drive claimable outbound messages that no longer have a job behind them — `pending` and
 * `failed` alike, since both mean the prospect has definitely not been written to.
 *
 * A message goes back to `pending` when a send is deferred (quota) and the worker
 * re-enqueues it. If that enqueue was lost — Redis flushed, the process died between the
 * status write and the enqueue — the row is claimable but nothing will ever claim it.
 * This is the database-side half of the invariant that BullMQ is never the only source of
 * truth. `sending` and `reconciliation_required` are deliberately excluded: their provider
 * outcome is unknown and re-driving them could double-send.
 */
async function repairStalePendingOutbound(): Promise<{ fixed: number; details: string[] }> {
  const details: string[] = [];
  let fixed = 0;
  const cutoff = new Date(Date.now() - STALE_PENDING_OUTBOUND_MS);

  // `failed` belongs here too. It means "definitely not delivered" and is in
  // `CLAIMABLE_STATUSES`, so re-driving one cannot double-send — but no sweep scanned it, and
  // on 2026-09-21 that left 228 messages refused by the provider with nothing in any queue to
  // try them again. A row already abandoned at the redrive cap is left alone, so this cannot
  // loop on messages a human has to decide about.
  const stalled = await prisma.outboundMessage.findMany({
    where: {
      OR: [
        { status: OUTBOUND_STATUS.PENDING },
        { status: OUTBOUND_STATUS.FAILED, attemptCount: { lt: MAX_OUTBOUND_REDRIVES } },
      ],
      createdAt: { lt: cutoff },
      sentAt: null,
    },
    take: RECONCILE_BATCH,
  });

  for (const msg of stalled) {
    if (msg.attemptCount >= MAX_OUTBOUND_REDRIVES) {
      await prisma.outboundMessage.update({
        where: { id: msg.id },
        data: {
          status: OUTBOUND_STATUS.FAILED,
          errorMessage: `Abandoned after ${msg.attemptCount} attempts without a successful send`,
        },
      });
      details.push(`outbound:${msg.id} -> failed after ${msg.attemptCount} attempts`);
      fixed++;
      continue;
    }

    try {
      await enqueueReschedule(
        JobType.EMAIL_SEND,
        {
          outboundMessageId: msg.id,
          accountId: msg.accountId,
          to: msg.to,
          subject: msg.subject ?? '',
          body: msg.body ?? '',
          leadId: msg.leadId,
          // Rebuilt from the row: a redrive has no payload from the sequence worker, and
          // without this the message would send while its step stayed open forever.
          sequenceStepRef: (await resolveStepRefForOutbound(msg)) ?? undefined,
        },
        {
          tenantId: msg.tenantId,
          delay: 0,
          discriminator: `redrive:${msg.attemptCount}`,
        }
      );
      details.push(`outbound:${msg.id} -> re-enqueued EMAIL_SEND`);
      fixed++;
    } catch (err) {
      details.push(`outbound:${msg.id} -> re-enqueue failed: ${err}`);
    }
  }

  return { fixed, details };
}

async function repairReassignmentDrift(): Promise<{ fixed: number; details: string[] }> {
  const details: string[] = [];
  let fixed = 0;

  const tasks = await prisma.task.findMany({
    where: { status: 'pending' },
    include: { lead: { select: { assignedToId: true } } },
  });

  for (const task of tasks) {
    if (task.lead && task.userId !== task.lead.assignedToId) {
      await prisma.task.update({
        where: { id: task.id },
        data: { userId: task.lead.assignedToId },
      });
      fixed++;
      details.push(`task:${task.id} userId ${task.userId} -> ${task.lead.assignedToId}`);
    }
  }

  return { fixed, details };
}

/**
 * Trim the audit trail.
 *
 * `auditExtension` writes a row for every create/update/delete on every model, so
 * this table grows without bound; the audit-log API's mandatory 30-day read window
 * is what has been keeping /admin/audit fast, which is a band-aid, not a bound.
 *
 * Two tiers, because the rows are not equally valuable: the extension's automatic
 * rows age out first, while the actor-stamped `admin.*` rows written by
 * `logAdminAudit` are the compliance-relevant trail and are kept far longer. Both
 * are env-overridable, and the admin floor is clamped to at least the extension
 * window so a misconfiguration cannot delete admin rows earlier than routine ones.
 *
 * Deletes in bounded batches rather than one unbounded statement — a first run
 * against a year of rows would otherwise lock the table. Hitting MAX_BATCHES is
 * normal on that first run and not an error: the job is idempotent, so the next
 * scheduled pass simply continues where this one stopped.
 */
const AUDIT_PRUNE_BATCH = 1_000;
const AUDIT_PRUNE_MAX_BATCHES = 20;
const DAY_MS = 86_400_000;

function retentionDays(envVar: string, fallback: number): number {
  const raw = process.env[envVar];
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function pruneAuditTier(
  label: string,
  where: { action?: { startsWith?: string; not?: { startsWith: string } }; createdAt: { lt: Date } }
): Promise<{ deleted: number; exhausted: boolean }> {
  let deleted = 0;

  for (let batch = 0; batch < AUDIT_PRUNE_MAX_BATCHES; batch++) {
    const rows = await prisma.auditLog.findMany({
      where,
      select: { id: true },
      take: AUDIT_PRUNE_BATCH,
    });
    if (rows.length === 0) return { deleted, exhausted: false };

    const res = await prisma.auditLog.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    deleted += res.count;

    if (rows.length < AUDIT_PRUNE_BATCH) return { deleted, exhausted: false };
  }

  console.warn(`[maintenance/audit-prune] ${label}: hit the batch cap, ${deleted} deleted — next run resumes`);
  return { deleted, exhausted: true };
}

async function repairAuditPrune(): Promise<{ fixed: number; details: string[] }> {
  const extensionDays = retentionDays('AUDIT_RETENTION_DAYS', 90);
  const adminDays = Math.max(retentionDays('ADMIN_AUDIT_RETENTION_DAYS', 365), extensionDays);
  const now = Date.now();

  const extension = await pruneAuditTier('extension', {
    action: { not: { startsWith: 'admin.' } },
    createdAt: { lt: new Date(now - extensionDays * DAY_MS) },
  });
  const admin = await pruneAuditTier('admin', {
    action: { startsWith: 'admin.' },
    createdAt: { lt: new Date(now - adminDays * DAY_MS) },
  });

  return {
    fixed: extension.deleted + admin.deleted,
    details: [
      `extension rows older than ${extensionDays}d -> ${extension.deleted} deleted${extension.exhausted ? ' (batch cap hit, resumes next run)' : ''}`,
      `admin.* rows older than ${adminDays}d -> ${admin.deleted} deleted${admin.exhausted ? ' (batch cap hit, resumes next run)' : ''}`,
    ],
  };
}

/**
 * Resolve messages whose provider outcome is unknown — without ever resending one.
 *
 * Two outcomes only:
 *
 *  - **Evidence of delivery.** A provider message id arrived after the fact (a late
 *    write, or the bounce/reply sync correlating one), or the message has since been
 *    marked replied or bounced. Settle as `sent`.
 *  - **No evidence past the grace window.** Give up and mark `permanently_failed`, then
 *    notify the lead's owner so a human decides whether to compose a fresh send. A new
 *    send gets a new idempotency key, so that decision can never collide with this row.
 *
 * Rows inside the grace window are left alone — evidence may still arrive from the next
 * inbox sync.
 *
 * Known limit: with no provider-side lookup by our own idempotency key, "no evidence"
 * cannot distinguish a message that silently delivered from one that never left. That is
 * why the fallback is a human decision rather than an automatic resend. Matching on a
 * custom message header would tighten this and needs adapter support on all three
 * providers.
 */
async function reconcileAmbiguousSends(): Promise<{ fixed: number; details: string[] }> {
  const details: string[] = [];
  let fixed = 0;
  const graceCutoff = new Date(Date.now() - RECONCILE_GRACE_MS);

  const ambiguous = await prisma.outboundMessage.findMany({
    where: { status: OUTBOUND_STATUS.RECONCILIATION_REQUIRED },
    select: {
      id: true,
      providerMessageId: true,
      repliedAt: true,
      bouncedAt: true,
      claimedAt: true,
      updatedAt: true,
      to: true,
      tenantId: true,
      leadId: true,
      sequenceId: true,
      sequenceStepOrder: true,
      abVariantId: true,
      lead: { select: { id: true, assignedToId: true } },
    },
    take: RECONCILE_BATCH,
  });

  for (const msg of ambiguous) {
    const delivered = Boolean(msg.providerMessageId || msg.repliedAt || msg.bouncedAt);
    if (delivered) {
      await prisma.outboundMessage.update({
        where: { id: msg.id },
        data: { status: OUTBOUND_STATUS.SENT, sentAt: new Date(), errorMessage: null },
      });
      // This is where an ambiguous send finally gets an answer, so this is where its cadence
      // step settles. `workers/email.ts` deliberately settles nothing while the outcome is
      // unknown — the prospect may or may not have the message — and without this the step
      // would stay open forever: the task never completes, the enrollment never advances, the
      // follow-up never fires, and nothing tells a human. Silent, and the same shape as the
      // 2026-09-21 incident arriving by a different road.
      const sentRef = await resolveStepRefForOutbound(msg);
      if (sentRef) await finalizeSequenceStep(sentRef);
      fixed++;
      details.push(`msg:${msg.id} -> sent (delivery evidence found)`);
      continue;
    }

    const ambiguousSince = msg.claimedAt ?? msg.updatedAt;
    if (ambiguousSince > graceCutoff) continue;

    await prisma.outboundMessage.update({
      where: { id: msg.id },
      data: {
        status: OUTBOUND_STATUS.PERMANENTLY_FAILED,
        errorMessage: 'Unresolved after reconciliation window — delivery unconfirmed, not resent',
      },
    });
    // Give the step back and stop the cadence. The message is not being retried, so the
    // follow-up must not go out behind it, and a paused enrollment carries a reason a human can
    // act on — which is the point of the notification below.
    const unresolvedRef = await resolveStepRefForOutbound(msg);
    if (unresolvedRef) {
      await releaseSequenceStep(unresolvedRef, 'delivery never confirmed within the grace window');
    }
    if (msg.lead?.assignedToId) {
      await prisma.notification.create({
        data: {
          userId: msg.lead.assignedToId,
          type: 'email_unconfirmed',
          title: 'Email delivery unconfirmed',
          text: `We could not confirm whether the email to ${msg.to} was delivered, so it was not retried. Check the inbox's sent mail before sending again.`,
          linkTo: `/leads/${msg.lead.id}`,
          tenantId: msg.tenantId,
        },
      });
    }
    fixed++;
    details.push(`msg:${msg.id} -> permanently_failed (unresolved, not resent)`);
  }

  return { fixed, details };
}

/**
 * Return daily send capacity that was reserved but never spent.
 *
 * `EmailAccount.dailySendCount` is a reservation taken before the provider call, so that two
 * workers cannot both claim the last slot. Every path that abandons an attempt after that point
 * owes the slot back. `workers/email.ts` now returns it on a `not_sent` failure, but a throw
 * between the reservation and the provider call — a template that fails to render, a worker that
 * dies — leaves the row `sending` with no way for anyone to tell whether it sent, and the slot
 * with it.
 *
 * So this converges the counter on evidence instead of trusting the bookkeeping: what the mailbox
 * actually spent today is the messages it sent, plus those still in flight or awaiting
 * reconciliation, which may yet turn out to have been delivered.
 *
 * It only ever lowers the counter. Raising it here would create a second writer racing the
 * reservation, and the failure this exists to repair is inflation: a mailbox that stops early.
 * A counter below the truth is corrected by the next send's own increment.
 */
async function repairQuotaDrift(): Promise<{ fixed: number; details: string[] }> {
  const details: string[] = [];
  let fixed = 0;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const accounts = await prisma.emailAccount.findMany({
    where: { dailySendDate: today, dailySendCount: { gt: 0 } },
    select: { id: true, email: true, tenantId: true, dailySendCount: true },
  });

  for (const account of accounts) {
    const [sent, inFlight] = await Promise.all([
      prisma.outboundMessage.count({
        where: { accountId: account.id, status: OUTBOUND_STATUS.SENT, sentAt: { gte: today } },
      }),
      prisma.outboundMessage.count({
        where: {
          accountId: account.id,
          status: { in: [OUTBOUND_STATUS.SENDING, OUTBOUND_STATUS.RECONCILIATION_REQUIRED] },
          claimedAt: { gte: today },
        },
      }),
    ]);

    const spent = sent + inFlight;
    if (account.dailySendCount <= spent) continue;

    await prisma.emailAccount.update({
      where: { id: account.id },
      data: { dailySendCount: spent },
    });
    details.push(
      `account:${account.email} dailySendCount ${account.dailySendCount} -> ${spent} ` +
        `(${sent} sent, ${inFlight} in flight) — ${account.dailySendCount - spent} slots returned`
    );
    fixed++;
  }

  return { fixed, details };
}

const REPAIR_FN: Record<string, () => Promise<{ fixed: number; details: string[] }>> = {
  'orphan-tasks': repairOrphanTasks,
  'quota-drift': repairQuotaDrift,
  'stale-sending': repairStaleSending,
  'outbound-reconcile': reconcileAmbiguousSends,
  'stuck-running': repairStuckRunning,
  'missing-delayed': repairMissingDelayed,
  'reassignment-drift': repairReassignmentDrift,
  'enrollment-schedule-drift': repairEnrollmentScheduleDrift,
  'stale-pending-outbound': repairStalePendingOutbound,
  'audit-prune': repairAuditPrune,
};

async function handleRepair(payload: MaintenanceRepairPayload) {
  const results: Record<string, { fixed: number; details: string[] }> = {};
  for (const t of payload.types) {
    const fn = REPAIR_FN[t];
    if (fn) {
      results[t] = await fn();
    }
  }
  return results;
}

/**
 * The single consumer of the `maintenance` queue.
 *
 * It must stay the only one. A second Worker on this queue competes for jobs, and because each
 * such worker `return`ed on the job names it did not recognise — and an early return is a
 * *successful* completion — jobs meant for one consumer were silently marked done by the other.
 * `maintenance.repair` was the expensive casualty: it carries the sweeper that moves stuck
 * outbound rows along and raises the only notification a human ever sees for a stalled send, and
 * it was being discarded roughly half the time. See workers/healthcheck.ts.
 *
 * Concurrency stays 1, so a long repair sweep delays the next healthcheck rather than overlapping
 * another repair. That ordering is deliberate: the repair functions sweep shared rows and were
 * never written to run beside themselves, whereas a healthcheck is a ping and a `SELECT 1` whose
 * only cost of being late is a late log line.
 */
export function createMaintenanceWorker() {
  return createAppWorker(
    'maintenance',
    async (job) => {
      if (job.name === JobType.MAINTENANCE_HEALTHCHECK) return runHealthcheck(job);
      if (job.name === JobType.MAINTENANCE_REPAIR) {
        return handleRepair(job.data as MaintenanceRepairPayload);
      }
      // Not silence: an unrecognised name means something enqueues work nothing performs, and
      // that is exactly the class of bug this worker was just repaired for. Returning (rather
      // than throwing) avoids an unbounded retry loop for a job type no deploy will ever handle.
      console.warn(`[worker:maintenance] no handler for job name '${job.name}' — nothing was done`);
      return;
    },
    { concurrency: 1 }
  );
}

export { handleRepair };
