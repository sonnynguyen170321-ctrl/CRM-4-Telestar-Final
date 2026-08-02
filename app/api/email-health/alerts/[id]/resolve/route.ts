import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { transitionAlert } from '@/lib/email-health/alertActions';

export const dynamic = 'force-dynamic';

/**
 * Marks an alert resolved. Note the hourly cron also auto-resolves alerts whose
 * condition has cleared, so manual resolution is for judgement calls.
 */
export async function PATCH(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id } = await params;
  return transitionAlert(user, id, 'resolved', 'api/email-health/alerts/[id]/resolve PATCH');
}
