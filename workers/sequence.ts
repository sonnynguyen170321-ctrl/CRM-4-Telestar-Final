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
import { enrollmentStepTaskId } from '@/lib/sequences/identity';
import { renderTemplate } from '@/lib/templates/render';
import { createOutboundMessage, enqueueEmailSendWorkflow } from '@/lib/workflows/email';
import { evaluateAutomationEligibility } from '@/lib/automation/eligibility';
import { getApprovedStepCopy } from '@/lib/sequences/stepCopy';
import { deterministicOffset, buildJitterSeed } from '@/lib/automation/jitter';
import { enqueueReschedule } from '@/lib/bullmq/enqueue';

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

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
      occupancyKey: occupancyKeyFor(lead.tenantId, leadId),
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
      enrollment.occupancyKey === `${task.tenantId}:${task.leadId}`;
    if (!owns) {
      return { status: 'skipped', reason: 'occurrence_no_longer_active', taskId: task.id };
    }
  }

  // Fetch mailbox
  const account = await prisma.emailAccount.findFirst({
    where: { userId: task.lead.assignedToId, isActive: true },
  });

  // Check suppression
  const recipientDomain = task.lead.email ? task.lead.email.split('@')[1] : '';
  const suppressed = recipientDomain
    ? await prisma.suppressionEntry.findFirst({
        where: {
          tenantId: task.tenantId,
          AND: [
            { OR: [{ email: task.lead.email }, { domain: recipientDomain }] },
            ...(task.lead.campaignId
              ? [{ OR: [{ campaignId: task.lead.campaignId }, { campaignId: null }] }]
              : []),
          ],
        },
      })
    : null;

  // Evaluate central eligibility decision (spec §11–13)
  const eligibility = evaluateAutomationEligibility({
    tenantId: task.tenantId,
    enrollment,
    lead: task.lead,
    user: task.lead.assignedTo,
    campaign: task.lead.campaign,
    sequence: task.lead.sequence,
    step: stepInfo,
    template: stepInfo?.template,
    account,
    isSuppressed: Boolean(suppressed),
    now: new Date(),
  });

  // Handle decisions
  if (eligibility.decision === 'DEFER') {
    const nextActionAt = eligibility.nextActionAt ?? new Date(Date.now() + 24 * 3600 * 1000);
    const delay = Math.max(0, nextActionAt.getTime() - Date.now());

    await prisma.task.update({
      where: { id: task.id },
      data: { dueDate: nextActionAt },
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
    if (task.lead.assignedToId) {
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
    return { status: 'manual_action_required', reason: eligibility.reason };
  }

  if (eligibility.decision !== 'ALLOW') {
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
        live.occupancyKey === `${task.tenantId}:${task.leadId}`;
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
    });

    await enqueueEmailSendWorkflow(
      {
        outboundMessageId: outbound.id,
        accountId: account!.id,
        to: leadEmail,
        subject,
        body,
        leadId: task.lead.id,
        templateId: template.id,
      },
      task.tenantId,
    );

    // Complete the task, bump counters, advance the sequence.
    await prisma.task.update({
      where: { id: task.id },
      data: { status: 'completed', completedAt: new Date() },
    });
    if (selectedVariantId) {
      await prisma.abTestVariant.update({
        where: { id: selectedVariantId },
        data: { sentCount: { increment: 1 } },
      });
    }
    await prisma.lead.update({
      where: { id: task.leadId },
      data: { emailSentCount: { increment: 1 } },
    });
    // The occurrence continues into the next step's task and its delayed job.
    await advanceSequence(task, task.lead.assignedToId, expectedEnrollmentId);

    return { status: 'completed', taskId: task.id };
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
