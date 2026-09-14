import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { compare, hash } from 'bcryptjs';
import { z } from 'zod';
import { parseBody } from '@/lib/validation/core';
import { consumeAttempt, clearAttempts } from '@/lib/security/attemptLimit';

/**
 * Changing your own password.
 *
 * `currentPassword` is a secret this endpoint checks, so it is guessable here — and until now it
 * was guessable without limit. Anyone with a live session (a borrowed laptop, a stolen cookie)
 * could brute-force the current password at full speed and then take the account over by changing
 * it. Login has been rate limited for a while; this sibling had nothing.
 *
 * Keyed on the user id rather than the IP: the attacker already holds this user's session, so the
 * account is the thing under attack, and an IP key would let them rotate addresses.
 */
const PASSWORD_ATTEMPT_BUCKET = 'password-change';
const PASSWORD_ATTEMPT_LIMIT = 10;
const PASSWORD_ATTEMPT_WINDOW_SECONDS = 15 * 60;

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8, 'New password must be at least 8 characters').max(200),
});

export async function POST(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const parsed = await parseBody(req, changePasswordSchema);
  if (parsed.error) return parsed.error;
  const { currentPassword, newPassword } = parsed.data;

  // Counted before the secret is checked, so a guess costs an attempt whatever the answer.
  const attempt = await consumeAttempt({
    bucket: PASSWORD_ATTEMPT_BUCKET,
    subject: user.id,
    limit: PASSWORD_ATTEMPT_LIMIT,
    windowSeconds: PASSWORD_ATTEMPT_WINDOW_SECONDS,
  });
  if (!attempt.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(attempt.retryAfterSeconds) } }
    );
  }

  const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { password: true } });
  if (!dbUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const valid = await compare(currentPassword, dbUser.password);
  if (!valid) return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 });

  const hashed = await hash(newPassword, 12);
  // Bumped in the same statement as the password, so there is no window where the new
  // password is live but sessions minted under the old one still work. Signs the user out
  // everywhere, including this browser — which is the point of changing a password.
  await prisma.user.update({
    where: { id: user.id },
    data: { password: hashed, authVersion: { increment: 1 } },
  });

  // The owner proved they know the password, so the counter has done its job.
  await clearAttempts(PASSWORD_ATTEMPT_BUCKET, user.id);

  return NextResponse.json({ success: true });
}
