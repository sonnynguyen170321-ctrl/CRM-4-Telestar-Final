import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { callDescription, DESCRIPTION_MAX, dialWarning, logPhoneCall, phoneCallTarget } from '@/lib/telephony/logPhoneCall';
import { isPhoneOutcomeId, outcomeLeadTag, PHONE_OUTCOMES, telUri } from '@/lib/telephony/phoneOutcomes';

/**
 * Calling a lead from your own phone and logging it (owner, 2026-10-08: "for Vietnam, reps call on
 * their phone and log it"). Until the browser dialer is live this is the Call button for every
 * lead: the number, a QR code a phone scans to dial, and the same required outcome as the task
 * Call Logging modal, with the same effects.
 */

describe('the outcomes', () => {
  it('are the nine of the task Call Logging modal, with the same ids', () => {
    const page = readFileSync(join(process.cwd(), 'app', 'page.tsx'), 'utf8');
    const dashboardIds = new Set([...page.matchAll(/setCallOutcome\('([a-z_]+)'\)/g)].map((m) => m[1]));
    expect(new Set(PHONE_OUTCOMES.map((o) => o.id))).toEqual(dashboardIds);
  });

  it('tag the lead out of the queue for do-not-call and wrong number only', () => {
    expect(outcomeLeadTag('do_not_call')).toBe('do_not_call');
    expect(outcomeLeadTag('wrong_number')).toBe('wrong_number');
    expect(outcomeLeadTag('no_answer')).toBeNull();
    expect(isPhoneOutcomeId('gatekeeper_rejection')).toBe(false);
  });
});

describe('the number to dial', () => {
  it('reads a Vietnamese national number as +84', () => {
    expect(phoneCallTarget('0948 200 638', 'Vietnam')).toEqual({ e164: '+84948200638', country: 'VN', isVietnam: true });
  });

  it('still reads a Vietnamese number on a lead whose company is abroad', () => {
    expect(phoneCallTarget('0948200638', 'Singapore')).toMatchObject({ e164: '+84948200638', isVietnam: true });
  });

  it('reads a foreign number with its own country', () => {
    expect(phoneCallTarget('+1 415 555 2671', 'United States')).toEqual({ e164: '+14155552671', country: 'US', isVietnam: false });
  });

  it('gives no number for something that is not one', () => {
    expect(phoneCallTarget('call reception', null)).toEqual({ e164: null, country: null, isVietnam: false });
  });

  it('builds the QR link from E.164 only', () => {
    expect(telUri('+84948200638')).toBe('tel:+84948200638');
    expect(() => telUri('0948200638')).toThrow();
    expect(() => telUri('+84 948 200 638')).toThrow();
  });
});

describe('logging the call', () => {
  const lead = { id: 'lead-1', firstName: 'Linh', lastName: 'Tran' };
  const ok = (body: unknown = {}) => new Response(JSON.stringify(body), { status: 201 });

  // The server writes the activity, last-contacted date, callback task, tag and suppression in one
  // transaction (tests/telephony-phone-calls-route.test.ts); the browser sends one request.
  it('sends one request with the lead, the outcome and the trimmed notes', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok());

    const result = await logPhoneCall({ lead, outcome: 'connected_interested', notes: ' Wants pricing ', fetchImpl });

    const activity = { action: 'connected_interested', outcome: 'connected_interested', label: 'Interested', notes: 'Wants pricing' };
    expect(result).toEqual({ ok: true, warnings: [], activity });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/telephony/phone-calls');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ leadId: 'lead-1', outcome: 'connected_interested', notes: 'Wants pricing' });
  });

  it('never reads or rewrites the lead’s tags from the browser', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ suppressed: true }));

    await logPhoneCall({ lead, outcome: 'do_not_call', notes: '', fetchImpl });

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual(['/api/telephony/phone-calls']);
  });

  it('builds the description under the activity limit', () => {
    expect(callDescription('No Answer', '')).toBe('Call logged. Outcome: No Answer');
    expect(callDescription('No Answer', 'x'.repeat(900)).length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  // An unlisted number is called again by someone else.
  it('warns when a do-not-call number could not be added to the list', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ suppressed: false }));

    const result = await logPhoneCall({ lead, outcome: 'do_not_call', notes: '', fetchImpl });

    expect(result).toMatchObject({ ok: true, warnings: [expect.stringContaining('do-not-call list')] });
  });

  it('stops, with the server’s reason, when the call itself was not logged', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Lead not found' }), { status: 404 }));

    const result = await logPhoneCall({ lead, outcome: 'callback_requested', notes: '', fetchImpl });

    expect(result).toEqual({ ok: false, error: 'Lead not found' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('the lead drawer', () => {
  const panel = readFileSync(join(process.cwd(), 'components', 'LeadDetailPanel.tsx'), 'utf8');

  it('opens the phone panel, and no longer the shared-password SIP dialer', () => {
    expect(panel).toContain("import('@/components/dialer/PhoneCallPanel')");
    expect(panel).not.toContain('CallDialerModal');
    expect(panel).not.toContain('/api/dialer/config');
  });

  it('re-reads the lead after a call is logged, so the next log builds on the server’s tags', () => {
    expect(panel).toMatch(/const handleCallLogged = [\s\S]*?reloadLead\(\);/);
  });
});

describe('a lead that must not be called', () => {
  it('blocks dialing when the lead, its contact or its tags say do not call', () => {
    expect(dialWarning({ doNotCall: true, doNotCallReason: 'asked on 3 Oct' })).toEqual({
      block: true,
      message: 'Do not call: this lead is on the do-not-call list (asked on 3 Oct).',
    });
    expect(dialWarning({ contact: { doNotCall: true } })).toMatchObject({ block: true });
    expect(dialWarning({ tags: ['vip', 'do_not_call'] })).toMatchObject({ block: true });
  });

  it('warns but still shows the number for a lead marked wrong number', () => {
    expect(dialWarning({ tags: ['wrong_number'] })).toEqual({
      block: false,
      message: 'This number was marked wrong number on an earlier call. Check it before dialing.',
    });
  });

  it('says nothing for a lead with no flag', () => {
    expect(dialWarning({ tags: ['vip'], doNotCall: false, contact: { doNotCall: false } })).toBeNull();
    expect(dialWarning({})).toBeNull();
  });
});
