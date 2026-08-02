import { prisma } from '@/lib/prisma';

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export async function getLeadgenMetrics(tenantId: string) {
  const now = new Date();
  const weekStart = startOfDay(now);
  weekStart.setDate(weekStart.getDate() - 7);

  const [importedWeek, qualifiedWeek, disqualifiedWeek, totalItems, duplicateItems, assignedCampaign, assignedSdr, qualifiedAll, requirementProgress] =
    await Promise.all([
      prisma.leadPoolItem.count({
        where: { tenantId, createdAt: { gte: weekStart }, sourceType: { not: 'manual' } },
      }),
      prisma.leadPoolItem.count({
        where: { tenantId, qualification: 'qualified', qualifiedAt: { gte: weekStart } },
      }),
      prisma.leadPoolItem.count({
        where: { tenantId, status: 'disqualified', updatedAt: { gte: weekStart } },
      }),
      prisma.leadPoolItem.count({ where: { tenantId } }),
      prisma.leadPoolItem.count({
        where: { tenantId, OR: [{ duplicateOfId: { not: null } }, { qualification: 'duplicate' }] },
      }),
      prisma.leadPoolItem.count({ where: { tenantId, status: 'assigned_to_campaign' } }),
      prisma.leadPoolItem.count({ where: { tenantId, assignedSdrId: { not: null } } }),
      prisma.leadPoolItem.findMany({
        where: { tenantId, qualification: 'qualified' },
        select: { id: true, sourceType: true, sourceName: true, qualifiedById: true, qualifiedAt: true, createdAt: true, emailValidation: true, emailScore: true },
      }),
      listRequirementProgress(tenantId),
    ]);

  const emailValidCount = qualifiedAll.filter(
    (q) => q.emailValidation === 'valid' || q.emailValidation === 'deliverable' || q.emailScore === 100
  ).length;

  const bySource = new Map<string, number>();
  for (const q of qualifiedAll) {
    const key = q.sourceName || q.sourceType;
    bySource.set(key, (bySource.get(key) ?? 0) + 1);
  }

  const byMember = new Map<string, number>();
  const memberNames = new Map<string, string>();
  for (const q of qualifiedAll) {
    if (!q.qualifiedById) continue;
    byMember.set(q.qualifiedById, (byMember.get(q.qualifiedById) ?? 0) + 1);
  }
  if (byMember.size > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: [...byMember.keys()] } },
      select: { id: true, firstName: true, lastName: true },
    });
    for (const u of users) memberNames.set(u.id, `${u.firstName} ${u.lastName}`.trim());
  }

  const qualifiedWithTimestamps = qualifiedAll.filter((q) => q.qualifiedAt && q.createdAt);
  const avgQualifyMs = qualifiedWithTimestamps.length
    ? qualifiedWithTimestamps.reduce((sum, q) => sum + (q.qualifiedAt!.getTime() - q.createdAt.getTime()), 0) /
      qualifiedWithTimestamps.length
    : 0;

  return {
    importedWeek,
    qualifiedWeek,
    disqualifiedWeek,
    totalPool: totalItems,
    duplicateRate: totalItems ? Math.round((duplicateItems / totalItems) * 100) : 0,
    emailValidRate: qualifiedAll.length ? Math.round((emailValidCount / qualifiedAll.length) * 100) : 0,
    assignedToCampaign: assignedCampaign,
    assignedToSdr: assignedSdr,
    qualifiedBySource: [...bySource.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
    qualifiedByMember: [...byMember.entries()].map(([id, count]) => ({ id, name: memberNames.get(id) ?? id, count })).sort((a, b) => b.count - a.count),
    requirementProgress,
    avgDaysToQualification: Math.round(avgQualifyMs / 86_400_000 * 10) / 10,
  };
}

async function listRequirementProgress(tenantId: string) {
  const requirements = await prisma.campaignLeadRequirement.findMany({
    where: { tenantId, status: { in: ['open', 'fulfilled'] } },
    include: { campaign: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return Promise.all(
    requirements.map(async (req) => {
      const delivered = await prisma.leadPoolItem.count({
        where: { tenantId, assignedCampaignId: req.campaignId, status: 'assigned_to_campaign' },
      });
      return {
        campaignId: req.campaignId,
        campaignName: req.campaign.name,
        required: req.requiredCount,
        delivered,
        status: delivered >= req.requiredCount ? 'fulfilled' : req.status,
      };
    })
  );
}
