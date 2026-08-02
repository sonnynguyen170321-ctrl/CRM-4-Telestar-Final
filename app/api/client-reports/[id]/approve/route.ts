import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';
import { canApproveClientReport } from '@/lib/client-reports/access';
import { freezeReportSnapshot } from '@/lib/client-reports/snapshot';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  if (!canApproveClientReport(user)) {
    return NextResponse.json({ error: 'Forbidden: Only Directors or Floor Managers can approve reports' }, { status: 403 });
  }

  const { id } = await params;

  try {
    const approverName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email.split('@')[0];

    const report = await freezeReportSnapshot(id, {
      id: user.id,
      name: approverName,
      email: user.email,
    });

    return NextResponse.json({ report, success: true });
  } catch (error) {
    return handleApiError('Failed to approve report', error);
  }
}
