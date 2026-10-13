/** The composer's send-control rules that need no database: timing, quick picks, tracking, checklist, wording. */
import { vi, describe, it, expect } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));

import { buildSchedulePicks, msUntilDue, resolveSendTiming, resolveTracking } from '@/lib/email/sendControls';
import { buildChecklist } from '@/lib/email/preflight';
import { describeDelivery } from '@/lib/inbox/deliveryStatus';
import { outboundPhase } from '@/lib/email/composedSend';
import { getLocalTime } from '@/lib/automation/timezone';

const NOW = new Date('2026-10-14T03:00:00Z'); // Wednesday 10:00 in Ho Chi Minh

describe('resolveSendTiming', () => {
  it('sends now, after an undo window, or at a time', () => {
    expect(resolveSendTiming({ now: NOW })).toEqual({ ok: true, timing: { kind: 'now', delayMs: 0, scheduledFor: null } });
    expect(resolveSendTiming({ now: NOW, delaySeconds: 10 })).toMatchObject({ ok: true, timing: { kind: 'undo', delayMs: 10_000 } });
    expect(resolveSendTiming({ now: NOW, delaySeconds: 999 })).toMatchObject({ timing: { delayMs: 30_000 } });
    const at = new Date(NOW.getTime() + 3_600_000);
    expect(resolveSendTiming({ now: NOW, scheduledFor: at.toISOString() })).toMatchObject({ ok: true, timing: { kind: 'scheduled', delayMs: 3_600_000 } });
  });

  it('refuses a past, too-near, too-far or invalid time', () => {
    for (const scheduledFor of ['2020-01-01T00:00:00Z', new Date(NOW.getTime() + 30_000).toISOString(), new Date(NOW.getTime() + 91 * 86_400_000).toISOString(), 'soon']) {
      expect(resolveSendTiming({ now: NOW, scheduledFor }).ok).toBe(false);
    }
  });
});

describe('msUntilDue', () => {
  it('is 0 for no schedule, a due one, or clock skew, and the wait for a future one', () => {
    expect(msUntilDue(null)).toBe(0);
    expect(msUntilDue(new Date(NOW.getTime() - 5000), NOW)).toBe(0);
    expect(msUntilDue(new Date(NOW.getTime() + 500), NOW)).toBe(0);
    expect(msUntilDue(new Date(NOW.getTime() + 60_000), NOW)).toBe(60_000);
  });
});

describe('resolveTracking', () => {
  it('the composer decision wins; otherwise the cadence; otherwise untracked', () => {
    expect(resolveTracking({ trackOpens: true, trackClicks: false }, { trackOpens: false, trackClicks: true })).toEqual({ opens: true, clicks: false });
    expect(resolveTracking({ trackOpens: null, trackClicks: null }, { trackOpens: true, trackClicks: true })).toEqual({ opens: true, clicks: true });
    expect(resolveTracking({ trackOpens: null, trackClicks: null }, null)).toEqual({ opens: false, clicks: false });
  });
});

describe('buildSchedulePicks', () => {
  it('offers tomorrow 8am and Monday 9am in the lead\'s time and the rep\'s', () => {
    const picks = buildSchedulePicks({ now: NOW, leadTimezone: 'America/New_York', myTimezone: 'Asia/Ho_Chi_Minh' });
    const byId = Object.fromEntries(picks.map((p) => [p.id, p]));
    const tomorrowLead = getLocalTime(byId['tomorrow-lead'].at, 'America/New_York');
    expect([tomorrowLead.hour, tomorrowLead.minute]).toEqual([8, 0]);
    const mondayMe = getLocalTime(byId['monday-me'].at, 'Asia/Ho_Chi_Minh');
    expect([mondayMe.dayOfWeek, mondayMe.hour]).toEqual([1, 9]);
    expect(picks.every((p) => p.at.getTime() > NOW.getTime())).toBe(true);
    expect(byId['in-1h'].at.getTime() - NOW.getTime()).toBe(3_600_000);
  });

  it('uses only the rep\'s zone when the lead has none or the same one', () => {
    const picks = buildSchedulePicks({ now: NOW, leadTimezone: null, myTimezone: 'Asia/Ho_Chi_Minh' });
    expect(picks.map((p) => p.id)).toEqual(['tomorrow-me', 'monday-me', 'in-1h']);
    expect(buildSchedulePicks({ now: NOW, leadTimezone: 'Asia/Ho_Chi_Minh', myTimezone: 'Asia/Ho_Chi_Minh' }).filter((p) => p.id.startsWith('tomorrow'))).toHaveLength(1);
  });
});

describe('buildChecklist', () => {
  const base = {
    recipientEmail: 'a@b.test', recipientRefusal: null, mailboxRefusal: null, mailboxEmail: 'me@t.test', healthLevel: null,
    quota: { dailyRemaining: 50, dailyCap: 80, hourlyRemaining: null, hourlyCap: 0 }, missingFields: [], bulk: false, body: 'Hi',
  };
  const sev = (r: ReturnType<typeof buildChecklist>, id: string) => r.items.find((i) => i.id === id)?.severity;

  it('is clear when nothing is wrong', () => {
    const r = buildChecklist(base);
    expect(r.canSend).toBe(true);
    expect(r.items.every((i) => i.severity === 'ok')).toBe(true);
  });

  it('blocks on a refused recipient or mailbox, and only warns for the rest', () => {
    expect(buildChecklist({ ...base, recipientRefusal: { error: 'Recipient is suppressed' } }).canSend).toBe(false);
    expect(buildChecklist({ ...base, mailboxRefusal: { error: 'paused' } }).canSend).toBe(false);
    const warned = buildChecklist({ ...base, healthLevel: 'critical', missingFields: ['title'], quota: { ...base.quota, dailyRemaining: 0 }, bulk: true });
    expect(warned.canSend).toBe(true);
    expect(['mailbox', 'variables', 'quota', 'unsubscribe'].map((id) => sev(warned, id))).toEqual(['warn', 'warn', 'warn', 'warn']);
  });

  it('flags a low and an hourly-exhausted quota, and accepts an unsubscribe link', () => {
    expect(sev(buildChecklist({ ...base, quota: { ...base.quota, dailyRemaining: 3 } }), 'quota')).toBe('warn');
    expect(sev(buildChecklist({ ...base, quota: { ...base.quota, hourlyRemaining: 0, hourlyCap: 20 } }), 'quota')).toBe('warn');
    expect(sev(buildChecklist({ ...base, bulk: true, body: '<a>Unsubscribe</a>' }), 'unsubscribe')).toBe('ok');
  });
});

describe('wording', () => {
  it('names scheduled and cancelled messages', () => {
    const later = new Date(Date.now() + 86_400_000);
    expect(describeDelivery('pending', null, later)?.label).toBe('Scheduled');
    expect(describeDelivery('pending', null, null)?.label).toBe('Queued');
    expect(describeDelivery('cancelled', null)?.label).toBe('Cancelled');
  });

  it('maps a stored row to the phase the toast shows', () => {
    const later = new Date(Date.now() + 86_400_000);
    expect(outboundPhase('pending', null, null)).toBe('queued');
    expect(outboundPhase('pending', null, later)).toBe('scheduled');
    expect(outboundPhase('pending', 'Daily send limit reached — deferred to 2026-10-15T01:00:00.000Z', null)).toBe('deferred');
    expect(outboundPhase('sending', null, null)).toBe('sending');
    expect(outboundPhase('sent', null, null)).toBe('sent');
    expect(outboundPhase('cancelled', null, null)).toBe('cancelled');
    expect(outboundPhase('permanently_failed', 'x', null)).toBe('failed');
  });
});
