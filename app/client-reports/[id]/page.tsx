import React from 'react';
import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canViewClientReport } from '@/lib/client-reports/access';
import ClientReportDetail from '@/components/client-reports/ClientReportDetail';
import { ClientReportSnapshot } from '@/lib/client-reports/types';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ClientReportDetailPage({ params }: PageProps) {
  const user = await getSessionUser();
  if (!user) {
    redirect('/login');
  }

  const { id } = await params;

  const report = await prisma.clientReport.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true } },
      campaign: { select: { id: true, name: true } },
      generatedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      approvedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  if (!report) {
    notFound();
  }

  if (!canViewClientReport(user, report)) {
    redirect('/client-reports');
  }

  const serializedReport = {
    ...report,
    generatedBy: {
      id: report.generatedBy.id,
      name: [report.generatedBy.firstName, report.generatedBy.lastName].filter(Boolean).join(' ') || report.generatedBy.email.split('@')[0],
      email: report.generatedBy.email,
    },
    approvedBy: report.approvedBy
      ? {
          id: report.approvedBy.id,
          name: [report.approvedBy.firstName, report.approvedBy.lastName].filter(Boolean).join(' ') || report.approvedBy.email.split('@')[0],
          email: report.approvedBy.email,
        }
      : null,
    periodStart: report.periodStart.toISOString(),
    periodEnd: report.periodEnd.toISOString(),
    approvedAt: report.approvedAt?.toISOString() || null,
    sharedAt: report.sharedAt?.toISOString() || null,
    archivedAt: report.archivedAt?.toISOString() || null,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
    snapshotJson: report.snapshotJson as unknown as ClientReportSnapshot,
  };

  return (
    <div className="min-h-screen bg-bg-main p-6">
      <ClientReportDetail report={serializedReport} currentUserRole={user.role} />
    </div>
  );
}
