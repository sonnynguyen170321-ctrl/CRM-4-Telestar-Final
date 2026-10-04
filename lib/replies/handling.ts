import { prisma } from '@/lib/prisma';
import { calculateNextActionAt } from '@/lib/automation/scheduling';
import { resolveTimezone } from '@/lib/automation/timezone';
import { pauseEnrollmentOccurrence } from '@/lib/sequences/lifecycle';
import { pauseAllLeadCadences, unenrollAllLeadCadences } from '@/lib/sequences/leadStop';
import { pauseCompanyCadencesSafely } from '@/lib/sequences/companyStop';
import { handoffProspectToHuman, stopProspectOutreach } from '@/lib/prospects/ownership';
import { CLASS_LABEL, KIND_LABEL, type ReplyClassification } from './types';
import { onActivityLogged, onSuppressionOrArchive } from '@/lib/contact-intelligence/events';

/**
 * What each reply class *does* (Phase 8b, ARCHITECTURE §5).
 *
 * One function per class, all reached from the single `handleApplyReply` chokepoint in
 * `workers/sync.ts`. There is no second inbound listener and no second place a reply can change
 * CRM state — an out-of-office and a pricing question travel the same pipeline and diverge here.
 *
 * ## The enrollment is passed in, never re-read
 *
 * Every path pauses or stops the **exact** occurrence the caller resolved. Re-reading
 * `Lead.sequenceId` here would reopen the replacement race Phase 8a closed: by the time a reply is
 * processed, the cadence it answers may already have been replaced by a human one, and stopping
 * that would silence a conversation the reply says nothing about.
 */

/**
 * How long an out-of-office defers outreach when the message names no return date.
 *
 * Business days, through the scheduling engine — never a hand-computed timestamp (invariant 7).
 */
const ADMIN_RESUME_DAYS: Record<string, number> = {
  out_of_office: 7,
  extended_leave: 60,
  left_company: 0,
  wrong_person: 0,
};

export interface ReplyHandlingInput {
  leadId: string;
  tenantId: string;
  /** The exact occurrence the reply was resolved against. Null when the lead is not enrolled. */
  enrollment: { id: string; sequenceId: string } | null;
  /** Durable id of the inbound event — keys handoff idempotency. */
  eventId: string;
  actorUserId: string;
  classification: ReplyClassification;
  /** Prospect-facing name, for the messages a human reads. */
  leadName: string;
}

export interface ReplyHandlingOutcome {
  /** What happened to the cadence. */
  cadence: 'stopped' | 'paused' | 'not_paused' | 'no_enrollment';
  /** True when an SDR was interrupted. Class B must never set this. */
  handedOff: boolean;
  /** Set for class B: when outreach may resume, computed by the scheduling engine. */
  resumeAt?: Date | null;
  /** Set for class A when the prospect was suppressed. */
  suppressed?: boolean;
  /** Colleagues' cadences paused by a sequence's "stop on company reply" rule. */
  companyPaused?: number;
}

/** Pause the exact occurrence, reporting what actually happened rather than assuming. */
async function pauseOccurrence(
  input: ReplyHandlingInput,
  reason: string
): Promise<'paused' | 'not_paused' | 'no_enrollment'> {
  // A reply stops the *lead*, not only the cadence it was matched to: with several sequences on
  // one prospect, the others would otherwise keep sending to someone who has just answered.
  const others = await pauseAllLeadCadences({
    leadId: input.leadId,
    reason,
    actorUserId: input.actorUserId,
    exceptEnrollmentId: input.enrollment?.id ?? null,
  });
  if (!input.enrollment) return others.paused > 0 ? 'paused' : 'no_enrollment';
  const result = await pauseEnrollmentOccurrence({
    enrollmentId: input.enrollment.id,
    leadId: input.leadId,
    sequenceId: input.enrollment.sequenceId,
    reason,
    actorUserId: input.actorUserId,
  });
  return result.ok || others.paused > 0 ? 'paused' : 'not_paused';
}

