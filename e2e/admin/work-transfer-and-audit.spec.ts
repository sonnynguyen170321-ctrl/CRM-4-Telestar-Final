/**
 * §16 work transfer, and §36 the audit trail.
 *
 * Two things make these worth pairing. Transfer is the operation that moves ownership of live
 * work between people, so getting it wrong loses work silently rather than loudly. And the
 * audit log is the only record that any of it happened — `.claude/rules/runtime-hardening.md`
 * requires *"every state transition writes an Activity/audit"*, which is a claim nothing else
 * in the product fails loudly about if it stops being true.
 *
 * `lib/admin/transferWork.ts` deliberately has no `$transaction` (documented in `CLAUDE.md`:
 * Neon HTTP has no interactive transactions, and wrapping it would look atomic without being
 * so). It is idempotent-resumable instead — which is exactly why the replay case below is not
 * optional.
 */
import { test, expect } from '../support/test';
import { apiAs, readJson } from '../support/api';
import { fixture } from '../support/fixture';
import { uniqueSuffix, disposablePassword } from '../support/ids';
import type { APIRequestContext } from '@playwright/test';

const stamp = () => `${Date.now()}${uniqueSuffix()}`;

/** An SDR on campaign A owning one lead and one open task. */
async function repWithWork(admin: APIRequestContext) {
  const s = stamp();
  const user = await readJson(
    await admin.post('/api/users', {
      data: {
        email: `pw.xfer.${s}@audit.test`,
        password: disposablePassword(),
        firstName: 'PW',
        lastName: `Xfer${s}`,
        role: 'sdr',
        managerId: fixture().users.teamLead.id,
      },
    })
  );
  expect(user.status, `user create failed: ${JSON.stringify(user.body)}`).toBeLessThan(300);
  const userId = (user.body as { id: string }).id;

  await admin.post(`/api/campaigns/${fixture().campaignA}/members`, { data: { userIds: [userId] } });

  const lead = await readJson(
    await admin.post('/api/leads', {
      data: {
        firstName: 'PW',
        lastName: `XferLead${s}`,
        company: `PW_AUDIT_CO_XFER_${s}`,
        email: `pw.xferlead.${s}@audit.test`,
        campaignId: fixture().campaignA,
        assignedToId: userId,
      },
    })
  );
  expect(lead.status).toBeLessThan(300);
  const leadId = (lead.body as { id: string }).id;

  const task = await readJson(
    await admin.post('/api/tasks', {
      data: {
        leadId,
        userId,
        type: 'phone',
        title: `PW_AUDIT_XFER_TASK_${s}`,
        dueDate: new Date(Date.now() + 86_400_000).toISOString(),
      },
    })
  );
  expect(task.status).toBeLessThan(300);

  return { userId, leadId };
}

async function leadOwner(admin: APIRequestContext, leadId: string): Promise<string | undefined> {
  const { body } = await readJson(await admin.get(`/api/leads/${leadId}`));
  return (body as { assignedToId?: string }).assignedToId;
}

