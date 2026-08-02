import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { parseBody } from '@/lib/validation/core';
import { previewClientReportSchema } from '@/lib/validation/schemas';
import { handleApiError } from '@/lib/api/errors';
import { buildReportMetrics } from '@/lib/client-reports/metrics';

export async function POST(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const parsed = await parseBody(req, previewClientReportSchema);
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  try {
    const userName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email.split('@')[0];

    const snapshot = await buildReportMetrics({
      clientId: body.clientId,
      campaignId: body.campaignId,
      periodStart: new Date(body.periodStart),
      periodEnd: new Date(body.periodEnd),
      audience: body.audience,
      sdrDisplayMode: body.sdrDisplayMode,
      generatedById: user.id,
      generatedByName: userName,
    });

    return NextResponse.json({ snapshot });
  } catch (error) {
    return handleApiError('Failed to generate report preview', error);
  }
}
