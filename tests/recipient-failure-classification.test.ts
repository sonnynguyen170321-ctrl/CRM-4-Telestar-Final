import { describe, it, expect } from 'vitest';
import { classifyRecipientFailure } from '@/lib/email/recipientFailure';

/**
 * The line between "this address is dead" and "the provider refused us".
 *
 * Getting it wrong in one direction costs a prospect; getting it wrong in the other costs the
 * pipeline. On 2026-09-21 the provider refused 228 messages with `550 5.4.6 Sender Hourly Quota
 * Exceeded` — our own hourly ceiling. Reading that `550` as a bounce would have suppressed 228
 * live prospects permanently and silently, which is a worse outcome than the incident it would
 * have been "fixing".
 *
 * So the first test here is the incident string itself, and it must never come back `recipient`.
 */
describe('a refusal about us is never read as a dead address', () => {
  const senderSide = [
    // The exact wording production recorded, 228 times.
    "Can't send mail - all recipients were rejected: 550 5.4.6 Sender Hourly Quota Exceeded",
    '550 5.4.5 Daily sending quota exceeded',
    '550 5.7.1 Message rejected due to sender policy',
    '550 5.7.26 Unauthenticated email is not accepted from this domain',
    '421 4.7.0 Try again later, closing connection',
    '452 4.2.2 The email account that you tried to reach is over quota, try again later',
    'socket hang up',
    'ECONNRESET',
  ];

  for (const message of senderSide) {
    it(`treats "${message.slice(0, 48)}" as our problem`, () => {
      expect(classifyRecipientFailure(new Error(message))).toBe('sender');
    });
  }

  it('reads a sender-side code as sender-side even when the text mentions a mailbox', () => {
    // The trap: a substring match on "mailbox" would suppress the prospect here, and the DSN
    // code is the only part of this string that is actually authoritative.
    expect(
      classifyRecipientFailure(new Error('550 5.4.6 hourly limit reached for this mailbox'))
    ).toBe('sender');
  });
});

describe('a refusal about the address suppresses it', () => {
  const recipientSide = [
    '550 5.1.1 The email account that you tried to reach does not exist',
    '550 5.1.10 RESOLVER.ADR.RecipientNotFound; not found',
    '553 5.1.3 The recipient address is not a valid RFC-5321 address',
    '550 5.2.1 The email account that you tried to reach is disabled',
    '552 5.2.2 The email account that you tried to reach is over quota',
    'SMTP error: 550 User unknown',
    'no such user here',
    'Recipient address rejected: User unknown in virtual mailbox table',
    'unrouteable address',
    "Can't send mail - all recipients were rejected: invalid recipient",
    'mailbox is full',
    'Account is disabled',
  ];

  for (const message of recipientSide) {
    it(`stops writing to the address after "${message.slice(0, 44)}"`, () => {
      expect(classifyRecipientFailure(new Error(message))).toBe('recipient');
    });
  }

  it('suppresses a full mailbox, because the operator chose reputation over recovery', () => {
    // 5.2.2 is a soft bounce by the RFC. The 2026-09-23 decision was to suppress on any bounce
    // with no retry, so it belongs here and not in `sender`.
    expect(classifyRecipientFailure(new Error('452 the mailbox is full'))).toBe('recipient');
  });
});

describe('anything unrecognised is left alone', () => {
  it('defaults to sender, because a wrong suppression is silent and permanent', () => {
    expect(classifyRecipientFailure(new Error('something nobody has seen before'))).toBe('sender');
    expect(classifyRecipientFailure(undefined)).toBe('sender');
    expect(classifyRecipientFailure(null)).toBe('sender');
  });
});
