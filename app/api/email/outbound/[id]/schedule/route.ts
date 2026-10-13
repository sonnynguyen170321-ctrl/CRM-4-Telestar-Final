import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { rescheduleComposed } from '@/lib/email/composedSend';

const scheduleSchema = z.object({ scheduledFor: z.string().min(1).max(40) });

/** Edit the time of a scheduled send (still waiting): moves its job and its row together. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const parsed = scheduleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Give a scheduledFor time' }, { status: 400 });
  const { id } = await params;
  const result = await rescheduleComposed(userOrRes as SessionUser, id, parsed.data.scheduledFor);
  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  return NextResponse.json({ success: true, scheduledFor: result.scheduledFor });
}
