import { describe, it, expect } from 'vitest';
import { isBounceMessage, isAutoReply, extractBouncedRecipient } from '@/lib/email/bounceDetection';

describe('isBounceMessage', () => {
  it('detects mailer-daemon and postmaster senders', () => {
    expect(isBounceMessage({ fromEmail: 'mailer-daemon@googlemail.com', subject: 'anything' })).toBe(true);
    expect(isBounceMessage({ fromEmail: 'postmaster@outlook.com', subject: 'anything' })).toBe(true);
  });

  it('detects NDR subjects from normal senders', () => {
    expect(isBounceMessage({ fromEmail: 'noreply@mail.example.com', subject: 'Undeliverable: Quick intro' })).toBe(true);
    expect(isBounceMessage({ fromEmail: 'x@y.com', subject: 'Delivery Status Notification (Failure)' })).toBe(true);
    expect(isBounceMessage({ fromEmail: 'x@y.com', subject: 'Mail delivery failed: returning message to sender' })).toBe(true);
  });

  it('does not flag normal replies', () => {
    expect(isBounceMessage({ fromEmail: 'anh@vinatech.vn', subject: 'Re: Quick intro' })).toBe(false);
  });
});

describe('isAutoReply', () => {
  it('flags out-of-office and automatic replies', () => {
    expect(isAutoReply({ subject: 'Out of Office: Re: Quick intro' })).toBe(true);
    expect(isAutoReply({ subject: 'Automatic reply: Quick intro' })).toBe(true);
    expect(isAutoReply({ subject: 'Auto-Reply' })).toBe(true);
  });

  it('does not flag genuine replies', () => {
    expect(isAutoReply({ subject: 'Re: Quick intro — yes, interested' })).toBe(false);
  });
});

describe('extractBouncedRecipient', () => {
  it('prefers the X-Failed-Recipients header', () => {
    expect(
      extractBouncedRecipient({
        providerMessageId: 'msg-1',
        fromEmail: 'mailer-daemon@googlemail.com',
        subject: 'Delivery Status Notification (Failure)',
        date: new Date(),
        failedRecipient: 'Bad.Address@Example.COM',
      })
    ).toBe('bad.address@example.com');
  });

  it('falls back to an email found in the subject', () => {
    expect(
      extractBouncedRecipient({
        providerMessageId: 'msg-2',
        fromEmail: 'postmaster@x.com',
        subject: 'Undeliverable: mail to john@acme.io',
        date: new Date(),
        failedRecipient: null,
      })
    ).toBe('john@acme.io');
  });

  it('returns null when nothing is extractable', () => {
    expect(
      extractBouncedRecipient({
        providerMessageId: 'msg-3',
        fromEmail: 'postmaster@x.com',
        subject: 'Undeliverable message',
        date: new Date(),
        failedRecipient: null,
      })
    ).toBeNull();
  });
});

/**
 * The address is usually in the body, not the subject.
 *
 * Production stored 42 hard bounces with `bouncedRecipient` null — all of them — because this
 * function read `X-Failed-Recipients` and the subject and nothing else. With no address, no
 * lead matched, `handleApplyBounce` never ran, and not one `SuppressionEntry` was ever written
 * while those 42 mailboxes stayed in the sending pool.
 */
describe('extractBouncedRecipient reads the delivery-status body', () => {
  const ndr = (body: string, subject = 'Delivery Status Notification (Failure)') => ({
    providerMessageId: 'msg-dsn',
    fromEmail: 'mailer-daemon@googlemail.com',
    subject,
    date: new Date(),
    failedRecipient: null,
    body,
  });

  it('reads Final-Recipient from the RFC 3464 delivery-status part', () => {
    expect(
      extractBouncedRecipient(
        ndr(
          [
            'Reporting-MTA: dns; googlemail.com',
            '',
            'Final-Recipient: rfc822; ghost@deadcompany.io',
            'Action: failed',
            'Status: 5.1.1',
          ].join('\n')
        )
      )
    ).toBe('ghost@deadcompany.io');
  });

  it('reads Original-Recipient when Final-Recipient is absent', () => {
    expect(
      extractBouncedRecipient(ndr('Original-Recipient: rfc822;Someone@Example.COM\nAction: failed'))
    ).toBe('someone@example.com');
  });

  it('reads a prose NDR with no delivery-status part', () => {
    expect(
      extractBouncedRecipient(
        ndr("Your message to sales@gone.co.uk could not be delivered because the user unknown.")
      )
    ).toBe('sales@gone.co.uk');
  });

  it('never returns the bounce daemon as the prospect', () => {
    // The daemon's own address appears first in almost every NDR body. Returning it would
    // suppress `mailer-daemon@…` and leave the prospect untouched — worse than finding nothing.
    expect(
      extractBouncedRecipient(
        ndr('From: mailer-daemon@googlemail.com\n\nFinal-Recipient: rfc822; real@prospect.com')
      )
    ).toBe('real@prospect.com');
  });

  it('falls back to an address quoted in the original message', () => {
    expect(
      extractBouncedRecipient(
        ndr('----- Original message -----\nTo: quoted@prospect.dev\nSubject: Hello')
      )
    ).toBe('quoted@prospect.dev');
  });

  it('still prefers the explicit header when one is present', () => {
    expect(
      extractBouncedRecipient({
        ...ndr('Final-Recipient: rfc822; wrong@body.com'),
        failedRecipient: 'header@right.com',
      })
    ).toBe('header@right.com');
  });
});
