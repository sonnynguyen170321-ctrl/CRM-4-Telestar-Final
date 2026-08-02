import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { transitionAlert } from '@/lib/email-health/alertActions';

export const dynamic = 'force-dynamic';

/** Marks an alert acknowledged — seen by a manager, not yet fixed. */
export async function PATCH(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id } = await params;
  return transitionAlert(user, id, 'acknowledged', 'api/email-health/alerts/[id]/acknowledge PATCH');
}