test.describe('work transfer', () => {
  test('transferring work moves lead ownership to the new rep', async ({ baseURL }) => {
    const admin = await apiAs('director', baseURL!);
    const { userId, leadId } = await repWithWork(admin);
    expect(await leadOwner(admin, leadId), 'setup did not assign the lead').toBe(userId);

    const { status, body } = await readJson(
      await admin.post('/api/admin/transfer-work', {
        data: {
          fromUserId: userId,
          toUserId: fixture().users.sdrA.id,
          requestId: `pw-audit-xfer-${stamp()}`,
          reason: 'PW_AUDIT work transfer',
        },
      })
    );
    expect(status, `transfer failed: ${JSON.stringify(body).slice(0, 300)}`).toBeLessThan(300);

    // Read the lead back rather than trusting the transfer's own summary.
    expect(await leadOwner(admin, leadId), 'the lead did not move to the new owner').toBe(
      fixture().users.sdrA.id
    );

    await admin.delete(`/api/leads/${leadId}`);
    await admin.put(`/api/users/${userId}`, { data: { isActive: false } });
    await admin.dispose();
  });

  test('replaying the same requestId does not transfer twice', async ({ baseURL }) => {
    // The documented idempotency guarantee, and the one that matters most given there is no
    // transaction: a retried request must be a no-op, not a second move.
    const admin = await apiAs('director', baseURL!);
    const { userId, leadId } = await repWithWork(admin);
    const requestId = `pw-audit-xfer-replay-${stamp()}`;
    const payload = {
      data: {
        fromUserId: userId,
        toUserId: fixture().users.sdrA.id,
        requestId,
        reason: 'PW_AUDIT replay',
      },
    };

    const first = await readJson(await admin.post('/api/admin/transfer-work', payload));
    expect(first.status).toBeLessThan(300);
    const second = await readJson(await admin.post('/api/admin/transfer-work', payload));
    expect(
      second.status,
      `replaying a transfer errored instead of returning the stored result: ${JSON.stringify(second.body).slice(0, 200)}`
    ).toBeLessThan(300);

    expect(await leadOwner(admin, leadId)).toBe(fixture().users.sdrA.id);

    await admin.delete(`/api/leads/${leadId}`);
    await admin.put(`/api/users/${userId}`, { data: { isActive: false } });
    await admin.dispose();
  });

  test('two concurrent transfers of the same work land on one owner', async ({
    baseURL,
    recorder,
  }) => {
    // §46. Distinct requestIds, so idempotency does not cover this — the two calls genuinely
    // race. Whoever loses, the lead must end up owned by exactly one of the targets and the
    // work must not be split.
    recorder.expectFailures(400, 409, 422, 500);
    const admin = await apiAs('director', baseURL!);
    const { userId, leadId } = await repWithWork(admin);

    await Promise.all([
      admin.post('/api/admin/transfer-work', {
        data: {
          fromUserId: userId,
          toUserId: fixture().users.sdrA.id,
          requestId: `pw-audit-race-a-${stamp()}`,
          reason: 'PW_AUDIT race a',
        },
      }),
      admin.post('/api/admin/transfer-work', {
        data: {
          fromUserId: userId,
          toUserId: fixture().users.sdrB.id,
          requestId: `pw-audit-race-b-${stamp()}`,
          reason: 'PW_AUDIT race b',
        },
      }),
    ]);

    const owner = await leadOwner(admin, leadId);
    expect(
      [fixture().users.sdrA.id, fixture().users.sdrB.id],
      `after concurrent transfers the lead is owned by ${owner}`
    ).toContain(owner);

    await admin.delete(`/api/leads/${leadId}`);
    await admin.put(`/api/users/${userId}`, { data: { isActive: false } });
    await admin.dispose();
  });

  test('an SDR cannot transfer work', async ({ baseURL, recorder }) => {
    recorder.expectFailures(400, 403);
    const admin = await apiAs('director', baseURL!);
    const { userId, leadId } = await repWithWork(admin);

    const sdr = await apiAs('sdrA', baseURL!);
    const { status } = await readJson(
      await sdr.post('/api/admin/transfer-work', {
        data: {
          fromUserId: userId,
          toUserId: fixture().users.sdrA.id,
          requestId: `pw-audit-xfer-denied-${stamp()}`,
          reason: 'PW_AUDIT should be refused',
        },
      })
    );
    expect(status, `an SDR transferred work (${status})`).toBe(403);
    expect(await leadOwner(admin, leadId), 'the refused transfer still moved the lead').toBe(userId);
    await sdr.dispose();

    await admin.delete(`/api/leads/${leadId}`);
    await admin.put(`/api/users/${userId}`, { data: { isActive: false } });
    await admin.dispose();
  });
});

