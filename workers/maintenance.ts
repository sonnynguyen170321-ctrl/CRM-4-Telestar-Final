import { prisma } from '@/lib/prisma';
import { createAppWorker } from '@/lib/bullmq';
import { JobType } from '@/lib/bullmq/types';
import { enrollmentIdFromStepTaskId, enrollmentStepTaskId } from '@/lib/sequences/identity';
import type { MaintenanceRepairPayload } from '@/lib/bullmq/types';
import { OUTBOUND_STATUS } from '@/lib/email/idempotency';
import { enqueueReschedule } from '@/lib/bullmq/enqueue';
import { ensureOccurrenceStepTask } from '@/lib/sequences/occurrenceTask';

const STALE_SENDING_THRESHOLD_MS = 30 * 60 * 1000;
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
 * Re-drive claimable outbound messages that no longer have a job behind them.
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

  const stalled = await prisma.outboundMessage.findMany({
    where: {
      status: OUTBOUND_STATUS.PENDING,
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

const REPAIR_FN: Record<string, () => Promise<{ fixed: number; details: string[] }>> = {
  'orphan-tasks': repairOrphanTasks,
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

export function createMaintenanceWorker() {
  return createAppWorker(
    'maintenance',
    async (job) => {
      if (job.name === JobType.MAINTENANCE_HEALTHCHECK) return;
      if (job.name !== JobType.MAINTENANCE_REPAIR) return;
      return handleRepair(job.data as MaintenanceRepairPayload);
    },
    { concurrency: 1 }
  );
}

export { handleRepair };
