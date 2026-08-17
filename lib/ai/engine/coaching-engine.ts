import { prisma } from '@/lib/prisma';

export interface CoachingSignal {
  repId: string;
  repName: string;
  repEmail: string;
  dimension: 'follow_up_speed' | 'overdue_rate' | 'crm_hygiene' | 'reply_handling' | 'meeting_conversion';
  observation: string;
  metricValue: string;
  teamBenchmark: string;
  actionableCoachingTip: string;
  severity: 'needs_attention' | 'on_track' | 'exemplary';
}

/**
 * 🎯 TEAM LEAD COACHING ENGINE (Section 24)
 * Grounded strictly in observable work behavior, metrics, and team medians.
 * NEVER infers personality, intent, or motivation.
 */
export async function generateTeamCoachingSignals(params: {
  tenantId: string;
  teamLeadId?: string;
}): Promise<CoachingSignal[]> {
  const { tenantId } = params;
  const signals: CoachingSignal[] = [];
  const now = new Date();

  // 1. Fetch active SDRs
  const reps = await prisma.user.findMany({
    where: { tenantId, role: { in: ['sdr', 'leadgen'] }, isActive: true },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      assignedLeads: {
        where: { stage: { notIn: ['won', 'lost'] } },
        select: { id: true, nextTaskDue: true, stage: true, updatedAt: true },
      },
    },
  });

  if (reps.length === 0) return [];

  // 2. Compute team median overdue rate
  const repOverdueStats = reps.map((rep) => {
    const totalOpen = rep.assignedLeads.length;
    const overdueCount = rep.assignedLeads.filter((l) => l.nextTaskDue && l.nextTaskDue < now).length;
    const overdueRate = totalOpen > 0 ? Math.round((overdueCount / totalOpen) * 100) : 0;
    return { rep, totalOpen, overdueCount, overdueRate };
  });

  const avgOverdueRate = Math.round(
    repOverdueStats.reduce((acc, curr) => acc + curr.overdueRate, 0) / repOverdueStats.length
  );

  // 3. Evaluate each rep against objective benchmarks
  for (const { rep, totalOpen, overdueCount, overdueRate } of repOverdueStats) {
    const repName = `${rep.firstName} ${rep.lastName}`.trim() || rep.email;

    if (overdueRate > avgOverdueRate + 20 && overdueCount >= 3) {
      signals.push({
        repId: rep.id,
        repName,
        repEmail: rep.email,
        dimension: 'overdue_rate',
        observation: `${repName} has an overdue task rate of ${overdueRate}% (${overdueCount}/${totalOpen} open leads), which is higher than the team average.`,
        metricValue: `${overdueRate}% overdue`,
        teamBenchmark: `Team avg: ${avgOverdueRate}%`,
        actionableCoachingTip: `Review daily task batching in morning 1-on-1 and help rep prioritize hot leads over cold contacts.`,
        severity: 'needs_attention',
      });
    } else if (overdueRate <= 5 && totalOpen >= 5) {
      signals.push({
        repId: rep.id,
        repName,
        repEmail: rep.email,
        dimension: 'crm_hygiene',
        observation: `${repName} maintains 95%+ on-time task execution across ${totalOpen} active prospect records.`,
        metricValue: `${overdueRate}% overdue`,
        teamBenchmark: `Team avg: ${avgOverdueRate}%`,
        actionableCoachingTip: `Recognize outstanding CRM discipline during weekly standup.`,
        severity: 'exemplary',
      });
    }
  }

  return signals;
}
