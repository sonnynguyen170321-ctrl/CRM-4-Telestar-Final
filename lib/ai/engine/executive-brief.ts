import { prisma } from '@/lib/prisma';

export interface FloorPulseData {
  totalActiveLeads: number;
  unassignedLeads: number;
  overdueTasks: number;
  repliedLeadsWaiting: number;
  activeMailboxes: number;
  pausedMailboxes: number;
  stalledSequences: number;
  floorStatus: 'optimal' | 'attention_required' | 'critical_blockers';
}

export interface DirectorExecutiveBrief {
  summary: string;
  keyChanges: string[];
  risksAtScale: string[];
  pendingDecisions: string[];
  generatedAt: Date;
}

/**
 * 🎯 FLOOR PULSE & DIRECTOR EXECUTIVE BRIEF (Sections 25 & 26)
 */
export async function getFloorPulse(tenantId: string): Promise<FloorPulseData> {
  const [
    totalActiveLeads,
    unassignedLeads,
    overdueTasks,
    repliedLeadsWaiting,
    activeMailboxes,
    pausedMailboxes,
  ] = await Promise.all([
    prisma.lead.count({
      where: { tenantId, stage: { notIn: ['won', 'lost'] } },
    }),
    prisma.lead.count({
      where: { tenantId, operatingState: 'unassigned' },
    }),
    prisma.lead.count({
      where: { tenantId, nextTaskDue: { lt: new Date() }, stage: { notIn: ['won', 'lost'] } },
    }),
    prisma.lead.count({
      where: { tenantId, stage: 'replied' },
    }),
    prisma.emailAccount.count({
      where: { tenantId, isActive: true, sendPausedAt: null },
    }),
    prisma.emailAccount.count({
      where: {
        tenantId,
        OR: [{ isActive: false }, { sendPausedAt: { not: null } }],
      },
    }),
  ]);

  let floorStatus: FloorPulseData['floorStatus'] = 'optimal';
  if (pausedMailboxes > 0 || unassignedLeads > 50) {
    floorStatus = 'critical_blockers';
  } else if (overdueTasks > 10 || repliedLeadsWaiting > 5) {
    floorStatus = 'attention_required';
  }

  return {
    totalActiveLeads,
    unassignedLeads,
    overdueTasks,
    repliedLeadsWaiting,
    activeMailboxes,
    pausedMailboxes,
    stalledSequences: 0,
    floorStatus,
  };
}

export async function generateDirectorBrief(tenantId: string): Promise<DirectorExecutiveBrief> {
  const pulse = await getFloorPulse(tenantId);
  const now = new Date();

  const keyChanges: string[] = [
    `Active Pipeline: ${pulse.totalActiveLeads} active leads across sales floor.`,
    `Replied Queue: ${pulse.repliedLeadsWaiting} prospect replies waiting for closing interactions.`,
  ];

  const risksAtScale: string[] = [];
  const pendingDecisions: string[] = [];

  if (pulse.pausedMailboxes > 0) {
    risksAtScale.push(
      `${pulse.pausedMailboxes} sales mailbox connection(s) currently halted. Outbound volume is impaired.`
    );
    pendingDecisions.push('Authorize mailbox re-authentication in Settings.');
  }

  if (pulse.unassignedLeads > 0) {
    risksAtScale.push(
      `${pulse.unassignedLeads} newly imported leads are unassigned in pool and idling.`
    );
    pendingDecisions.push('Approve lead distribution across available SDR roster.');
  }

  const summary =
    pulse.floorStatus === 'optimal'
      ? 'Sales floor is operating at normal cadence. No material revenue bottlenecks detected.'
      : `Sales floor requires leadership attention: ${risksAtScale.length} operational risk factor(s) identified.`;

  return {
    summary,
    keyChanges,
    risksAtScale,
    pendingDecisions,
    generatedAt: now,
  };
}
