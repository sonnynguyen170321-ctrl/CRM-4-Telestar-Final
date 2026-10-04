import type { Prisma } from '@prisma/client';

import { getLeadWhereScope, type SessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * The Leadgen page's headline numbers, counted by the server over the viewer's whole scope.
 *
 * They used to be counted in the browser from `GET /api/leads`, which returns at most 200 rows —
 * the hottest 200 — so "Total Leads Pool" read 200 for a pool of 3,000 and every other number was
 * a share of that sample. "Imported This Week" matched `source === 'csv-import'`, a value the
 * import only writes when the file has no name, so it was almost always 0. "Meetings Booked" read
 * `stage === 'meeting_booked'`, which drops every meeting whose deal has since been won or lost.
 */

export type LeadgenSummary = {
  /** Non-archived leads in scope. */
  totalLeads: number;
  /** Of those, created in the last 7 days. */
  addedThisWeek: number;
  /** Of those, qualified by the latest ICP assessment. */
  icpQualified: number;
  /** Outreach reps who own at least one lead in scope. */
  repsWorking: number;
  /** Leads by pipeline stage. */
  stages: Record<string, number>;
  /** Leads with a meeting booked at any point (a Meeting not cancelled, or a logged booking). */
  meetingsBooked: number;
};

export async function getLeadgenSummary(user: SessionUser, now: Date = new Date()): Promise<LeadgenSummary> {
  if (!user.tenantId) throw new Error('getLeadgenSummary needs a tenant');
  const scope = (await getLeadWhereScope(user)) as Prisma.LeadWhereInput;
  // AND, so no extra condition can widen the viewer's scope.
  const inScope = (extra: Prisma.LeadWhereInput = {}): Prisma.LeadWhereInput => ({
    AND: [scope, { tenantId: user.tenantId!, archivedAt: null }, extra],
  });

  const [totalLeads, addedThisWeek, icpQualified, byStage, owners, meetingsBooked] = await Promise.all([
    prisma.lead.count({ where: inScope() }),
    prisma.lead.count({ where: inScope({ createdAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } }) }),
    prisma.lead.count({ where: inScope({ icpQualification: 'qualified' }) }),
    prisma.lead.groupBy({ by: ['stage'], where: inScope(), _count: { _all: true } }),
    prisma.lead.groupBy({
      by: ['assignedToId'],
      where: inScope({ assignedTo: { role: 'sdr', isActive: true } }),
      _count: { _all: true },
    }),
    prisma.lead.count({
      where: inScope({
        OR: [
          { meetings: { some: { status: { not: 'cancelled' } } } },
          { activities: { some: { type: 'meeting_booked' } } },
        ],
      }),
    }),
  ]);

  const stages: Record<string, number> = {};
  for (const row of byStage) stages[row.stage] = row._count._all;

  return { totalLeads, addedThisWeek, icpQualified, repsWorking: owners.length, stages, meetingsBooked };
}
