import { prisma } from '@/lib/prisma';
import { ClientReportSnapshot, ReportAudience } from './types';

export function mergeNarrativeIntoSnapshot(
  snapshot: ClientReportSnapshot,
  narrative: {
    summary?: string | null;
    keyWins?: string[];
    blockers?: string[];
    recommendations?: string[];
    clientActions?: string[];
    audience?: ReportAudience;
  }
): ClientReportSnapshot {
  return {
    ...snapshot,
    meta: {
      ...snapshot.meta,
      audience: narrative.audience ?? snapshot.meta.audience,
    },
    insights: {
      summary: narrative.summary ?? snapshot.insights.summary,
      keyWins: narrative.keyWins ?? snapshot.insights.keyWins,
      blockers: narrative.blockers ?? snapshot.insights.blockers,
      recommendations: narrative.recommendations ?? snapshot.insights.recommendations,
      clientActions: narrative.clientActions ?? snapshot.insights.clientActions,
    },
  };
}

export async function freezeReportSnapshot(
  reportId: string,
  approver: { id: string; name?: string | null; email: string }
): Promise<any> {
  const existing = await prisma.clientReport.findUnique({
    where: { id: reportId },
  });

  if (!existing) {
    throw new Error('Report not found');
  }

  const rawSnapshot = existing.snapshotJson as unknown as ClientReportSnapshot;
  const approverName = approver.name || approver.email.split('@')[0];

  const updatedSnapshot: ClientReportSnapshot = {
    ...rawSnapshot,
    meta: {
      ...rawSnapshot.meta,
      approvedAt: new Date().toISOString(),
      approvedByName: approverName,
    },
  };

  const updated = await prisma.clientReport.update({
    where: { id: reportId },
    data: {
      status: 'approved',
      approvedById: approver.id,
      approvedAt: new Date(),
      snapshotJson: updatedSnapshot as any,
    },
    include: {
      client: { select: { id: true, name: true } },
      campaign: { select: { id: true, name: true } },
      generatedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      approvedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  return updated;
}
