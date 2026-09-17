/**
 * §7 continued — the mailbox axis.
 *
 * `role-negative-access.spec.ts` asks whether a role may reach a *surface*. This asks the question
 * one level in: two SDRs both have the inbox, and the inbox is supposed to show each of them their
 * own mail. Until 2026-09-17 it did not. `/api/inbox` filtered on `tenantId` alone, and a
 * deployment has one tenant, so every rep read every colleague's replies — and `PATCH`, scoped the
 * same way, let them mark, spam, trash and permanently delete those messages.
 *
 * The same blind spot one route down: `POST /api/inbox/threads/[id]/reply` loads a lead by id and
 * tenant, then sends through the mailbox of `lead.assignedToId`. With no access check, any
 * authenticated user could send mail *from a colleague's address* about a lead they do not own.
 * That one is not a leak, it is an impersonated send, and it cannot be recalled.
 *
 * Both were invisible to the existing matrix because the matrix reasons about roles, and these two
 * SDRs have the same role. The axis that matters here is ownership.
 */
import { test, expect } from '../support/test';
import { apiAs, readJson } from '../support/api';
import { fixture, storageStatePath } from '../support/fixture';

type InboxMessage = { subject?: string | null };

const subjectsOf = (body: unknown): string[] =>
  Array.isArray(body) ? (body as InboxMessage[]).map((m) => m.subject ?? '').filter(Boolean) : [];

test.describe('the unified inbox shows one rep their own mailboxes', () => {
  test.use({ storageState: storageStatePath('sdrA') as string });

  test('an SDR sees their own seeded message and not their colleague’s', async ({ baseURL }) => {
    const api = await apiAs('sdrA', baseURL!);
    const { status, body } = await readJson(await api.get('/api/inbox?folder=inbox'));
    expect(status).toBe(200);

    const subjects = subjectsOf(body);
    expect(subjects, 'the rep must still see their own mail').toContain('PW_AUDIT_INBOX_SDRA');
    expect(subjects, 'a colleague’s mail must not appear in this rep’s inbox').not.toContain(
      'PW_AUDIT_INBOX_SDRB'
    );
    await api.dispose();
  });

  test('an SDR cannot mark a colleague’s message read', async ({ baseURL }) => {
    const api = await apiAs('sdrA', baseURL!);
    // The route answers `{ success: true }` for ids it did not touch — it is an updateMany, not a
    // fetch — so the assertion that means anything is on the message afterwards, read back by its
    // owner. Hidden-but-mutable is the exact failure this file exists to rule out.
    const patched = await readJson(
      await api.patch('/api/inbox', {
        data: { messageIds: ['pw-audit-inbound-sdrb'], action: 'read' },
      })
    );
    expect([200, 403]).toContain(patched.status);
    await api.dispose();

    const owner = await apiAs('sdrB', baseURL!);
    const { body } = await readJson(await owner.get('/api/inbox?folder=inbox'));
    const mine = (Array.isArray(body) ? (body as Array<{ subject?: string; isRead?: boolean }>) : []).find(
      (m) => m.subject === 'PW_AUDIT_INBOX_SDRB'
    );
    expect(mine, 'the owner must still see their own message').toBeTruthy();
    expect(mine?.isRead, 'a colleague marked this read on a mailbox they do not own').not.toBe(true);
    await owner.dispose();
  });
});

test.describe('replying sends from your mailbox, about your lead', () => {
  test.use({ storageState: storageStatePath('sdrA') as string });

  test('an SDR cannot reply on a colleague’s lead', async ({ baseURL, recorder }) => {
    recorder.expectFailures(403);
    const api = await apiAs('sdrA', baseURL!);
    const { status } = await readJson(
      await api.post('/api/inbox/threads/pw-audit-thread/reply', {
        data: {
          leadId: fixture().leads.sdrB,
          subject: 'PW_AUDIT_impersonation_probe',
          body: 'This send must never leave the building.',
        },
      })
    );
    expect(status, 'a reply on a colleague’s lead would send from their mailbox').toBe(403);
    await api.dispose();
  });

  test('an SDR is not refused on their own lead', async ({ baseURL, recorder }) => {
    // The mirror case. Without it a blanket 403 would satisfy the test above and still be wrong.
    recorder.expectFailures(400, 403, 422, 500);
    const api = await apiAs('sdrA', baseURL!);
    const { status } = await readJson(
      await api.post('/api/inbox/threads/pw-audit-thread/reply', {
        data: { leadId: fixture().leads.sdrA, subject: 'PW_AUDIT_own_lead', body: 'Own lead.' }
      })
    );
    expect(status, 'the owner must not be refused on authorization grounds').not.toBe(403);
    await api.dispose();
  });
});
