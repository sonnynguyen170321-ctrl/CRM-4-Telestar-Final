import { prisma } from '@/lib/prisma';
import { createAppWorker } from '@/lib/bullmq';
import { JobType } from '@/lib/bullmq/types';
import type { MaintenanceRepairPayload } from '@/lib/bullmq/types';

const STALE_SENDING_THRESHOLD_MS = 30 * 60 * 1000;
const STUCK_RUNNING_THRESHOLD_MS = 15 * 60 * 1000;

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

async function repairStaleSending(): Promise<{ fixed: number; details: string[] }> {
  const details: string[] = [];
  let fixed = 0;
  const cutoff = new Date(Date.now() - STALE_SENDING_THRESHOLD_MS);

  const stale = await prisma.outboundMessage.findMany({
    where: { status: 'sending', updatedAt: { lt: cutoff } },
    select: { id: true, providerMessageId: true },
  });

  for (const msg of stale) {
    if (msg.providerMessageId) {
      await prisma.outboundMessage.update({
        where: { id: msg.id },
        data: { status: 'sent', sentAt: new Date() },
      });
      details.push(`msg:${msg.id} -> sent (provider reconciled)`);
    } else {
      await prisma.outboundMessage.update({
        where: { id: msg.id },
        data: { status: 'failed', errorMessage: 'Stale sending state — no provider confirmation' },
      });
      details.push(`msg:${msg.id} -> failed (no provider id)`);
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
    await prisma.task.update({
      where: { id: task.id },
      data: { lockedAt: now },
    });
    details.push(`task:${task.id} -> locked for re-enqueue (due ${task.dueDate.toISOString()})`);
    fixed++;
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

const REPAIR_FN: Record<string, () => Promise<{ fixed: number; details: string[] }>> = {
  'orphan-tasks': repairOrphanTasks,
  'stale-sending': repairStaleSending,
  'stuck-running': repairStuckRunning,
  'missing-delayed': repairMissingDelayed,
  'reassignment-drift': repairReassignmentDrift,
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
