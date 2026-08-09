import { prisma } from '@/lib/prisma';
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
  pauseSequence,
  unenrollLead,
} from '@/lib/sequences/engine';
import { renderTemplate } from '@/lib/templates/render';
import { createOutboundMessage, enqueueEmailSendWorkflow } from '@/lib/workflows/email';
import { evaluateAutomationEligibility } from '@/lib/automation/eligibility';
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
    data: { status: 'unenrolled', completedAt: new Date() },
  });

  // Create new enrollment
  await prisma.sequenceEnrollment.create({
    data: {
      leadId, sequenceId,
      status: 'active', currentStep: 1,
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
    new Date()
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
      data: { status: 'completed', currentStep, completedAt: new Date() },
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
  const { leadId, reason, userId } = payload;

  const enrollment = await prisma.sequenceEnrollment.findFirst({
    where: { leadId, status: 'active' },
    select: { id: true, sequenceId: true },
  });
  if (!enrollment) {
    return { skipped: true, reason: 'no_active_enrollment' };
  }

  await pauseSequence(leadId, reason, userId);

  await prisma.sequenceEnrollment.update({
    where: { id: enrollment.id },
    data: { status: 'paused' },
  });

  return { success: true, leadId, sequenceId: enrollment.sequenceId, reason };
}

export async function handleUnenroll(payload: SequenceUnenrollPayload) {
  const { leadId, sequenceId } = payload;

  await prisma.sequenceEnrollment.updateMany({
    where: { leadId, sequenceId, status: { in: ['active', 'paused'] } },
    data: { status: 'unenrolled', completedAt: new Date() },
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
  const { taskId } = payload;

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

  // Fetch enrollment
  const enrollment = await prisma.sequenceEnrollment.findFirst({
    where: { leadId: task.leadId, sequenceId: task.sequenceId!, status: 'active' },
  });

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
      { taskId: task.id },
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
  const lock = await prisma.task.updateMany({
    where: { id: task.id, status: 'pending' },
    data: { lockedAt: new Date() },
  });
  if (lock.count !== 1) return { status: 'ignored', reason: 'concurrency_lock_failed' };

  // Deterministic A/B variant selection (spec §42)
  let subject: string;
  let body: string;
  let selectedVariantId: string | null = null;
  const variantA = template.abVariants?.find((v) => v.version === 'A');
  const variantB = template.abVariants?.find((v) => v.version === 'B');

  if (variantA && variantB) {
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
  await advanceSequence(task, task.lead.assignedToId);

  return { status: 'completed', taskId: task.id };
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
