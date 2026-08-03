import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isAutosendEnabled, isDryRun } from '@/lib/emailSafety';

/**
 * These guards are the last thing standing between a misconfigured deploy and real
 * mail landing in real prospects' inboxes, so the unset and malformed cases matter
 * more than the happy path. Both previously failed open.
 */
describe('email safety kill switches', () => {
  const original = {
    autosend: process.env.SEQUENCE_AUTOSEND_ENABLED,
    dryRun: process.env.EMAIL_SEND_DRY_RUN,
  };

  beforeEach(() => {
    delete process.env.SEQUENCE_AUTOSEND_ENABLED;
    delete process.env.EMAIL_SEND_DRY_RUN;
  });

  afterEach(() => {
    if (original.autosend === undefined) delete process.env.SEQUENCE_AUTOSEND_ENABLED;
    else process.env.SEQUENCE_AUTOSEND_ENABLED = original.autosend;
    if (original.dryRun === undefined) delete process.env.EMAIL_SEND_DRY_RUN;
    else process.env.EMAIL_SEND_DRY_RUN = original.dryRun;
  });

  describe('isAutosendEnabled', () => {
    it('returns false when the variable is unset', () => {
      expect(isAutosendEnabled()).toBe(false);
    });

    it('returns true only for an explicit "true"', () => {
      process.env.SEQUENCE_AUTOSEND_ENABLED = 'true';
      expect(isAutosendEnabled()).toBe(true);
    });

    it('accepts surrounding whitespace and mixed case', () => {
      process.env.SEQUENCE_AUTOSEND_ENABLED = '  TRUE  ';
      expect(isAutosendEnabled()).toBe(true);
    });

    it.each(['', 'false', 'False', '0', 'no', 'off', 'yes', '1', 'enabled', 'ture'])(
      'stays disabled for %j',
      (value) => {
        process.env.SEQUENCE_AUTOSEND_ENABLED = value;
        expect(isAutosendEnabled()).toBe(false);
      }
    );
  });

  describe('isDryRun', () => {
    it('returns true when the variable is unset, so a forgotten env var cannot send', () => {
      expect(isDryRun()).toBe(true);
    });

    it('returns false only for an explicit "false"', () => {
      process.env.EMAIL_SEND_DRY_RUN = 'false';
      expect(isDryRun()).toBe(false);
    });

    it('accepts surrounding whitespace and mixed case', () => {
      process.env.EMAIL_SEND_DRY_RUN = '  FALSE  ';
      expect(isDryRun()).toBe(false);
    });

    it.each(['', 'true', 'True', '0', '1', 'no', 'off', 'disabled', 'flase'])(
      'stays in dry-run for %j',
      (value) => {
        process.env.EMAIL_SEND_DRY_RUN = value;
        expect(isDryRun()).toBe(true);
      }
    );
  });

  it('defaults to the safe posture with a completely empty environment', () => {
    expect(isAutosendEnabled()).toBe(false);
    expect(isDryRun()).toBe(true);
  });
});
