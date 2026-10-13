import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { cancelComposed } from '@/lib/email/composedSend';

/**
 * Undo send / cancel a scheduled send. A compare-and-set on `pending`: once a worker has claimed
 * the message it answers 409 `too_late`, and a repeated call on a cancelled message is a success.
 * The author, or someone who may open the lead, may cancel.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const { id } = await params;
  const result = await cancelComposed(userOrRes as SessionUser, id);
  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  return NextResponse.json({ success: true, status: result.status });
}
