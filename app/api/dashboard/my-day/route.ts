import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';
import { getMyDay } from '@/lib/dashboard/myDay';

export const dynamic = 'force-dynamic';

/** The caller's own day: calls, emails and LinkedIn touches today, and leads in a sequence now. */
export async function GET() {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;
  if (!user.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 403 });

  try {
    return NextResponse.json(await getMyDay(user));
  } catch (err) {
    return handleApiError('GET /api/dashboard/my-day', err);
  }
}
