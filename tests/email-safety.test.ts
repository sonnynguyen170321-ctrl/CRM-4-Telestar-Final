import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isAutosendEnabled,
  isDryRun,
  isGlobalEmailPaused,
  isCanaryMode,
  isCanaryRecipientAllowed,
} from '@/lib/emailSafety';

/**
 * These guards are the last thing standing between a misconfigured deploy and real
 * mail landing in real prospects' inboxes, so the unset and malformed cases matter
 * more than the happy path. Both previously failed open.
 */
describe('email safety kill switches', () => {
  const original = {
    autosend: process.env.SEQUENCE_AUTOSEND_ENABLED,
    dryRun: process.env.EMAIL_SEND_DRY_RUN,
    globalPause: process.env.EMAIL_GLOBAL_PAUSE,
    canaryMode: process.env.LIVE_EMAIL_CANARY_MODE,
    canaryRecipients: process.env.LIVE_EMAIL_ALLOWED_RECIPIENTS,
  };

  beforeEach(() => {
    delete process.env.SEQUENCE_AUTOSEND_ENABLED;
    delete process.env.EMAIL_SEND_DRY_RUN;
    delete process.env.EMAIL_GLOBAL_PAUSE;
    delete process.env.LIVE_EMAIL_CANARY_MODE;
    delete process.env.LIVE_EMAIL_ALLOWED_RECIPIENTS;
  });

  afterEach(() => {
    if (original.autosend === undefined) delete process.env.SEQUENCE_AUTOSEND_ENABLED;
    else process.env.SEQUENCE_AUTOSEND_ENABLED = original.autosend;
    if (original.dryRun === undefined) delete process.env.EMAIL_SEND_DRY_RUN;
    else process.env.EMAIL_SEND_DRY_RUN = original.dryRun;
    if (original.globalPause === undefined) delete process.env.EMAIL_GLOBAL_PAUSE;
    else process.env.EMAIL_GLOBAL_PAUSE = original.globalPause;
    if (original.canaryMode === undefined) delete process.env.LIVE_EMAIL_CANARY_MODE;
    else process.env.LIVE_EMAIL_CANARY_MODE = original.canaryMode;
    if (original.canaryRecipients === undefined) delete process.env.LIVE_EMAIL_ALLOWED_RECIPIENTS;
    else process.env.LIVE_EMAIL_ALLOWED_RECIPIENTS = original.canaryRecipients;
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

  describe('isGlobalEmailPaused', () => {
    it('returns false when the variable is unset', () => {
      expect(isGlobalEmailPaused()).toBe(false);
    });

    it('returns true for explicit "true" (case-insensitive with whitespace)', () => {
      process.env.EMAIL_GLOBAL_PAUSE = '  TRUE  ';
      expect(isGlobalEmailPaused()).toBe(true);
    });

    it('returns false for other values', () => {
      process.env.EMAIL_GLOBAL_PAUSE = 'false';
      expect(isGlobalEmailPaused()).toBe(false);
    });
  });

  describe('isCanaryRecipientAllowed', () => {
    it('allows all recipients when canary mode is disabled', () => {
      process.env.LIVE_EMAIL_CANARY_MODE = 'false';
      expect(isCanaryRecipientAllowed('any@prospect.com')).toBe(true);
    });

    it('blocks all recipients if canary mode is enabled but no allowed list is provided', () => {
      process.env.LIVE_EMAIL_CANARY_MODE = 'true';
      expect(isCanaryRecipientAllowed('any@prospect.com')).toBe(false);
    });

    it('allows exact recipient match in canary mode', () => {
      process.env.LIVE_EMAIL_CANARY_MODE = 'true';
      process.env.LIVE_EMAIL_ALLOWED_RECIPIENTS = 'qa@telestar.cloud, test@client.com';
      expect(isCanaryRecipientAllowed('qa@telestar.cloud')).toBe(true);
      expect(isCanaryRecipientAllowed('test@client.com')).toBe(true);
      expect(isCanaryRecipientAllowed('other@client.com')).toBe(false);
    });

    it('allows wildcard domain match in canary mode', () => {
      process.env.LIVE_EMAIL_CANARY_MODE = 'true';
      process.env.LIVE_EMAIL_ALLOWED_RECIPIENTS = '@telestar.cloud, *@test.org';
      expect(isCanaryRecipientAllowed('sdr@telestar.cloud')).toBe(true);
      expect(isCanaryRecipientAllowed('director@test.org')).toBe(true);
      expect(isCanaryRecipientAllowed('sdr@other.com')).toBe(false);
    });
  });

  it('defaults to the safe posture with a completely empty environment', () => {
    expect(isAutosendEnabled()).toBe(false);
    expect(isDryRun()).toBe(true);
    expect(isGlobalEmailPaused()).toBe(false);
    expect(isCanaryMode()).toBe(false);
  });
});

