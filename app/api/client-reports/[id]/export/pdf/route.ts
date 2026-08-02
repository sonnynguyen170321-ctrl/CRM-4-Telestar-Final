import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';
import { exportReportToHTML } from '@/lib/client-reports/exporters';
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
    const htmlContent = exportReportToHTML(snapshot);

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
