import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireInteractiveUser, requireAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';
import { recordCallOutcome } from '@/lib/telephony/callOutcome';
import { NOTES_MAX, PHONE_OUTCOME_IDS } from '@/lib/telephony/outcomes';
import { id, parseBody } from '@/lib/validation/core';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

const outcomeSchema = z.object({
  outcome: z.enum(PHONE_OUTCOME_IDS),
  notes: z
    .string()
    .max(NOTES_MAX * 2)
    .optional()
    .transform((value) => (value ?? '').trim().slice(0, NOTES_MAX)),
});

/**
 * Wrap-up for a softphone call: what happened, chosen after hangup (docs/dialer/TASKS.md D5.3).
 *
 * Only the rep's own call, in their own tenant, within 24 hours of the attempt, and only once the
 * call reached the provider. Anything else answers 404 (not yours or not there) or 409. The browser
 * cannot mark a call successful here: this sets the outcome and notes, never the status. A
 * do-not-call outcome flags the lead and contact and adds the number to the tenant's suppression
 * list in the same transaction. API keys are refused.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;
  const keyRefusal = requireInteractiveUser(user);
  if (keyRefusal) return keyRefusal;
  if (!user.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 403, headers: NO_STORE });

  const callId = id.safeParse((await params).id);
  if (!callId.success) return NextResponse.json({ error: 'Call not found', code: 'not_found' }, { status: 404, headers: NO_STORE });

  const parsed = await parseBody(req, outcomeSchema, 'Invalid call outcome');
  if (parsed.error) return parsed.error;

  try {
    const result = await recordCallOutcome({
      user: { ...user, tenantId: user.tenantId },
      callId: callId.data,
      outcome: parsed.data.outcome,
      notes: parsed.data.notes,
    });
    if (result.ok) {
      return NextResponse.json({ callId: result.callId, outcome: result.outcome, suppressed: result.suppressed }, { headers: NO_STORE });
    }
    if (result.reason === 'not_found') return NextResponse.json({ error: 'Call not found', code: 'not_found' }, { status: 404, headers: NO_STORE });
    if (result.reason === 'window_closed') {
      return NextResponse.json({ error: 'This call is more than 24 hours old, so its outcome can no longer be set', code: 'window_closed' }, { status: 409, headers: NO_STORE });
    }
    return NextResponse.json({ error: 'This call has not started, so it has no outcome yet', code: 'call_not_started' }, { status: 409, headers: NO_STORE });
  } catch (error) {
    return handleApiError('api/telephony/calls/[id]/outcome PATCH', error);
  }
}
