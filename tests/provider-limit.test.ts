import { describe, expect, it } from 'vitest';

import { classifyProviderLimit } from '@/lib/email/providerLimit';
import { classifyRecipientFailure } from '@/lib/email/recipientFailure';

/**
 * A provider's sending limit is a reason to wait, not a failed send (reported 2026-10-05: Judy's
 * sequence "failing on provider limit" — each refusal paused that lead's cadence for good).
 */
const smtp = (response: string, responseCode?: number) =>
  Object.assign(new Error(`Message failed: ${response}`), { response, responseCode });

const gaxios = (status: number, message: string, reason: string) =>
  Object.assign(new Error(message), {
    code: status,
    response: { status, data: { error: { code: status, message, errors: [{ reason }] } } },
  });

describe('classifyProviderLimit', () => {
  it.each([
    ['Gmail SMTP daily cap', smtp('550 5.4.5 Daily user sending limit exceeded. For more information on Gmail sending limits', 550)],
    ['Gmail API daily cap', gaxios(403, 'Daily user sending quota exceeded', 'dailyLimitExceeded')],
    ['Exchange daily recipient limit', new Error('554 5.2.0 STOREDRV.Submission.Exception:SubmissionQuotaExceededException')],
    ['Titan daily limit', smtp('550 5.7.1 Daily sending limit exceeded for this account', 550)],
    ['generic per-day quota', smtp('554 Message rejected: you have reached your sending quota for today', 554)],
  ])('reads %s as a daily limit', (_case, error) => {
    expect(classifyProviderLimit(error)).toBe('daily');
  });

  it.each([
    ['the 2026-09-21 hourly quota', smtp('550 5.4.6 Sender Hourly Quota Exceeded', 550)],
    ['Gmail API user rate limit', gaxios(429, 'User-rate limit exceeded.  Retry after 2026-10-05T20:00:00.000Z', 'userRateLimitExceeded')],
    ['Gmail temporary throttling', smtp('421 4.7.0 Try again later, closing connection.', 421)],
    ['Exchange submission rate', smtp('432 4.4.2 Message submission rate for this client has exceeded the configured limit', 432)],
    ['Graph throttling', Object.assign(new Error('Microsoft Graph API error: ApplicationThrottled'), { status: 429 })],
    ['Titan rate limit', smtp('451 4.7.1 Rate limited: too many messages, try again later', 451)],
    ['a bare 429', Object.assign(new Error('Request failed'), { response: { status: 429 } })],
  ])('reads %s as an hourly limit', (_case, error) => {
    expect(classifyProviderLimit(error)).toBe('hourly');
  });

  it.each([
    ['a dead address', smtp('550 5.1.1 The email account that you tried to reach does not exist', 550)],
    ['a bad password', smtp('535 5.7.8 Username and Password not accepted', 535)],
    ['a dropped connection', Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })],
    ['a revoked grant', new Error('invalid_grant')],
  ])('does not read %s as a limit', (_case, error) => {
    expect(classifyProviderLimit(error)).toBeNull();
  });

  it('leaves a recipient’s full mailbox to the recipient verdict, which the worker checks first', () => {
    const full = smtp('552 5.2.2 The email account that you tried to reach is over quota', 552);
    expect(classifyRecipientFailure(full)).toBe('recipient');
  });
});
