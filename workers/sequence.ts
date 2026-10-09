import { prisma } from '@/lib/prisma';
import { occupancyKeyFor, releaseOccupancy } from '@/lib/sequences/occupancy';
import { createAppWorker } from '@/lib/bullmq';
import { JobType } from '@/lib/bullmq/types';
import type {
  SequenceEnrollPayload,
  SequenceAdvancePayload,
  SequencePausePayload,
  SequenceUnenrollPayload,
  SequenceRebuildPayload,
  SequenceExecuteTaskPayload,
} from '@/lib/bullmq/types';
import {
  createTaskForStep,
  advanceSequence,
  unenrollLead,
} from '@/lib/sequences/engine';
import { pauseEnrollmentOccurrence } from '@/lib/sequences/lifecycle';
import { blockIfBounced, findSuppression } from '@/lib/email/suppress';
import { sendsImmediatelyOnEnroll } from '@/lib/sequences/rules';
import { resolveSendingMailbox, sequenceSenderGap } from '@/lib/sequences/sender';
import { enrollmentStepTaskId } from '@/lib/sequences/identity';
import { renderTemplate } from '@/lib/templates/render';
import { createOutboundMessage, enqueueEmailSendWorkflow } from '@/lib/workflows/email';
import { evaluateAutomationEligibility } from '@/lib/automation/eligibility';
import { getApprovedStepCopy } from '@/lib/sequences/stepCopy';
import { deterministicOffset, buildJitterSeed } from '@/lib/automation/jitter';
import { enqueueReschedule } from '@/lib/bullmq/enqueue';
import { planStepThread } from '@/lib/sequences/threading';
import { runNowRequested } from '@/lib/sequences/runNow';

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Record why the current step did not send (or clear it), for the enrollments table.
 *
 * Until this existed the reason lived in a job result nobody could see: a step held by a full
 * mailbox, a missing template or a paused campaign all looked the same — overdue. This is
 * visibility only, so a failed write must never fail a send or re-run one.
 */
/** Holds rechecked hourly until someone acts; see the deferral audit below. */
const SENDER_GAP_HOLDS = new Set(['no_sequence_sender', 'sequence_senders_disconnected']);

/** The task is due the moment it was created: how an enrollment-time immediate step is scheduled. */
const ENROLLMENT_SCHEDULE_TOLERANCE_MS = 60_000;
function scheduledAtEnrollment(createdAt: Date, dueDate: Date | null): boolean {
  return Boolean(dueDate) && Math.abs(dueDate!.getTime() - createdAt.getTime()) <= ENROLLMENT_SCHEDULE_TOLERANCE_MS;
}

async function recordHold(enrollmentId: string | null | undefined, reason: string | null): Promise<void> {
  if (!enrollmentId) return;
  try {
    await prisma.sequenceEnrollment.updateMany({
      where: { id: enrollmentId },
      data: { holdReason: reason },
    });
  } catch (err) {
    console.warn(`[worker:sequence] could not record the hold reason for enrollment ${enrollmentId}:`, err);
  }
}

