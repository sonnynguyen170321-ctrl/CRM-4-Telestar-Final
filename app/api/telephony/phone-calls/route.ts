import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { canAccessLead, requireAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';
import { NOTES_MAX, PHONE_OUTCOME_IDS } from '@/lib/telephony/outcomes';
import { PhoneCallForbiddenError, PhoneCallLeadNotFoundError, recordPhoneCall } from '@/lib/telephony/phoneCallLog';
import { id, parseBody } from '@/lib/validation/core';

export const dynamic = 'force-dynamic';

const phoneCallSchema = z.object({
  leadId: id,
  outcome: z.enum(PHONE_OUTCOME_IDS),
  notes: z
    .string()
    .max(NOTES_MAX * 2)
    .optional()
    .transform((value) => (value ?? '').trim().slice(0, NOTES_MAX)),
});

/**
 * Log a call the rep placed on their own phone (Vietnam, and anything until the browser dialer is
 * live). One request, one transaction: the activity, last-contacted date, queue tag, callback task
 * and, for do-not-call, the lead flag and phone suppression. Tenant comes from the session; a lead
 * the rep cannot work answers like one that does not exist in their tenant.
 */
export async function POST(req: NextRequest) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;
  if (!user.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 403 });

  const parsed = await parseBody(req, phoneCallSchema, 'Invalid phone call');
  if (parsed.error) return parsed.error;

  try {
    const result = await recordPhoneCall({
      user: { ...user, tenantId: user.tenantId },
      leadId: parsed.data.leadId,
      outcome: parsed.data.outcome,
      notes: parsed.data.notes,
      canAccess: (lead) => canAccessLead(user, lead),
    });
    return NextResponse.json({ activity: result.activity, suppressed: result.suppressed }, { status: 201 });
  } catch (error) {
    if (error instanceof PhoneCallLeadNotFoundError) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    if (error instanceof PhoneCallForbiddenError) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return handleApiError('api/telephony/phone-calls POST', error);
  }
}