/**
 * Class A — deterministic stop.
 *
 * Stops and suppresses. It deliberately creates **no task and no notification**: an unsubscribe is
 * not an opportunity, and interrupting an SDR to tell them a prospect opted out trains them to
 * ignore the queue that also carries pricing questions.
 */
async function applyStop(input: ReplyHandlingInput): Promise<ReplyHandlingOutcome> {
  const lead = await prisma.lead.findUnique({
    where: { id: input.leadId },
    select: { email: true, stage: true },
  });

  const cadence = await pauseOccurrence(input, 'manual');
  // A stop is not a pause: unenroll every cadence on the lead so nothing resumes any of them, and
  // release each occupancy.
  await unenrollAllLeadCadences(input.leadId);

  let suppressed = false;
  if (input.classification.kind === 'unsubscribe' && lead?.email) {
    const existing = await prisma.suppressionEntry.findFirst({
      where: { tenantId: input.tenantId, email: lead.email, reason: 'unsubscribe' },
    });
    if (!existing) {
      await prisma.suppressionEntry.create({
        data: { tenantId: input.tenantId, email: lead.email, reason: 'unsubscribe' },
      });
    }
    suppressed = true;
  }

  await prisma.lead.update({
    where: { id: input.leadId },
    data: { stage: 'lost' },
  });

  await prisma.activity.create({
    data: {
      tenantId: input.tenantId,
      userId: input.actorUserId,
      leadId: input.leadId,
      type: 'sequence_unenrolled',
      channel: 'email',
      description: `${KIND_LABEL[input.classification.kind]} — outreach stopped`,
      metadata: {
        replyClass: input.classification.replyClass,
        replyKind: input.classification.kind,
        confidence: input.classification.confidence,
        source: input.classification.source,
        suppressed,
      },
    },
  });

  // Ownership leaves the AI without landing on a human: nobody has anything to do here.
  await stopProspectOutreach({
    leadId: input.leadId,
    tenantId: input.tenantId,
    eventId: input.eventId,
    reason: KIND_LABEL[input.classification.kind],
  });

  return { cadence: cadence === 'no_enrollment' ? 'no_enrollment' : 'stopped', handedOff: false, suppressed };
}

/**
 * Class B — administrative.
 *
 * Records the administrative state, pauses the cadence, and proposes when outreach may resume —
 * through the scheduling engine, not a hand-added number of days. No urgent SDR task: an
 * out-of-office is information, and the whole point of separating B from C is that it does not
 * consume a human's attention.
 *
 * `left_company` and `wrong_person` get a *contact correction* task instead, because those need a
 * human decision about who to talk to next — but a normal-priority one, not an interrupt.
 */
async function applyAdministrative(input: ReplyHandlingInput): Promise<ReplyHandlingOutcome> {
  const kind = input.classification.kind;
  const cadence = await pauseOccurrence(input, 'manual');

  const lead = await prisma.lead.findUnique({
    where: { id: input.leadId },
    select: { timezone: true, assignedToId: true, assignedTo: { select: { timezone: true } } },
  });

  const days = ADMIN_RESUME_DAYS[kind] ?? 7;
  const resumeAt =
    days > 0
      ? calculateNextActionAt({
          baseAt: new Date(),
          delayDays: days,
          delayHours: 0,
          sendWindowStartMinutes: null,
          sendWindowEndMinutes: null,
          timezone: resolveTimezone(lead?.timezone, lead?.assignedTo?.timezone),
          businessDayPolicy: 'skip_weekends',
        }).dueAtUtc
      : null;

  await prisma.activity.create({
    data: {
      tenantId: input.tenantId,
      userId: input.actorUserId,
      leadId: input.leadId,
      type: 'sequence_deferred',
      channel: 'email',
      description: `${KIND_LABEL[kind]} — outreach paused${resumeAt ? `, proposed resume ${resumeAt.toISOString().slice(0, 10)}` : ''}`,
      metadata: {
        replyClass: input.classification.replyClass,
        replyKind: kind,
        confidence: input.classification.confidence,
        source: input.classification.source,
        proposedResumeAt: resumeAt?.toISOString() ?? null,
        administrative: true,
      },
    },
  });

  const needsContactCorrection = kind === 'left_company' || kind === 'wrong_person';
  if (lead?.assignedToId) {
    if (needsContactCorrection) {
      await prisma.task.create({
        data: {
          tenantId: input.tenantId,
          leadId: input.leadId,
          userId: lead.assignedToId,
          type: 'manual',
          title: `Find the right contact at ${input.leadName}`,
          description: `${KIND_LABEL[kind]}. Outreach is paused until the contact is corrected.`,
          dueDate: new Date(),
          priority: 'medium',
        },
      });
    } else if (resumeAt) {
      // A reminder, not a task: nothing is owed until the date arrives.
      await prisma.reminder.create({
        data: {
          tenantId: input.tenantId,
          leadId: input.leadId,
          userId: lead.assignedToId,
          text: `${input.leadName} was ${KIND_LABEL[kind].toLowerCase()} — outreach can resume`,
          dueAt: resumeAt,
        },
      });
    }
  }

  return { cadence, handedOff: false, resumeAt };
}

