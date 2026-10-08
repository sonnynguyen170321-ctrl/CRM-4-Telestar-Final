import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { logPhoneCall, phoneCallTarget } from '@/lib/telephony/logPhoneCall';
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
  const lead = { id: 'lead-1', firstName: 'Linh', lastName: 'Tran', tags: ['vip'] };
  const ok = () => new Response('{}', { status: 200 });

  it('records a call_logged activity with the outcome and notes', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok());

    const result = await logPhoneCall({ lead, outcome: 'connected_interested', notes: ' Wants pricing ', fetchImpl });

    expect(result).toEqual({ ok: true, warnings: [], activity: { action: 'connected_interested', outcome: 'Interested', notes: 'Wants pricing' } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/activities');
    expect(JSON.parse(init.body)).toMatchObject({
      leadId: 'lead-1',
      type: 'call_logged',
      channel: 'phone',
      metadata: { action: 'connected_interested', outcome: 'Interested', notes: 'Wants pricing', via: 'phone' },
    });
  });

  it('creates a callback task for 09:00 the next day', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok());

    await logPhoneCall({ lead, outcome: 'callback_requested', notes: '', fetchImpl, now: new Date(2026, 9, 8, 15, 0) });

    const [url, init] = fetchImpl.mock.calls[1];
    expect(url).toBe('/api/tasks');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ leadId: 'lead-1', type: 'phone', priority: 'high' });
    expect(new Date(body.dueDate).getTime()).toBe(new Date(2026, 9, 9, 9, 0).getTime());
  });

  it('tags the lead do_not_call, keeping its other tags', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok());

    await logPhoneCall({ lead, outcome: 'do_not_call', notes: '', fetchImpl });

    const [url, init] = fetchImpl.mock.calls[1];
    expect(url).toBe('/api/leads/lead-1');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ tags: ['vip', 'do_not_call'] });
  });

  it('does not tag a lead that already carries the tag', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok());

    await logPhoneCall({ lead: { ...lead, tags: ['wrong_number'] }, outcome: 'wrong_number', notes: '', fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // An untagged do-not-call lead goes back in the queue and is called again.
  it('reports a tag that did not save instead of claiming success quietly', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(ok()).mockResolvedValueOnce(new Response('{}', { status: 403 }));

    const result = await logPhoneCall({ lead, outcome: 'do_not_call', notes: '', fetchImpl });

    expect(result).toMatchObject({ ok: true, warnings: [expect.stringContaining('"do_not_call" tag did not save')] });
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
});
