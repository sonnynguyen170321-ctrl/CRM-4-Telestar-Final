import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';
import { exportReportToCSV } from '@/lib/client-reports/exporters';
import { ClientReportSnapshot } from '@/lib/client-reports/types';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;

  const { id } = await params;

  try {
    const report = await prisma.clientReport.findUnique({
      where: { id },
      include: {
        client: { select: { name: true } },
      },
    });

    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    const snapshot = report.snapshotJson as unknown as ClientReportSnapshot;
    const csvContent = exportReportToCSV(snapshot);

    const safeClientName = (report.client.name || 'client').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Report_${safeClientName}_${report.periodStart.toISOString().split('T')[0]}.csv`;

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return handleApiError(error, 'Failed to export CSV');
  }
}
