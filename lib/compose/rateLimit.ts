import { NextResponse } from 'next/server';
import { consumeAttempt } from '@/lib/security/attemptLimit';

/**
 * Per-user rate limits for the composer's routes. Fixed windows on the shared Redis limiter, which
 * fails open on an outage (an outage must not stop reps writing email). Returns the 429 to answer
 * with, or null when the call may proceed.
 */
export const COMPOSE_LIMITS = {
  upload: { limit: 60, windowSeconds: 10 * 60 },
  preview: { limit: 120, windowSeconds: 10 * 60 },
  snippetCreate: { limit: 30, windowSeconds: 24 * 60 * 60 },
  // The composer polls a send's status for a few seconds and autosaves while typing.
  status: { limit: 600, windowSeconds: 10 * 60 },
  draft: { limit: 600, windowSeconds: 10 * 60 },
  checklist: { limit: 120, windowSeconds: 10 * 60 },
  // A test send is a real email from a real mailbox: few, and per user.
  testSend: { limit: 10, windowSeconds: 10 * 60 },
} as const;

export async function composeRateLimit(bucket: keyof typeof COMPOSE_LIMITS, userId: string): Promise<NextResponse | null> {
  const { limit, windowSeconds } = COMPOSE_LIMITS[bucket];
  const decision = await consumeAttempt({ bucket: `compose-${bucket}`, subject: userId, limit, windowSeconds });
  if (decision.allowed) return null;
  return NextResponse.json(
    { error: 'Too many requests. Wait a moment and try again.' },
    { status: 429, headers: { 'Retry-After': String(decision.retryAfterSeconds) } },
  );
}
