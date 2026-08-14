import { prisma as defaultPrisma } from '@/lib/prisma';
import { resolveOccurrenceTask } from './occurrenceTask';

/**
 * The application's client, not a bare `PrismaClient`.
 *
 * `lib/prisma.ts` returns an `$extends`-wrapped client whose model methods have narrower result
 * types, so it is not assignable to `PrismaClient` — the script that passes it in did not compile.
 * Typing the option as "whatever `lib/prisma` exports" keeps the seam injectable for tests while
 * making the only real caller type-check, and it means a repair can never quietly run on a client
 * that skips the tenant extension.
 */
type AppPrismaClient = typeof defaultPrisma;

export interface BackfillOptions {
  dryRun?: boolean;
  tenantId?: string;
  client?: AppPrismaClient;
}

export interface UnmatchedEnrollment {
  id: string;
  leadId: string;
  sequenceId: string;
  currentStep: number;
  status: string;
  tenantId: string;
  reason: string;
}

export interface BackfillResult {
  dryRun: boolean;
  totalEvaluated: number;
  alreadyPopulated: number;
  terminalSkipped: number;
  repaired: number;
  unmatched: UnmatchedEnrollment[];
}

/**
 * Historical repair for SequenceEnrollment rows missing nextActionAt.
 *
 * Rules:
 *  1. Authoritative timestamp from pending Task.dueDate only — NEVER invent a date.
 *  2. If no authoritative task exists, report the row in `unmatched` rather than guessing.
 *  3. Already populated rows (nextActionAt != null) remain untouched.
 *  4. Terminal status rows (completed, cancelled, etc.) are skipped and never scheduled.
 *  5. Fully idempotent — safe to run multiple times.
 *  6. Tenant boundaries strictly enforced when tenantId is provided.
 */
export async function backfillHistoricalNextActionAt(
  options: BackfillOptions = {}
): Promise<BackfillResult> {
  const db = options.client ?? defaultPrisma;
  const isDryRun = options.dryRun ?? false;

  const whereClause: Record<string, unknown> = {};
  if (options.tenantId) {
    whereClause.tenantId = options.tenantId;
  }

  // Fetch all enrollments matching filter
  const enrollments = await db.sequenceEnrollment.findMany({
    where: whereClause,
    select: {
      id: true,
      leadId: true,
      sequenceId: true,
      currentStep: true,
      status: true,
      nextActionAt: true,
      tenantId: true,
    },
    orderBy: { startedAt: 'asc' },
  });

  const result: BackfillResult = {
    dryRun: isDryRun,
    totalEvaluated: enrollments.length,
    alreadyPopulated: 0,
    terminalSkipped: 0,
    repaired: 0,
    unmatched: [],
  };

  const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'bounced', 'failed']);

  for (const enrollment of enrollments) {
    // 1. Skip terminal states
    if (TERMINAL_STATUSES.has(enrollment.status)) {
      result.terminalSkipped++;
      continue;
    }

    // 2. Skip already populated rows
    if (enrollment.nextActionAt !== null) {
      result.alreadyPopulated++;
      continue;
    }

    // 3. Resolve authoritative pending task
    const occurrence = await resolveOccurrenceTask(enrollment);
    if (!occurrence || !occurrence.task || occurrence.task.status !== 'pending') {
      result.unmatched.push({
        id: enrollment.id,
        leadId: enrollment.leadId,
        sequenceId: enrollment.sequenceId,
        currentStep: enrollment.currentStep,
        status: enrollment.status,
        tenantId: enrollment.tenantId,
        reason: 'No pending authoritative task found for enrollment occurrence',
      });
      continue;
    }

    const authoritativeDueDate = occurrence.task.dueDate;
    if (!authoritativeDueDate || isNaN(authoritativeDueDate.getTime())) {
      result.unmatched.push({
        id: enrollment.id,
        leadId: enrollment.leadId,
        sequenceId: enrollment.sequenceId,
        currentStep: enrollment.currentStep,
        status: enrollment.status,
        tenantId: enrollment.tenantId,
        reason: 'Pending task has invalid dueDate',
      });
      continue;
    }

    // 4. Update row if not dry run
    if (!isDryRun) {
      await db.sequenceEnrollment.update({
        where: { id: enrollment.id },
        data: {
          nextActionAt: authoritativeDueDate,
        },
      });
    }

    result.repaired++;
  }

  return result;
}
