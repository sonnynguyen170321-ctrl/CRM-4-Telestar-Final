import type { ActivityType, Prisma } from '@prisma/client';

import { getLeadWhereScope, type SessionUser } from '@/lib/auth';
import { getLocalDayBoundaries } from '@/lib/dates/timezone';
import { prisma } from '@/lib/prisma';
import { countCalls } from '@/lib/telephony/metrics';

/**
 * A rep's day for Home's "My Performance" card, counted by the server.
 *
 * The card used to tally the newest 20 activities of any type and any date in the browser: it
 * could never pass 20, it said nothing about today, and it counted one activity type per channel
 * while the work is logged under several (a completed email task is `email_task_completed`, a
 * dialled call `call_made`). Its "Active" pipeline row came from `Lead.stage`, which stays
 * `sequence_active` after every cadence on the lead has finished.
 */

const CHANNEL_TYPES: Record<'emails' | 'linkedin', ActivityType[]> = {
  emails: ['email_sent', 'email_task_completed'],
  linkedin: ['linkedin_sent', 'linkedin_touch'],
};

export type MyDay = {
  calls: number;
  emails: number;
  linkedin: number;
  /** Leads with at least one cadence running now. */
  inSequence: number;
};

export async function getMyDay(user: SessionUser, now: Date = new Date()): Promise<MyDay> {
  if (!user.tenantId) throw new Error('getMyDay needs a tenant');
  const tenantId = user.tenantId;
  const owner = await prisma.user.findUnique({ where: { id: user.id }, select: { timezone: true } });
  const { start } = getLocalDayBoundaries(now, owner?.timezone || 'UTC');
  const today = { tenantId, userId: user.id, createdAt: { gte: start } };

  const leadScope = (await getLeadWhereScope(user)) as Prisma.LeadWhereInput;

  const [calls, emails, dryRunEmails, linkedin, inSequence] = await Promise.all([
    // Calls come from the one shared definition (softphone Call rows + unlinked call activities).
    countCalls({ tenantId, scope: { userIds: [user.id] }, range: { from: start }, mode: 'attempts' }),
    prisma.activity.count({ where: { ...today, type: { in: CHANNEL_TYPES.emails } } }),
    // A dry run writes `email_sent` too. Counted and subtracted, rather than excluded with
    // `NOT dryRun = true`, which SQL also applies to every row whose metadata lacks the key.
    prisma.activity.count({ where: { ...today, type: 'email_sent', metadata: { path: ['dryRun'], equals: true } } }),
    prisma.activity.count({ where: { ...today, type: { in: CHANNEL_TYPES.linkedin } } }),
    prisma.lead.count({
      where: {
        AND: [leadScope, { tenantId, archivedAt: null }, { sequenceEnrollments: { some: { status: 'active' } } }],
      },
    }),
  ]);

  return { calls, emails: emails - dryRunEmails, linkedin, inSequence };
}
