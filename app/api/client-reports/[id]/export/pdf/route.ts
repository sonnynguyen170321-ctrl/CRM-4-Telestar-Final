import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { canViewClientReport, getClientReportScope } from '@/lib/client-reports/access';
import { handleApiError } from '@/lib/api/errors';
import { exportReportToHTML } from '@/lib/client-reports/exporters';
import { ClientReportSnapshot } from '@/lib/client-reports/types';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;

  const user = userOrRes as SessionUser;
  const { id } = await params;

  try {
    const report = await prisma.clientReport.findUnique({
      where: { id },
      select: {
        snapshotJson: true,
        campaignId: true,
        generatedById: true,
        tenantId: true,
        status: true,
        approvedAt: true,
        approvedBy: { select: { firstName: true, lastName: true, email: true } },
        client: { select: { name: true } },
      },
    });

    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    // This route had no access check at all — same hole as the CSV export.
    if (!canViewClientReport(user, report, await getClientReportScope(user))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const snapshot = report.snapshotJson as unknown as ClientReportSnapshot;
    // Real approval state, not a hardcoded "Approved" — a draft must export as a draft.
    const htmlContent = exportReportToHTML(snapshot, {
      status: report.status,
      approvedByName: report.approvedBy
        ? [report.approvedBy.firstName, report.approvedBy.lastName].filter(Boolean).join(' ') ||
          report.approvedBy.email.split('@')[0]
        : null,
      approvedAt: report.approvedAt,
    });

    return new NextResponse(htmlContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    });
  } catch (error) {
    return handleApiError('Failed to export PDF/HTML', error);
  }
}
