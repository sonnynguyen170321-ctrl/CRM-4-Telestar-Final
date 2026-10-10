import { randomUUID } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireInteractiveUser, requireAuth, type SessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { issueCallToken, toClientState, CALL_TOKEN_TTL_SECONDS } from '@/lib/telephony/authToken';
import { isTelephonyEnabled } from '@/lib/telephony/flags';
import { CallTargetNotFoundError, loadCallGate } from '@/lib/telephony/gate';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
/** One call attempt per rep in this window; a double-click must not become two calls. */
const CALL_ATTEMPT_MIN_INTERVAL_MS = 3_000;

const Body = z.object({
  leadId: z.string().min(1).max(64),
  contactId: z.string().min(1).max(64).optional(),
});

/**
 * Requests being handled per rep in this process. Two parallel requests both pass the database check
 * below before either has written its row; this stops the second one here. Across processes the
 * database check still bounds it to one call per process per window.
 */
const attemptsInFlight = new Set<string>();

const tooSoon = () =>
  NextResponse.json({ error: 'A call was just started', code: 'rate_limited' }, { status: 429, headers: { ...NO_STORE, 'Retry-After': '3' } });

const notFound = () => NextResponse.json({ error: 'Lead not found', code: 'not_found' }, { status: 404, headers: NO_STORE });

/**
 * Ask to place a call (docs/dialer/ADR-001-park-and-authorize.md).
 *
 * Runs the calling gate and records the attempt as a `Call` row either way — `authorized` with a
 * short-lived call token the softphone sends with the call, or `blocked` with every reason. The
 * provider parks the call until the webhook checks that token, so a call that skips this route
 * never connects. Dry-run records the decision as `blocked` (`dry_run`) and issues no token.
 *
 * Not written: a lead the rep may not work (answered exactly like a missing lead, so the route does
 * not reveal which leads exist or what is on them), and a record with no number that can be dialled
 * (a `Call` must name a valid E.164 destination).
 */
export async function POST(req: NextRequest) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;
  const keyRefusal = requireInteractiveUser(user);
  if (keyRefusal) return keyRefusal;
  if (!user.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 403, headers: NO_STORE });
  const tenantId = user.tenantId;

  if (!isTelephonyEnabled(tenantId)) {
    return NextResponse.json({ error: 'The dialer is not enabled', code: 'dialer_disabled' }, { status: 403, headers: NO_STORE });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'leadId is required', code: 'invalid_request' }, { status: 400, headers: NO_STORE });
  }

  const flightKey = `${tenantId}:${user.id}`;
  if (attemptsInFlight.has(flightKey)) return tooSoon();
  attemptsInFlight.add(flightKey);
  try {
    return await placeAttempt({ user: { ...user, tenantId }, leadId: parsed.data.leadId, contactId: parsed.data.contactId });
  } finally {
    attemptsInFlight.delete(flightKey);
  }
}

async function placeAttempt(input: { user: SessionUser & { tenantId: string }; leadId: string; contactId?: string }) {
  const { user } = input;
  const { tenantId } = user;
  const now = new Date();

  const recent = await prisma.call.findFirst({
    where: { tenantId, userId: user.id, direction: 'outbound', createdAt: { gt: new Date(now.getTime() - CALL_ATTEMPT_MIN_INTERVAL_MS) } },
    select: { id: true },
  });
  if (recent) return tooSoon();

  let gate;
  try {
    gate = await loadCallGate({ user, leadId: input.leadId, contactId: input.contactId, now });
  } catch (error) {
    if (error instanceof CallTargetNotFoundError) return notFound();
    throw error;
  }
  const { decision } = gate;

  if (decision.reasons.includes('lead_access_denied')) {
    console.warn('[telephony] call refused: lead not accessible to this user', { tenantId, userId: user.id, leadId: gate.leadId });
    return notFound();
  }
  if (!decision.toE164) {
    return NextResponse.json(
      { error: 'This record has no number that can be called', code: 'no_dialable_number', reasons: decision.reasons },
      { status: 422, headers: NO_STORE }
    );
  }

  const authorized = decision.allowed && !decision.dryRun;
  // The id is chosen here so the token is signed before the row exists: a row is never left
  // `authorized` without a token the softphone could use.
  const callId = randomUUID();
  const token = authorized ? issueCallToken({ callId, tenantId, userId: user.id, toE164: decision.toE164 }, Math.floor(now.getTime() / 1000)) : null;

  await prisma.call.create({
    data: {
      id: callId,
      tenantId,
      direction: 'outbound',
      status: authorized ? 'authorized' : 'blocked',
      userId: user.id,
      leadId: gate.leadId,
      contactId: gate.contactId,
      toE164: decision.toE164,
      authorizedAt: authorized ? now : null,
      blockedReasons: [...decision.reasons, ...(decision.dryRun ? ['dry_run'] : [])],
      compliance: decision,
      // The gate's clock, not the database's, so the one-attempt-per-window check and the
      // snapshot agree on when this happened.
      createdAt: now,
    },
    select: { id: true },
  });

  if (!token) {
    return NextResponse.json(
      {
        callId,
        allowed: false,
        dryRun: decision.dryRun,
        wouldBeAllowed: decision.allowed,
        reasons: decision.reasons,
        localTime: decision.localTime,
        timezone: decision.timezone?.timezone ?? null,
      },
      { headers: NO_STORE }
    );
  }
  return NextResponse.json(
    {
      callId,
      allowed: true,
      toE164: decision.toE164,
      clientState: toClientState(token),
      expiresAt: new Date(now.getTime() + CALL_TOKEN_TTL_SECONDS * 1000).toISOString(),
    },
    { status: 201, headers: NO_STORE }
  );
}
