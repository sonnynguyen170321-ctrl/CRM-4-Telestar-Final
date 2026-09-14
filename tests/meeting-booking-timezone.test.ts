import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { localToUtc } from '@/lib/automation/timezone';
import { convertTime } from '@/lib/time/convertTime';

/**
 * A meeting booked "at 10:00" now records whose 10:00 it was.
 *
 * The booking modal read its `datetime-local` value as the browser's zone and sent no timezone,
 * so the stored instant depended on where the rep's laptop happened to be and the meeting row
 * could not say which zone the time was meant in. The modal now interprets the value in an
 * explicit zone (prospect's, then the rep's) through the same `localToUtc` the sequence engine
 * uses, sends that zone, and shows both sides before the invitation goes out.
 */
describe('booking in the prospect\'s zone', () => {
  it('10:00 Singapore is 02:00Z, whatever the browser\'s zone', () => {
    // The exact arithmetic the modal performs on submit.
    const [datePart, timePart] = '2026-09-16T10:00'.split('T');
    const [y, m, d] = datePart.split('-').map(Number);
    const [hh, mm] = timePart.split(':').map(Number);
    expect(localToUtc(y, m, d, hh, mm, 'Asia/Singapore').toISOString()).toBe('2026-09-16T02:00:00.000Z');
  });

  it('shows the rep the same slot in their own zone', () => {
    const [sg, hcm] = convertTime({ date: '2026-09-16', hour: 10, minute: 0, fromZone: 'Asia/Singapore', toZones: ['Asia/Singapore', 'Asia/Ho_Chi_Minh'] });
    expect(sg.localTime).toBe('10:00');
    expect(hcm.localTime).toBe('09:00');
    expect(hcm.dayShift).toBe(0);
  });

  it('the modal sends the zone and no longer trusts the browser clock', () => {
    const src = readFileSync('components/meetings/MeetingBookingModal.tsx', 'utf8');
    expect(src).not.toContain('new Date(scheduledAt).toISOString()');
    expect(src).toMatch(/payload\.timezone = effectiveZone/);
    expect(src).toMatch(/localToUtc\(y, m, d, hh, mm, effectiveZone\)/);
    expect(src).toContain('<MeetingTimePreview');
  });

  it('the lead panel hands the modal the prospect\'s zone, inferred when unconfirmed', () => {
    const src = readFileSync('components/LeadDetailPanel.tsx', 'utf8');
    expect(src).toMatch(/leadTimezone=\{lead\.timezone \?\? inferTimezone\(/);
  });
});
