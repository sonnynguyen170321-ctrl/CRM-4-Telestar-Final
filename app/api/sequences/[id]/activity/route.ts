import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { getSequenceActivity } from '@/lib/sequences/activity';

/**
 * What happened to one sequence: edits (AuditLog) and cadence events (Activity), newest first
 * (lib/sequences/activity.ts). Cadence events name leads, so a rep sees only those for leads they
 * can see; a manager sees the whole cadence.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;
  if (!user.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 403 });

  const { id } = await params;
  const items = await getSequenceActivity({ user, tenantId: user.tenantId, sequenceId: id });
  if (!items) return NextResponse.json({ error: 'Sequence not found' }, { status: 404 });
  return NextResponse.json({ items });
}