test.describe('audit trail', () => {
  test('an admin mutation is recorded with actor, action and entity', async ({ baseURL }) => {
    const admin = await apiAs('director', baseURL!);
    const s = stamp();

    const created = await readJson(
      await admin.post('/api/users', {
        data: {
          email: `pw.audited.${s}@audit.test`,
          password: disposablePassword(),
          firstName: 'PW',
          lastName: `Audited${s}`,
          role: 'sdr',
          managerId: fixture().users.teamLead.id,
        },
      })
    );
    expect(created.status).toBeLessThan(300);
    const targetId = (created.body as { id: string }).id;

    // Force a second, differently-shaped event so the assertion is not satisfied by one
    // generic row.
    await admin.put(`/api/users/${targetId}`, { data: { role: 'team_lead', managerId: fixture().users.floorManager.id } });

    const { status, body } = await readJson(await admin.get('/api/admin/audit-log?limit=200'));
    expect(status).toBe(200);
    // The route projects `userId` to **`actorId`** in its response
    // (`app/api/admin/audit-log/route.ts`), so reading `userId` here yields `undefined` for
    // every row. That is worth naming: the first version of this file read `userId`, and while
    // this assertion failed loudly, the tenant-leak test below read the same field and passed
    // *vacuously* — comparing `undefined` against a set of ids can only ever find nothing.
    const rows = (Array.isArray(body) ? body : (body as { entries?: unknown[] }).entries ?? []) as {
      action?: string;
      actorId?: string;
      recordId?: string;
      tableName?: string;
      createdAt?: string;
    }[];
    expect(rows.length, 'the audit log returned nothing at all').toBeGreaterThan(0);

    const mine = rows.filter((r) => r.recordId === targetId);
    expect(mine.length, `no audit rows for the user just created/changed (${targetId})`).toBeGreaterThan(0);

    const roleChange = mine.find((r) => r.action === 'admin.user.role_change');
    expect(roleChange, `no role_change row among ${JSON.stringify(mine.map((r) => r.action))}`).toBeTruthy();
    expect(roleChange?.actorId, 'the audit row does not name the actor').toBe(
      fixture().users.director.id
    );
    expect(roleChange?.tableName).toBe('User');
    expect(roleChange?.createdAt, 'the audit row has no timestamp').toBeTruthy();

    await admin.put(`/api/users/${targetId}`, { data: { isActive: false } });
    await admin.dispose();
  });

  test('an SDR and a team lead cannot read the audit log', async ({ baseURL, recorder }) => {
    // requireRole('floor_manager') — and the edge gate in proxy.ts refuses the page too.
    recorder.expectFailures(401, 403);
    for (const role of ['sdrA', 'teamLead'] as const) {
      const api = await apiAs(role, baseURL!);
      const { status } = await readJson(await api.get('/api/admin/audit-log?limit=10'));
      expect([401, 403], `${role} read the audit log (${status})`).toContain(status);
      await api.dispose();
    }
  });

  test('the audit log does not expose another tenant activity', async ({ baseURL }) => {
    const api = await apiAs('director', baseURL!);
    const { body } = await readJson(await api.get('/api/admin/audit-log?limit=200&scope=all'));
    const rows = (Array.isArray(body) ? body : (body as { entries?: unknown[] }).entries ?? []) as {
      actorId?: string;
    }[];
    // Guard against the vacuous version of this check: if the projection changes again and
    // `actorId` disappears, the filter below would silently find nothing and pass.
    expect(rows.length, 'the audit log returned no rows to check for leakage').toBeGreaterThan(0);
    expect(
      rows.some((r) => Boolean(r.actorId)),
      'no row carried an actorId — this test would pass without checking anything'
    ).toBe(true);
    const foreignActors = new Set([fixture().users.directorB.id, fixture().users.sdrTenantB.id]);
    const leaked = rows.filter((r) => r.actorId && foreignActors.has(r.actorId));
    expect(leaked, `tenant B activity visible in tenant A audit log: ${JSON.stringify(leaked)}`).toEqual(
      []
    );
    await api.dispose();
  });
});
