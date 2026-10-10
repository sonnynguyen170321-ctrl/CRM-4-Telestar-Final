import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CallOutcome } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { PHONE_OUTCOMES, getPhoneOutcome, outcomeLeadTag } from '@/lib/telephony/outcomes';

describe('the one outcome list', () => {
  it('maps every outcome to a value of the Prisma CallOutcome enum', () => {
    const enumValues = new Set(Object.values(CallOutcome));
    for (const outcome of PHONE_OUTCOMES) expect(enumValues.has(outcome.callOutcome as never), outcome.id).toBe(true);
  });

  it('maps no two outcomes to the same enum value', () => {
    const mapped = PHONE_OUTCOMES.map((outcome) => outcome.callOutcome);
    expect(new Set(mapped).size).toBe(mapped.length);
  });

  it('keeps the nine ids of the dashboard task modal', () => {
    const page = readFileSync(join(process.cwd(), 'app', 'page.tsx'), 'utf8');
    const dashboardIds = new Set([...page.matchAll(/setCallOutcome\('([a-z_]+)'\)/g)].map((m) => m[1]));
    expect(new Set(PHONE_OUTCOMES.map((o) => o.id))).toEqual(dashboardIds);
  });

  it('gives the lead effects: do-not-call, wrong number, callback, meeting', () => {
    expect(getPhoneOutcome('do_not_call')?.leadEffect).toBe('do_not_call');
    expect(getPhoneOutcome('wrong_number')?.leadEffect).toBe('wrong_number');
    expect(getPhoneOutcome('callback_requested')?.leadEffect).toBe('callback');
    expect(getPhoneOutcome('connected_meeting_booked')).toMatchObject({ leadEffect: 'meeting', callOutcome: 'meeting_booked' });
    expect(getPhoneOutcome('no_answer')?.leadEffect).toBeNull();
    expect(outcomeLeadTag('do_not_call')).toBe('do_not_call');
    expect(outcomeLeadTag('callback_requested')).toBeNull();
    expect(getPhoneOutcome('gatekeeper_rejection')).toBeUndefined();
  });
});
