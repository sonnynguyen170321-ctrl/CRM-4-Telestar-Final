/**
 * The Sent folder says what happened to a message, in plain words (lib/inbox/deliveryStatus.ts),
 * and the composer and inbox no longer carry the things the audit found.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describeDelivery } from '@/lib/inbox/deliveryStatus';
import { sendEmailSchema } from '@/lib/validation/schemas';

describe('describeDelivery', () => {
  it('maps every outbound status to a label, a tone and, where it matters, a reason', () => {
    expect(describeDelivery('sent', null)).toEqual({ label: 'Sent', tone: 'ok', detail: null });
    expect(describeDelivery('pending', null)).toMatchObject({ label: 'Queued', tone: 'pending' });
    expect(describeDelivery('sending', null)).toMatchObject({ label: 'Sending', tone: 'pending' });
    expect(describeDelivery('failed', 'Sending is paused for this inbox: bounce spike')).toEqual({
      label: 'Failed', tone: 'bad', detail: 'Sending is paused for this mailbox.',
    });
    expect(describeDelivery('permanently_failed', null)).toMatchObject({ label: 'Failed', tone: 'bad' });
    expect(describeDelivery('bounced', null)).toMatchObject({ label: 'Bounced', tone: 'bad' });
    expect(describeDelivery('reconciliation_required', 'Ambiguous send')).toMatchObject({ label: 'Checking', tone: 'warn' });
  });

  it('says a held-back message was deferred by a limit, and when it will go', () => {
    const daily = describeDelivery('pending', 'Daily send limit reached — deferred to 2026-10-12T02:00:00.000Z');
    expect(daily).toMatchObject({ label: 'Deferred', tone: 'warn' });
    expect(daily!.detail).toContain('daily sending limit');
    expect(describeDelivery('pending', 'Mailbox hourly limit reached — deferred to 2026-10-11T10:30:00.000Z')!.detail).toContain('hourly');
  });

  it('never passes a provider’s raw error text to the client', () => {
    const raw = 'Microsoft Graph API error: tenant 7d1c-secret rejected 550 5.7.1 mx.internal.example';
    for (const status of ['failed', 'permanently_failed', 'bounced', 'reconciliation_required', 'mystery']) {
      const shown = describeDelivery(status, raw);
      expect(JSON.stringify(shown)).not.toMatch(/secret|550|internal|Graph/);
    }
    expect(describeDelivery('failed', raw)!.detail).toBe('The mail provider did not accept the message.');
  });

  it('shows nothing for a message that is not an outgoing one', () => {
    expect(describeDelivery(undefined, null)).toBeNull();
    expect(describeDelivery(null, 'x')).toBeNull();
  });

  it('does not hide an unknown status', () => {
    expect(describeDelivery('mystery', null)).toMatchObject({ label: 'mystery', tone: 'warn' });
  });
});

describe('what the screens no longer carry', () => {
  const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');

  it('the inbox has no hard-coded booking link, company name or claimed attachment', () => {
    const inbox = read('app', 'inbox', 'page.tsx');
    expect(inbox).not.toMatch(/cal\.com/i);
    expect(inbox).not.toMatch(/Sales Team/);
    expect(inbox).not.toMatch(/I've attached/);
    expect(inbox).not.toMatch(/3\.4x/);
  });

  it('the inbox says a reply is queued, sends a request id, and shows delivery state', () => {
    const inbox = read('app', 'inbox', 'page.tsx');
    expect(inbox).not.toMatch(/Reply sent successfully/);
    expect(inbox).toContain('Reply queued');
    expect(inbox).toContain('clientRequestId: replyRequestIdRef.current');
    expect(inbox).toContain('describeDelivery(msg.deliveryStatus, null, msg.scheduledFor)');
    expect(inbox).toContain('msg.deliveryError ?? base.detail');
  });

  it('the composer renders no merge fields in the browser and shows the pause notice for any mailbox', () => {
    const composer = read('components', 'MailComposerModal.tsx');
    expect(composer).not.toMatch(/sdrName: 'SDR'/);
    expect(composer).not.toContain('Sales Development Representative');
    expect(composer).not.toContain('substituteLeadVars');
    // The notice lives in the shared mailbox picker and is its own branch, not the `else` of a
    // multi-mailbox list: it shows for whichever mailbox is selected.
    const picker = read('components', 'compose', 'MailboxSelect.tsx');
    expect(picker).toMatch(/\{mailbox\?\.sendPausedAt \? \(/);
    expect(picker).not.toMatch(/mailboxes\.length > 1 &&/);
  });

  it('the composer shows an HTML template in the rich editor, never as raw tags in a textarea', () => {
    const composer = read('components', 'MailComposerModal.tsx');
    expect(composer).toContain('<ComposeEditor');
    expect(composer).not.toContain('<textarea');
  });

  it('opening a draft or a preview fetches nothing remote until the rep asks for images', () => {
    // The editor and the preview both swap web images for a blank placeholder first (a shared
    // template could carry a tracking pixel); tests/compose-lib.test.ts covers the functions.
    expect(read('components', 'compose', 'ComposeEditor.tsx')).toContain('blockRemoteImages');
    expect(read('components', 'compose', 'ComposeParts.tsx')).toContain('blockRemoteImages');
    const forbidden = /FORBIDDEN_TAGS = \[([^\]]*)\]/.exec(read('lib', 'compose', 'html.ts'))![1];
    for (const tag of ['link', 'style', 'iframe', 'svg']) expect(forbidden).toContain(`'${tag}'`);
  });
});

describe('the send schema', () => {
  const base = { accountId: 'acct-1', to: 'a@b.test', subject: 's', body: 'b' };

  it('no longer advertises html or replyTo, which the route used to accept and drop', () => {
    expect('html' in sendEmailSchema.shape).toBe(false);
    expect('replyTo' in sendEmailSchema.shape).toBe(false);
    expect(sendEmailSchema.safeParse(base).success).toBe(true);
  });
});
