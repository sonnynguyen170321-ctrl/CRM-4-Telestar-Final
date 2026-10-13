/**
 * What a sequence email task is doing, in words a rep can act on.
 *
 * An email step with a template sends itself (`SequenceStep.autoComplete`). Its task is a record of
 * that, not an errand: there is nothing for the rep to complete. The list used to show it as a
 * plain task with Complete and Skip, and Complete advanced the cadence without a send when the job
 * had not run yet. This derives the live state from rows that already exist - task, enrollment,
 * the step's latest outbound message - so the list can say what is happening instead.
 *
 * Read only. Nothing here changes a row.
 */
import { prisma } from '@/lib/prisma';
import { buildIdempotencyKey } from '@/lib/email/idempotency';
import { describeHold } from '@/lib/sequences/holdReasons';
import { PAUSED_REASON_LABELS, normalizePausedReason } from '@/lib/automation/types';
import { describeReasonCode, failureCodeFor, parseReasonCode } from '@/lib/sequences/blockPolicy';

export type AutoSendState =
  /** Due later; the CRM sends it by itself. */
  | 'scheduled'
  /** Handed to the mail worker; waiting for the provider's answer. */
  | 'sending'
  /** Waiting on something (window, cap, mailbox, paused cadence). */
  | 'held'
  /** The provider refused it, or it was barred; the cadence is stopped. */
  | 'failed'
  /** The provider's answer is unknown; delivery is being checked. */
  | 'checking'
  /** Confirmed sent (or the rep said they sent it outside the CRM). */
  | 'sent'
  /** Skipped by a person or by a pause, with nothing wrong. */
  | 'skipped';

export interface EmailStepInfo {
  /** True when the CRM sends this step itself: an email step with a template and auto-send on. */
  automatic: boolean;
  sequenceName: string | null;
  stepOrder: number;
  /** The step's template, so a manual task can open the composer prefilled. */
  templateId: string | null;
  /** Null for a manual step. */
  state: AutoSendState | null;
  /** Short, plain text. The UI appends the time for `scheduled`. */
  label: string;
  /** Why it is held or failed. */
  reason: string | null;
  /** When the CRM will try to send, while it is scheduled. */
  scheduledAt: string | null;
}

export interface StateInput {
  task: {
    status: string;
    dueDate: Date;
    lockedAt: Date | null;
    outcome: string | null;
    notes: string | null;
  };
  step: { autoComplete: boolean; templateId: string | null } | null;
  sequenceName: string | null;
  stepOrder: number;
  enrollment: { status: string; pausedReason: string | null; holdReason: string | null } | null;
  /** The latest outbound message of this step, if any. */
  outbound: { status: string; errorMessage: string | null } | null;
}

export const SEND_FAILED_OUTCOME = 'send_failed';
export const SEND_BLOCKED_OUTCOME = 'send_blocked';
export const SENT_OUTSIDE_OUTCOME = 'sent_outside_crm';

/** The CRM sends this step itself: an email step that has a template and auto-send switched on. */
export function isAutomaticStep(step: { autoComplete: boolean; templateId: string | null } | null): boolean {
  return Boolean(step && step.autoComplete && step.templateId);
}

export function deriveEmailStepInfo(input: StateInput): EmailStepInfo {
  const { task, step, enrollment, outbound } = input;
  const automatic = isAutomaticStep(step);
  const base = {
    automatic,
    sequenceName: input.sequenceName,
    stepOrder: input.stepOrder,
    templateId: step?.templateId ?? null,
    reason: null as string | null,
    scheduledAt: null as string | null,
  };

  if (!automatic) return { ...base, state: null, label: 'Manual email' };

  if (task.status === 'completed') {
    return {
      ...base,
      state: 'sent',
      label: task.outcome === SENT_OUTSIDE_OUTCOME ? 'Sent outside the CRM ✓' : 'Sent ✓',
    };
  }

  if (task.status === 'skipped') {
    if (task.outcome === SEND_FAILED_OUTCOME || task.outcome === SEND_BLOCKED_OUTCOME) {
      // Only a stored code is worded, never free text: notes on older rows may hold provider text.
      const code = parseReasonCode(task.notes);
      const reason = code ? describeReasonCode(code, (r) => describeHold(r)?.label ?? null) : 'The email could not be sent';
      // A refusal is a failure; a bar (the lead replied, the address is suppressed) is the CRM
      // choosing not to send, and calling that a failure sends the rep looking for a fault.
      const verb = task.outcome === SEND_BLOCKED_OUTCOME ? 'Not sent' : 'Failed';
      return { ...base, state: 'failed', reason, label: `${verb}: ${reason}` };
    }
    return { ...base, state: 'skipped', label: 'Skipped' };
  }

  // Pending from here.
  if (outbound?.status === 'reconciliation_required') {
    return { ...base, state: 'checking', label: 'Checking delivery' };
  }

  if (enrollment?.status === 'paused') {
    if (enrollment.pausedReason === 'send_failed') {
      // The provider's text is mapped to our own wording and goes no further.
      const reason = outbound?.errorMessage?.trim()
        ? describeReasonCode(failureCodeFor(outbound.errorMessage), () => null)
        : PAUSED_REASON_LABELS.send_failed;
      return { ...base, state: 'failed', reason, label: `Failed: ${reason}` };
    }
    const reason = PAUSED_REASON_LABELS[normalizePausedReason(enrollment.pausedReason ?? 'manual')];
    return { ...base, state: 'held', reason, label: `Held: cadence paused (${reason})` };
  }

  if (!enrollment) {
    const reason = 'the lead is no longer in an active cadence';
    return { ...base, state: 'held', reason, label: `Held: ${reason}` };
  }

  const hold = describeHold(enrollment.holdReason);
  if (hold) return { ...base, state: 'held', reason: hold.label, label: `Held: ${hold.label}` };

  if (task.lockedAt) return { ...base, state: 'sending', label: 'Sending now' };

  return {
    ...base,
    state: 'scheduled',
    label: 'Sending automatically',
    scheduledAt: task.dueDate.toISOString(),
  };
}

