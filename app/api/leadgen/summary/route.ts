import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';
import { getLeadgenSummary } from '@/lib/leadgen/summary';

export const dynamic = 'force-dynamic';

/** The Leadgen page's headline numbers over the caller's lead scope (lib/leadgen/summary.ts). */
export async function GET() {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;
  if (!user.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 403 });

  try {
    return NextResponse.json(await getLeadgenSummary(user));
  } catch (err) {
    return handleApiError('GET /api/leadgen/summary', err);
  }
}
