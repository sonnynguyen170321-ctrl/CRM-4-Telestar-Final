import { prisma } from '@/lib/prisma';
import { Prisma, type ContactEvidence } from '@prisma/client';
import type { CreateEvidenceInput } from './types';

export async function emitContactEvidence(input: CreateEvidenceInput): Promise<ContactEvidence> {
  const observedAt = input.observedAt ?? new Date();

  return await prisma.contactEvidence.create({
    data: {
      tenantId: input.tenantId,
      contactId: input.contactId,
      evidenceType: input.evidenceType,
      key: input.key,
      valueJson: (input.valueJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      summary: input.summary ?? null,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      sourceModel: input.sourceModel ?? null,
      clientId: input.clientId ?? null,
      campaignId: input.campaignId ?? null,
      leadId: input.leadId ?? null,
      meetingId: input.meetingId ?? null,
      opportunityId: input.opportunityId ?? null,
      activityId: input.activityId ?? null,
      capturedById: input.capturedById ?? null,
      confidence: input.confidence ?? 100,
      humanConfirmed: input.humanConfirmed ?? false,
      aiGenerated: input.aiGenerated ?? false,
      ownershipScope: input.ownershipScope ?? 'telestar',
      reuseScope: input.reuseScope ?? 'cross_campaign_allowed',
      observedAt,
      validFrom: input.validFrom ?? null,
      validUntil: input.validUntil ?? null,
      supersedesId: input.supersedesId ?? null,
    },
  });
}

export async function getContactEvidenceLedger(contactId: string, tenantId: string): Promise<ContactEvidence[]> {
  return await prisma.contactEvidence.findMany({
    where: {
      contactId,
      tenantId,
    },
    orderBy: {
      observedAt: 'desc',
    },
  });
}
