import { prisma } from '@/lib/prisma';

import { unenrollLead } from './engine';
import { pauseEnrollmentOccurrence } from './lifecycle';

/**
 * Stopping a *lead*, not one cadence.
 *
 * Until 2026-10-03 a lead ran at most one sequence, so "pause the enrollment this reply matched"
 * and "stop the lead's outreach" were the same act. The owner decided a lead may run any number of
 * sequences at once, and that split them: a prospect who replies to the LinkedIn cadence would have
 * kept receiving the email cadence, and a bounced address would have kept generating email steps
 * from every other sequence it sat in. Every event that means "a human must look at this prospect
 * now" — a reply, a bounce, an unsubscribe, a booked meeting — therefore goes through here and
 * stops every running cadence on the lead.
 *
 * Each cadence is paused through `pauseEnrollmentOccurrence`, the same compare-and-set an SDR's
 * Pause uses, so its tasks are skipped, its reason recorded and its activity written exactly as if
 * it had been paused by hand. A cadence that was already paused or finished is left as it is.
 */

export type LeadStopResult = {
  /** Cadences this call moved from active to paused. */
  paused: number;
  /** Sequence ids of those cadences, for the activity feed and the caller's report. */
  sequenceIds: string[];
};

export async function pauseAllLeadCadences(input: {
  leadId: string;
  reason: string;
  actorUserId: string;
  /** An enrollment the caller already paused itself (the one a reply was matched to). */
  exceptEnrollmentId?: string | null;
}): Promise<LeadStopResult> {
  const running = await prisma.sequenceEnrollment.findMany({
    where: {
      leadId: input.leadId,
      status: 'active',
      ...(input.exceptEnrollmentId ? { id: { not: input.exceptEnrollmentId } } : {}),
    },
    select: { id: true, sequenceId: true },
    orderBy: { startedAt: 'asc' },
  });

  const result: LeadStopResult = { paused: 0, sequenceIds: [] };
  for (const enrollment of running) {
    const outcome = await pauseEnrollmentOccurrence({
      enrollmentId: enrollment.id,
      leadId: input.leadId,
      sequenceId: enrollment.sequenceId,
      reason: input.reason,
      actorUserId: input.actorUserId,
    });
    // `not_active` means it changed state between the read and the pause — already stopped by
    // someone else, which is the outcome this function wants anyway.
    if (outcome.ok) {
      result.paused += 1;
      result.sequenceIds.push(enrollment.sequenceId);
    }
  }
  return result;
}

/**
 * End every cadence on a lead — for a stop that must not be resumed (an unsubscribe, a hard "do not
 * contact"). Releases each occupancy in the same statement as the terminal status.
 */
export async function unenrollAllLeadCadences(leadId: string): Promise<string[]> {
  const occupying = await prisma.sequenceEnrollment.findMany({
    where: { leadId, status: { in: ['active', 'paused'] } },
    select: { sequenceId: true },
  });
  const sequenceIds = Array.from(new Set(occupying.map((row) => row.sequenceId)));
  for (const sequenceId of sequenceIds) {
    await unenrollLead(leadId, sequenceId);
  }
  return sequenceIds;
}
