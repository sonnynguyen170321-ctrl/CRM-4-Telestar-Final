import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';
import { buildAiConsole } from '@/lib/console/aiConsole';

/** The operating-model board (Phase 9). Read-only; scoping is the CRM's own pod walk. */
export async function GET() {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    return NextResponse.json(await buildAiConsole(user));
  } catch (err) {
    return handleApiError('api/ai/console GET', err);
  }
}
