/**
 * Who is supposed to act on the step in front of you.
 *
 * The enrollments table showed ACTIVE, a "Next Task Due" timestamp and a green Run button for
 * every row, including 116 whose current step was a LinkedIn message. A LinkedIn step is a human
 * step — `workers/sequence.ts:249` answers `manual_action_required` and does nothing — so the
 * operator watched a due date pass on a row the machine was never going to touch and concluded
 * the sequence engine was broken. It was not; the screen was.
 *
 * The rule has exactly one source of truth: the worker sends only `type === 'email'`.
 */
import { describe, expect, it } from 'vitest';

import { stepOwnership } from '@/lib/sequences/stepOwnership';

describe('stepOwnership', () => {
  it('calls an email step automated — the only kind the worker sends', () => {
    const step = stepOwnership('email');
    expect(step.owner).toBe('machine');
    expect(step.canRunNow).toBe(true);
  });

  // The label is what the operator reads, so it uses the channel's ordinary name rather than the
  // database's value for it — `phone` is a call.
  for (const [channel, label] of [['linkedin', 'LinkedIn'], ['phone', 'Call'], ['whatsapp', 'WhatsApp']]) {
    it(`calls a ${channel} step a human step, labelled ${label}`, () => {
      const step = stepOwnership(channel);
      expect(step.owner).toBe('human');
      expect(step.canRunNow, 'Run Now cannot execute a step the worker refuses').toBe(false);
      expect(step.label).toBe(`${label} - you`);
    });
  }

  it('explains why Run Now is unavailable, in words an operator can act on', () => {
    const step = stepOwnership('linkedin');
    expect(step.reason).toMatch(/by hand|manually|you/i);
    expect(step.reason).not.toMatch(/error|failed|broken/i);
  });

  it('treats an unknown channel as a human step rather than promising to send it', () => {
    // Fail safe: a channel this build has never heard of is not one the worker can send.
    expect(stepOwnership('carrier-pigeon').owner).toBe('human');
    expect(stepOwnership(null).owner).toBe('human');
    expect(stepOwnership(undefined).owner).toBe('human');
  });

  it('says nothing is due when there is no pending task', () => {
    const step = stepOwnership(null);
    expect(step.canRunNow).toBe(false);
  });
});