/**
 * Classes C and D — a human takes over.
 *
 * C is a selling opportunity and gets an urgent handoff. D is ambiguity, and gets the same
 * ownership move with softer language: the SDR decides what it was. Both stop AI outreach, because
 * neither is something an agent should answer.
 */
async function applyHumanHandoff(input: ReplyHandlingInput): Promise<ReplyHandlingOutcome> {
  const cadence = await pauseOccurrence(input, 'reply');
  const isEngagement = input.classification.replyClass === 'C';

  const handoff = await handoffProspectToHuman({
    leadId: input.leadId,
    tenantId: input.tenantId,
    eventId: input.eventId,
    reason: isEngagement
      ? `${KIND_LABEL[input.classification.kind].toLowerCase()} — replied to your outreach`
      : 'reply needs review',
    summary: isEngagement
      ? `${KIND_LABEL[input.classification.kind]}. ${input.classification.rationale} Respond while it's warm.`
      : `Reply could not be classified confidently. Read it and decide the next step.`,
  });

  return { cadence, handedOff: handoff.applied };
}

/** Dispatch on the class. Exhaustive — a new class cannot fall through to "do nothing". */
export async function applyReplyClassification(
  input: ReplyHandlingInput
): Promise<ReplyHandlingOutcome> {
  let outcome: ReplyHandlingOutcome;
  switch (input.classification.replyClass) {
    case 'A':
      outcome = await applyStop(input);
      break;
    case 'B':
      outcome = await applyAdministrative(input);
      break;
    case 'C':
    case 'D':
      outcome = await applyHumanHandoff(input);
      break;
  }

  // A person at the company answered — interest, a question, but also an unsubscribe or a "no" —
  // so sequences with "stop on company reply" pause for their colleagues. An out-of-office or a
  // "wrong person" (class B) is not the company answering (lib/sequences/companyStop.ts).
  if (input.classification.replyClass !== 'B') {
    const company = await pauseCompanyCadencesSafely({
      tenantId: input.tenantId,
      leadId: input.leadId,
      actorUserId: input.actorUserId,
    });
    outcome = { ...outcome, companyPaused: company.paused };
  }

  // Hook Contact Intelligence evidence
  await onActivityLogged({
    leadId: input.leadId,
    type: 'reply_received',
    channel: 'email',
    metadata: {
      replyClass: input.classification.replyClass,
      sentiment: input.classification.replyClass === 'C' ? 'positive' : input.classification.replyClass === 'A' ? 'negative' : 'neutral',
      kind: input.classification.kind,
      confidence: input.classification.confidence,
    },
    userId: input.actorUserId,
    tenantId: input.tenantId,
  });

  if (outcome.suppressed) {
    await onSuppressionOrArchive({
      leadId: input.leadId,
      reason: 'unsubscribe',
      tenantId: input.tenantId,
      actorId: input.actorUserId,
    });
  }

  return outcome;
}

export { CLASS_LABEL, KIND_LABEL };
