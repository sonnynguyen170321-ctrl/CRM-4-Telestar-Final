import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { composedStatus } from '@/lib/email/composedSend';
import { composeRateLimit } from '@/lib/compose/rateLimit';

/**
 * The slim status the composer's toast follows after a send (queued -> sent / deferred / failed,
 * with a plain reason). Own message only: the row must have been written by the caller, in their
 * tenant - anyone else's id is a 404, not a 403, so ids cannot be probed.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;
  const limited = await composeRateLimit('status', user.id);
  if (limited) return limited;

  const { id } = await params;
  const status = await composedStatus(user, id);
  if (!status) return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  return NextResponse.json(status);
}