interface TaskRow {
  id: string;
  leadId: string;
  type: string;
  status: string;
  dueDate: Date;
  lockedAt: Date | null;
  outcome: string | null;
  notes: string | null;
  sequenceId: string | null;
  sequenceStep: number | null;
}

/**
 * Add `emailStep` to every sequence email task in a list, with a handful of batched reads
 * (never one per task). Tasks that are not sequence emails get `emailStep: null`. Tenant scope
 * comes from the Prisma client, the same as the task query that produced the rows.
 */
export async function attachEmailStepInfo<T extends TaskRow>(
  tasks: T[]
): Promise<Array<T & { emailStep: EmailStepInfo | null }>> {
  const relevant = tasks.filter((t) => t.type === 'email' && t.sequenceId && t.sequenceStep !== null);
  if (relevant.length === 0) return tasks.map((t) => ({ ...t, emailStep: null }));

  const sequenceIds = [...new Set(relevant.map((t) => t.sequenceId as string))];
  const leadIds = [...new Set(relevant.map((t) => t.leadId))];

  const [sequences, steps, enrollments, outbound] = await Promise.all([
    prisma.sequence.findMany({ where: { id: { in: sequenceIds } }, select: { id: true, name: true } }),
    prisma.sequenceStep.findMany({
      where: { sequenceId: { in: sequenceIds } },
      select: { sequenceId: true, order: true, autoComplete: true, templateId: true },
    }),
    prisma.sequenceEnrollment.findMany({
      where: { leadId: { in: leadIds }, sequenceId: { in: sequenceIds }, status: { in: ['active', 'paused'] } },
      orderBy: { startedAt: 'desc' },
      select: { leadId: true, sequenceId: true, status: true, pausedReason: true, holdReason: true },
    }),
    // Exactly each task's own message: every send for a task is keyed on the task id, so this is
    // one row per task at most rather than the lead's whole send history.
    prisma.outboundMessage.findMany({
      where: { idempotencyKey: { in: relevant.map((t) => buildIdempotencyKey({ kind: 'task', taskId: t.id })) } },
      select: { idempotencyKey: true, status: true, errorMessage: true },
    }),
  ]);

  const nameById = new Map(sequences.map((s) => [s.id, s.name]));
  const stepByKey = new Map(steps.map((s) => [`${s.sequenceId}:${s.order}`, s]));
  // Newest first, so the first one seen per key is the occupying one.
  const enrollmentByKey = new Map<string, (typeof enrollments)[number]>();
  for (const e of enrollments) {
    const key = `${e.leadId}:${e.sequenceId}`;
    if (!enrollmentByKey.has(key)) enrollmentByKey.set(key, e);
  }
  const outboundByKey = new Map(outbound.map((m) => [m.idempotencyKey, m]));

  return tasks.map((t) => {
    if (!(t.type === 'email' && t.sequenceId && t.sequenceStep !== null)) return { ...t, emailStep: null };
    const emailStep = deriveEmailStepInfo({
      task: t,
      step: stepByKey.get(`${t.sequenceId}:${t.sequenceStep}`) ?? null,
      sequenceName: nameById.get(t.sequenceId) ?? null,
      stepOrder: t.sequenceStep,
      enrollment: enrollmentByKey.get(`${t.leadId}:${t.sequenceId}`) ?? null,
      outbound: outboundByKey.get(buildIdempotencyKey({ kind: 'task', taskId: t.id })) ?? null,
    });
    return { ...t, emailStep };
  });
}