// Exported for testing
export async function handleEnroll(payload: SequenceEnrollPayload) {
  const { leadId, sequenceId, userId } = payload;

  const [lead, sequence] = await Promise.all([
    prisma.lead.findUnique({ where: { id: leadId } }),
    prisma.sequence.findUnique({
      where: { id: sequenceId },
      include: { steps: { orderBy: { order: 'asc' } } },
    }),
  ]);

  if (!lead || !sequence || !sequence.isActive || sequence.steps.length === 0) {
    throw new Error(
      `Cannot enroll: lead=${!!lead} sequence=${!!sequence} ` +
      `active=${sequence?.isActive} steps=${sequence?.steps.length}`
    );
  }

  // Unenroll from previous sequence if switching
  if (lead.sequenceId && lead.sequenceId !== sequenceId) {
    const prevSeq = await prisma.sequence.findUnique({
      where: { id: lead.sequenceId },
      select: { name: true },
    });
    await unenrollLead(leadId, lead.sequenceId);
    await prisma.activity.create({
      data: {
        userId, leadId,
        type: 'sequence_unenrolled',
        description: `Unenrolled from ${prevSeq?.name ?? lead.sequenceId} (switched to ${sequence.name})`,
        metadata: { sequenceId: lead.sequenceId },
      },
    });
  }

  // Close any prior active enrollments
  await prisma.sequenceEnrollment.updateMany({
    where: { leadId, status: 'active' },
    data: { status: 'unenrolled', completedAt: new Date(), ...releaseOccupancy() },
  });

  // Create new enrollment
  const enrollment = await prisma.sequenceEnrollment.create({
    data: {
      leadId, sequenceId,
      status: 'active', currentStep: 1,
      occupancyKey: occupancyKeyFor(lead.tenantId, leadId, sequenceId),
      tenantId: lead.tenantId,
    },
  });

  // Re-fetch lead for fresh assignedToId/crmPriorityScore
  const freshLead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { assignedToId: true, crmPriorityScore: true },
  });

  // Create first step task BEFORE updating lead (so task failure doesn't leave lead in "enrolled with no task" state)
  await createTaskForStep(
    { id: leadId, assignedToId: freshLead?.assignedToId ?? lead.assignedToId, crmPriorityScore: freshLead?.crmPriorityScore ?? lead.crmPriorityScore },
    sequence,
    sequence.steps[0],
    new Date(),
    // This handler *created* the enrollment, so the occurrence is known here — discarding it
    // would hand the executor an anonymous task and a legacy-shaped job for a brand new cadence.
    {
      taskId: enrollmentStepTaskId(enrollment.id, sequence.steps[0].order),
      expectedEnrollmentId: enrollment.id,
    }
  );

  // Update lead
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      sequenceId, sequenceStep: 1, sequenceStatus: 'active',
      ...(lead.stage === 'new' ? { stage: 'sequence_active' } : {}),
    },
  });

  // Log enroll activity
  await prisma.activity.create({
    data: {
      userId, leadId,
      type: 'sequence_enrolled',
      description: `Enrolled in ${sequence.name}`,
      metadata: { sequenceId, sequenceName: sequence.name },
    },
  });

  return { success: true, leadId, sequenceId };
}

export async function handleAdvance(payload: SequenceAdvancePayload) {
  const { leadId, sequenceId, currentStep } = payload;

  const enrollment = await prisma.sequenceEnrollment.findFirst({
    where: { leadId, sequenceId, status: 'active' },
  });
  if (!enrollment) {
    return { skipped: true, reason: 'no_active_enrollment' };
  }

  // CAS: skip if lead already advanced past this step
  const leadCheck = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { sequenceStep: true },
  });
  if (leadCheck && leadCheck.sequenceStep !== null && leadCheck.sequenceStep > currentStep) {
    return { skipped: true, reason: 'stale_step' };
  }

  // Delegate to engine for lead advancement and task creation
  await advanceSequence(
    { leadId, sequenceId, sequenceStep: currentStep },
    SYSTEM_USER_ID
  );

  // Sync enrollment state after engine execution
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { sequenceId: true, sequenceStep: true },
  });

  if (!lead?.sequenceId) {
    // Engine completed the sequence (cleared lead fields)
    await prisma.sequenceEnrollment.update({
      where: { id: enrollment.id },
      data: { status: 'completed', currentStep, completedAt: new Date(), ...releaseOccupancy() },
    });
    return { status: 'completed', leadId, sequenceId };
  }

  await prisma.sequenceEnrollment.update({
    where: { id: enrollment.id },
    data: { currentStep: lead.sequenceStep ?? currentStep },
  });

  return { status: 'active', currentStep: lead.sequenceStep, leadId, sequenceId };
}

export async function handlePause(payload: SequencePausePayload) {
  const { leadId, reason, userId, enrollmentId, sequenceId } = payload;

  // Fail closed on a legacy payload. Pausing "whichever cadence is current" is exactly the
  // behaviour this phase removed: by the time an old job runs, the enrollment it was queued for
  // may have been replaced, and the replacement is somebody else's live cadence.
  if (!enrollmentId || !sequenceId) {
    return { skipped: true, reason: 'legacy_pause_payload_not_occurrence_scoped' };
  }

  const paused = await pauseEnrollmentOccurrence({
    enrollmentId,
    leadId,
    sequenceId,
    reason,
    actorUserId: userId,
  });
  if (!paused.ok) {
    return { skipped: true, reason: paused.refusal ?? 'pause_refused' };
  }
  const enrollment = { id: enrollmentId, sequenceId };

  return { success: true, leadId, sequenceId: enrollment.sequenceId, reason };
}

export async function handleUnenroll(payload: SequenceUnenrollPayload) {
  const { leadId, sequenceId } = payload;

  await prisma.sequenceEnrollment.updateMany({
    where: { leadId, sequenceId, status: { in: ['active', 'paused'] } },
    data: { status: 'unenrolled', completedAt: new Date(), ...releaseOccupancy() },
  });

  await unenrollLead(leadId, sequenceId);

  return { success: true, leadId, sequenceId };
}

