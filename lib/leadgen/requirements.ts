import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/auth';

export type RequirementInput = {
  campaignId: string;
  requiredCount: number;
  targetTitles?: string[];
  targetCountries?: string[];
  targetIndustries?: string[];
  companySizeMin?: number | null;
  companySizeMax?: number | null;
  requiredFields?: string[];
  notes?: string | null;
  dueDate?: string | null;
  status?: 'open' | 'fulfilled' | 'paused' | 'cancelled';
};

export async function listRequirements(tenantId: string, campaignId?: string) {
  const requirements = await prisma.campaignLeadRequirement.findMany({
    where: { tenantId, ...(campaignId ? { campaignId } : {}) },
    include: {
      campaign: { select: { id: true, name: true, client: { select: { name: true } } } },
      createdBy: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Delivered counts reflect how many qualified pool items were assigned to each campaign.
  return Promise.all(
    requirements.map(async (req) => {
      const delivered = await prisma.leadPoolItem.count({
        where: { tenantId, assignedCampaignId: req.campaignId, status: 'assigned_to_campaign' },
      });
      const progress = req.requiredCount > 0 ? Math.min(100, Math.round((delivered / req.requiredCount) * 100)) : 0;
      return {
        ...req,
        delivered,
        progress,
        status: req.requiredCount > 0 && delivered >= req.requiredCount ? 'fulfilled' : req.status,
      };
    })
  );
}

export async function createRequirement(params: {
  input: RequirementInput;
  actor: SessionUser;
  tenantId: string;
}) {
  const { input, actor, tenantId } = params;
  return prisma.campaignLeadRequirement.create({
    data: {
      campaignId: input.campaignId,
      requiredCount: input.requiredCount,
      targetTitles: input.targetTitles ?? [],
      targetCountries: input.targetCountries ?? [],
      targetIndustries: input.targetIndustries ?? [],
      companySizeMin: input.companySizeMin ?? null,
      companySizeMax: input.companySizeMax ?? null,
      requiredFields: input.requiredFields ?? [],
      notes: input.notes ?? null,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      status: input.status ?? 'open',
      createdById: actor.id,
      tenantId,
    },
  });
}

export async function updateRequirement(params: {
  id: string;
  input: Partial<RequirementInput>;
  tenantId: string;
}) {
  const { id, input, tenantId } = params;
  const existing = await prisma.campaignLeadRequirement.findFirst({
    where: { id, tenantId },
    select: { id: true },
  });
  if (!existing) return null;

  return prisma.campaignLeadRequirement.update({
    where: { id },
    data: {
      ...(input.campaignId !== undefined ? { campaignId: input.campaignId } : {}),
      ...(input.requiredCount !== undefined ? { requiredCount: input.requiredCount } : {}),
      ...(input.targetTitles !== undefined ? { targetTitles: input.targetTitles } : {}),
      ...(input.targetCountries !== undefined ? { targetCountries: input.targetCountries } : {}),
      ...(input.targetIndustries !== undefined ? { targetIndustries: input.targetIndustries } : {}),
      ...(input.companySizeMin !== undefined ? { companySizeMin: input.companySizeMin } : {}),
      ...(input.companySizeMax !== undefined ? { companySizeMax: input.companySizeMax } : {}),
      ...(input.requiredFields !== undefined ? { requiredFields: input.requiredFields } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate ? new Date(input.dueDate) : null } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  });
}

export async function deleteRequirement(id: string, tenantId: string): Promise<boolean> {
  const existing = await prisma.campaignLeadRequirement.findFirst({
    where: { id, tenantId },
    select: { id: true },
  });
  if (!existing) return false;
  await prisma.campaignLeadRequirement.delete({ where: { id } });
  return true;
}