export async function handleRebuild(payload: SequenceRebuildPayload) {
  const { sequenceId } = payload;

  // Validate the sequence still exists before any rebuild work re-enqueues its jobs.
  const sequence = await prisma.sequence.findUnique({
    where: { id: sequenceId },
    select: { id: true },
  });
  if (!sequence) {
    throw new Error(`Sequence not found: ${sequenceId}`);
  }

  return { success: true, sequenceId };
}

/**
 * Delayed execution of an automated sequence email task at its due date.
 * Ported from the former Inngest `executeScheduledTask`. The worker already runs inside
 * the job's tenant context (wrapProcessor resolves it from the JobRun), so this reads/
 * writes scoped to the right tenant without any manual tenantStorage juggling.
 */
export async function handleExecuteTask(payload: SequenceExecuteTaskPayload) {
  const { taskId, expectedEnrollmentId } = payload;

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      lead: {
        include: {
          assignedTo: { select: { id: true, firstName: true, lastName: true, role: true, isActive: true, timezone: true } },
          campaign: { select: { id: true, status: true } },
          sequence: { select: { id: true, isActive: true, isArchived: true } },
        },
      },
    },
  });

  if (!task) return { status: 'ignored', reason: 'task_not_found' };
  if (task.status !== 'pending') return { status: 'ignored', reason: `task_status_is_${task.status}` };

  const isAutoEmail = task.type === 'email' && task.sequenceId !== null;
  if (!isAutoEmail) return { status: 'manual_action_required', type: task.type };

  // Fetch step info and template
  const stepInfo = await prisma.sequenceStep.findFirst({
    where: { sequenceId: task.sequenceId!, order: task.sequenceStep ?? -1 },
    include: { template: { include: { abVariants: true } } },
  });

  // Fetch enrollment. With an occurrence id the job names *which* enrollment it belongs to, and
  // no other one may answer for it — correlation on lead+sequence would let this task run under
  // whatever cadence happens to be active now.
  const enrollment = expectedEnrollmentId
    ? await prisma.sequenceEnrollment.findUnique({ where: { id: expectedEnrollmentId } })
    : await prisma.sequenceEnrollment.findFirst({
        where: { leadId: task.leadId, sequenceId: task.sequenceId!, status: 'active' },
      });

  if (expectedEnrollmentId) {
    const owns =
      enrollment &&
      enrollment.id === expectedEnrollmentId &&
      enrollment.leadId === task.leadId &&
      enrollment.sequenceId === task.sequenceId &&
      enrollment.status === 'active' &&
      enrollment.occupancyKey === occupancyKeyFor(task.tenantId, task.leadId, task.sequenceId ?? '');
    if (!owns) {
      return { status: 'skipped', reason: 'occurrence_no_longer_active', taskId: task.id };
    }
  }

  // Which mailbox sends: the one this occurrence already uses, else one of the sequence's senders —
  // never the rep's own (lib/sequences/sender.ts). With none, `senderGap` says why and the step waits.
  const account = await resolveSendingMailbox({
    tenantId: task.tenantId,
    enrollmentId: expectedEnrollmentId ?? null,
    sequenceId: task.sequenceId,
    ownerUserId: task.lead.assignedToId,
  });
  const senderGap = !account && task.sequenceId ? await sequenceSenderGap(task.tenantId, task.sequenceId) : null;

  // Check suppression — and, behind it, any earlier bounce for this address that never became a
  // suppression (lib/email/suppress.ts blockIfBounced suppresses it and stops the cadence now).
  const suppressed =
    (await findSuppression({ tenantId: task.tenantId, email: task.lead.email, campaignId: task.lead.campaignId })) ??
    (await blockIfBounced({ tenantId: task.tenantId, email: task.lead.email, leadId: task.lead.id, actorUserId: task.lead.assignedToId }));

  // The sequence this task belongs to — not `lead.sequence`, which is only the lead's pointer to
  // its most recent cadence. With several sequences running, the pointer can name a different,
  // active sequence while this task's own sequence was archived or paused (or the reverse).
  const taskSequence = await prisma.sequence.findUnique({
    where: { id: task.sequenceId! },
    select: { id: true, isActive: true, isArchived: true, sendOnWeekends: true, sendFirstStepImmediately: true },
  });

  // Someone pressed Run now on this step a moment ago: the schedule is what they are overriding.
  const runNow = runNowRequested(task.runNowRequestedAt);
  // The sequence sends step 1 the moment a lead is enrolled (lib/sequences/rules.ts). Without this
  // the job scheduled for "now" would be deferred here to the next window anyway. Only while the
  // task is still due when it was created, i.e. scheduled at enrollment: a resume or a cap
  // deferral moves the due date, and from then on the send window applies again.
  const immediateStep =
    sendsImmediatelyOnEnroll(taskSequence, stepInfo) && scheduledAtEnrollment(task.createdAt, task.dueDate);

  // Evaluate central eligibility decision (spec §11–13)
  const eligibility = evaluateAutomationEligibility({
    tenantId: task.tenantId,
    enrollment,
    lead: task.lead,
    user: task.lead.assignedTo,
    campaign: task.lead.campaign,
    // A sequence that no longer exists is not one this task may send for.
    sequence: taskSequence ?? { id: task.sequenceId!, isActive: false, isArchived: true },
    step: stepInfo,
    template: stepInfo?.template,
    account,
    isSuppressed: Boolean(suppressed),
    senderGap,
    now: new Date(),
    ignoreSchedule: runNow || immediateStep,
  });

  // Handle decisions
  if (eligibility.decision === 'DEFER') {
    const nextActionAt = eligibility.nextActionAt ?? new Date(Date.now() + 24 * 3600 * 1000);
    const delay = Math.max(0, nextActionAt.getTime() - Date.now());

    await prisma.task.update({
      where: { id: task.id },
      // The click was answered — held by something Run now does not override — so the attempt
      // this deferral schedules goes back to obeying the send window.
      data: { dueDate: nextActionAt, ...(task.runNowRequestedAt ? { runNowRequestedAt: null } : {}) },
    });

    if (enrollment) {
      await prisma.sequenceEnrollment.update({
        where: { id: enrollment.id },
        data: { nextActionAt, lastEvaluatedAt: new Date() },
      });
    }

    // Re-enqueue for the next eligible window (spec §14). The payload is unchanged, so
    // this has to go through enqueueReschedule — a plain enqueue would rebuild the same
    // dedupe key as the job currently running and be dropped, leaving the task pending
    // with nothing scheduled to pick it up.
    await enqueueReschedule(
      JobType.SEQUENCE_EXECUTE_TASK,
      // The occurrence travels with every reschedule. Dropping it here would strip the
      // protection on the first deferral and send the second execution back to correlation.
      { taskId: task.id, expectedEnrollmentId },
      { delay, tenantId: task.tenantId, discriminator: `defer:${nextActionAt.toISOString()}` }
    );

    // Audit the deferral so the reason is visible in the lead timeline rather than only
    // in worker logs. Activity.userId is a real FK, so an unassigned lead gets no row —
    // there is no system user to attribute it to.
    //
    // A step held for want of a sequence mailbox is rechecked hourly until one is chosen; writing
    // a row on every recheck filled lead timelines with one line an hour. Only the first hold with
    // that reason is recorded — the enrollment still carries it (holdReason) for the table.
    const repeatedSenderHold =
      SENDER_GAP_HOLDS.has(eligibility.reason) && enrollment?.holdReason === eligibility.reason;
    if (task.lead.assignedToId && !repeatedSenderHold) {
      await prisma.activity.create({
        data: {
          type: 'sequence_deferred',
          userId: task.lead.assignedToId,
          leadId: task.leadId,
          sequenceId: task.sequenceId,
          channel: 'email',
          description: `Automation deferred: ${eligibility.reason}`,
          metadata: {
            reason: eligibility.reason,
            nextActionAt: nextActionAt.toISOString(),
            taskId: task.id,
            ...(eligibility.details ?? {}),
          },
          tenantId: task.tenantId,
        },
      });
    }

    await recordHold(enrollment?.id, eligibility.reason);
    return { status: 'deferred', reason: eligibility.reason, nextActionAt };
  }

  if (eligibility.decision === 'MANUAL_REQUIRED') {
    if (eligibility.reason === 'missing_template' && task.lead.assignedToId) {
      await prisma.notification.create({
        data: {
          userId: task.lead.assignedToId,
          type: 'sequence_error',
          title: 'Auto-send Failed: Missing Template',
          text: `Sequence step is missing an email template. Cannot auto-send to ${task.lead.firstName} ${task.lead.lastName}. Please send manually.`,
          linkTo: `/leads/${task.lead.id}`,
          tenantId: task.tenantId,
        },
      });
    } else if (eligibility.reason === 'no_connected_mailbox' && task.lead.assignedToId) {
      await prisma.notification.create({
        data: {
          userId: task.lead.assignedToId,
          type: 'sequence_error',
          title: 'Auto-send Failed: No Mailbox',
          text: `Cannot auto-send sequence email to ${task.lead.firstName} ${task.lead.lastName} because you have no active email account connected. Please connect your email and send manually.`,
          linkTo: `/leads/${task.lead.id}`,
          tenantId: task.tenantId,
        },
      });
    }
    await recordHold(enrollment?.id, eligibility.reason);
    return { status: 'manual_action_required', reason: eligibility.reason };
  }

  if (eligibility.decision !== 'ALLOW') {
    await recordHold(enrollment?.id, eligibility.reason);
    return { status: 'skipped', reason: eligibility.reason };
  }

  const template = stepInfo!.template!;
  const leadEmail = task.lead.email;

  // CAS concurrency lock — only one runner proceeds past here.
  //
  // `lockedAt: null` is the part that makes it a lock rather than an annotation. Without it, two
  // workers racing on the same still-`pending` row both matched and both got `count === 1`, so the
  // "lock" excluded nobody and the send, the counters and the advancement could all happen twice.
  const lock = await prisma.task.updateMany({
    where: { id: task.id, status: 'pending', lockedAt: null },
    data: { lockedAt: new Date() },
  });
  if (lock.count !== 1) return { status: 'ignored', reason: 'concurrency_lock_failed' };

  try {
    // Approved per-occurrence copy, when this cadence has any.
    //
    // This is a *read* of durable, already-approved content — never a generation. Personalization
    // happens at design time (see `lib/sequences/stepCopy.ts`); if it were done here, the same
    // approved cadence would send different words depending on whether a provider answered, and a
    // retry would re-generate before the outbound row existed. A/B selection is skipped when
    // approved copy exists: the approval already decided what this prospect receives.
    const approved = await getApprovedStepCopy(expectedEnrollmentId, task.sequenceStep);

    // Deterministic A/B variant selection (spec §42)
    let subject: string;
    let body: string;
    let selectedVariantId: string | null = null;
    const variantA = template.abVariants?.find((v) => v.version === 'A');
    const variantB = template.abVariants?.find((v) => v.version === 'B');

    if (approved) {
      subject = renderTemplate(approved.subject ?? template.subject ?? '', task.lead, task.lead.assignedTo);
      body = renderTemplate(approved.body, task.lead, task.lead.assignedTo);
    } else if (variantA && variantB) {
      const seed = buildJitterSeed({
        tenantId: task.tenantId,
        sequenceId: task.sequenceId ?? undefined,
        sequenceStepId: stepInfo?.id,
        leadId: task.leadId,
      });
      const choice = deterministicOffset(seed, 2);
      const selected = choice === 0 ? variantA : variantB;

      subject = renderTemplate(selected.subject ?? template.subject ?? '', task.lead, task.lead.assignedTo);
      body = renderTemplate(selected.body ?? template.body, task.lead, task.lead.assignedTo);
      selectedVariantId = selected.id;
    } else {
      subject = renderTemplate(template.subject ?? '', task.lead, task.lead.assignedTo);
      body = renderTemplate(template.body, task.lead, task.lead.assignedTo);
    }

    // Re-check ownership at the send-intent boundary. The validation near the top of this handler
    // is now several awaits old — mailbox, suppression and eligibility all ran since — and a human
    // may have replaced the cadence in that window. There is no transaction to lean on (Neon HTTP
    // has none), so the next best thing is to check as close to the prospect-facing write as
    // possible: after the execution lock, immediately before the OutboundMessage exists.
    if (expectedEnrollmentId) {
      const live = await prisma.sequenceEnrollment.findUnique({ where: { id: expectedEnrollmentId } });
      const stillOwns =
        live &&
        live.leadId === task.leadId &&
        live.sequenceId === task.sequenceId &&
        live.status === 'active' &&
        live.occupancyKey === occupancyKeyFor(task.tenantId, task.leadId, task.sequenceId ?? '');
      // The same occurrence advancing is a different failure from losing it: eligibility checked the
      // step order several awaits ago, and a step-1 task must not send once the cadence is on step 2.
      const sameStep = live && live.currentStep === task.sequenceStep;
      if (!stillOwns || !sameStep) {
        // Release the lock so the task is not stranded claimed by an execution that refused.
        await prisma.task.updateMany({
          where: { id: task.id, status: 'pending' },
          data: { lockedAt: null },
        });
        return {
          status: 'skipped',
          reason: stillOwns ? 'occurrence_step_changed' : 'occurrence_no_longer_active',
          taskId: task.id,
        };
      }
    }

    // Same thread or a new email (lib/sequences/threading.ts). A follow-up whose template has no
    // subject is planned the same way: reps leave it blank expecting it to continue the first
    // email, and sent as written it reached the prospect with an empty subject line.
    let inReplyToOutboundId: string | null = null;
    if (enrollment && (stepInfo!.replyInThread || !subject.trim())) {
      const plan = await planStepThread({
        tenantId: task.tenantId,
        leadId: task.leadId,
        sequenceId: task.sequenceId!,
        stepOrder: task.sequenceStep ?? 0,
        enrolledAt: enrollment.startedAt,
        accountId: account!.id,
      });
      if (plan.mode !== 'new') subject = plan.subject;
      if (plan.mode === 'reply') inReplyToOutboundId = plan.inReplyToOutboundId;
    }

    // OutboundMessage (idempotent) + enqueue the actual provider send.
    const outbound = await createOutboundMessage({
      source: { kind: 'task', taskId: task.id },
      leadId: task.lead.id,
      accountId: account!.id,
      templateId: template.id,
      to: leadEmail,
      subject,
      body,
      tenantId: task.tenantId,
      // Null when approved copy won, and that is the honest answer: the approval decided this
      // prospect's wording, so no variant was on trial here and counting it toward one would
      // pollute the comparison with messages the experiment never sent.
      abVariantId: selectedVariantId,
      sequenceId: task.sequenceId,
      sequenceStepOrder: task.sequenceStep,
      ...(inReplyToOutboundId ? { inReplyToOutboundId } : {}),
    });

    await enqueueEmailSendWorkflow(
      {
        outboundMessageId: outbound.id,
        // Everything the email worker needs to settle this step once the provider answers.
        sequenceStepRef: {
          taskId: task.id,
          leadId: task.leadId,
          actorUserId: task.lead.assignedToId,
          sequenceId: task.sequenceId!,
          sequenceStep: task.sequenceStep!,
          enrollmentId: expectedEnrollmentId,
          abVariantId: selectedVariantId,
        },
        accountId: account!.id,
        to: leadEmail,
        subject,
        body,
        leadId: task.lead.id,
        templateId: template.id,
      },
      task.tenantId,
    );

    // Nothing is completed, counted or advanced here.
    //
    // This is where the task used to be marked `completed`, `emailSentCount` and
    // `AbTestVariant.sentCount` incremented and `advanceSequence` called — all of it in the
    // four statements after the enqueue, before the provider had been asked anything. On
    // 2026-09-21 the provider refused 228 messages and the CRM had already recorded 228
    // deliveries and advanced 228 cadences to step 2.
    //
    // The task stays `pending` with its lock held: in flight, claimed by nobody else. The
    // outcome is settled in `workers/email.ts` through `lib/sequences/stepOutcome.ts`, and a
    // send that never resolves is recovered by the outbound sweeps in `workers/maintenance.ts`.
    await recordHold(enrollment?.id, null);
    return { status: 'queued', taskId: task.id };
  } catch (err) {
    // Release the lock on exception so the task is not permanently stranded pending + locked
    await prisma.task.updateMany({
      where: { id: task.id, status: 'pending' },
      data: { lockedAt: null },
    });
    throw err;
  }
}

export function createSequenceWorker() {
  return createAppWorker(
    'sequence',
    async (job) => {
      switch (job.name) {
        case JobType.SEQUENCE_ENROLL:
          return handleEnroll(job.data as SequenceEnrollPayload);
        case JobType.SEQUENCE_ADVANCE:
          return handleAdvance(job.data as SequenceAdvancePayload);
        case JobType.SEQUENCE_PAUSE:
          return handlePause(job.data as SequencePausePayload);
        case JobType.SEQUENCE_UNENROLL:
          return handleUnenroll(job.data as SequenceUnenrollPayload);
        case JobType.SEQUENCE_REBUILD:
          return handleRebuild(job.data as SequenceRebuildPayload);
        case JobType.SEQUENCE_EXECUTE_TASK:
          return handleExecuteTask(job.data as SequenceExecuteTaskPayload);
        default:
          console.warn('[worker:sequence] unknown job type:', job.name);
      }
    },
    { concurrency: 5 }
  );
}
