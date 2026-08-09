/**
 * §16 — the impact gate on campaign-member removal.
 *
 * `CLAUDE.md` calls this out by name as *"the rule that must not regress"*: removing a member
 * who still holds open work must return **409** unless the caller names a handling mode
 * (`transfer_work` / `pause_tasks` / `keep_existing_work`) plus a reason. Enforcement lives in
 * `lib/admin/campaignMembers.ts`, and both `/api/admin/assignments` and
 * `/api/campaigns/[id]/members` delegate to it so it cannot be bypassed — which means both
 * doors have to be tested, not just the one the UI happens to use.
 *
 * 409 rather than 400 is the interesting part and is asserted precisely: the request is
 * well-formed, the *state* is what refuses it, and the response carries the impact so the UI
 * can show it. A test that accepted "any 4xx" would pass against a validation bug that made
 * the feature unreachable.
 */
import { test, expect } from '../support/test';
import { apiAs, readJson } from '../support/api';
import { fixture } from '../support/fixture';
import { uniqueSuffix, disposablePassword } from '../support/ids';
import type { APIRequestContext } from '@playwright/test';

const stamp = () => `${Date.now()}${uniqueSuffix()}`;

/** A member of campaign A holding one open task on one lead — i.e. real work to inherit. */
async function memberWithOpenWork(admin: APIRequestContext) {
  const s = stamp();
  const created = await readJson(
    await admin.post('/api/users', {
      data: {
        email: `pw.member.${s}@audit.test`,
        password: disposablePassword(),
        firstName: 'PW',
        lastName: `Member${s}`,
        role: 'sdr',
        managerId: fixture().users.teamLead.id,
      },
    })
  );
  expect(created.status, `member create failed: ${JSON.stringify(created.body)}`).toBeLessThan(300);
  const userId = (created.body as { id: string }).id;

  const added = await readJson(
    await admin.post(`/api/campaigns/${fixture().campaignA}/members`, { data: { userIds: [userId] } })
  );
  expect(added.status, `add to campaign failed: ${JSON.stringify(added.body)}`).toBeLessThan(300);

  const lead = await readJson(
    await admin.post('/api/leads', {
      data: {
        firstName: 'PW',
        lastName: `Impact${s}`,
        company: `PW_AUDIT_CO_IMPACT_${s}`,
        email: `pw.impact.${s}@audit.test`,
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
        title: `PW_AUDIT_IMPACT_TASK_${s}`,
        dueDate: new Date(Date.now() + 86_400_000).toISOString(),
      },
    })
  );
  expect(task.status, `task create failed: ${JSON.stringify(task.body)}`).toBeLessThan(300);

  return { userId, leadId };
}

async function cleanUp(admin: APIRequestContext, userId: string, leadId: string) {
  await admin.delete(`/api/leads/${leadId}`);
  await admin.put(`/api/users/${userId}`, { data: { isActive: false } });
}

test.describe('campaign member removal impact gate', () => {
  test('removing a member with open work is refused with 409 and an impact summary', async ({
    baseURL,
    recorder,
  }) => {
    recorder.expectFailures(409);
    const admin = await apiAs('director', baseURL!);
    const { userId, leadId } = await memberWithOpenWork(admin);

    const { status, body } = await readJson(
      await admin.delete(`/api/campaigns/${fixture().campaignA}/members`, { data: { userId } })
    );

    expect(
      status,
      `expected 409 for an un-handled removal, got ${status}: ${JSON.stringify(body).slice(0, 300)}`
    ).toBe(409);
    // The body has to be useful, not just refusing — the dialog is built from it.
    expect(JSON.stringify(body).length, 'the 409 carried no impact detail').toBeGreaterThan(2);

    await cleanUp(admin, userId, leadId);
    await admin.dispose();
  });

  test('naming a handling mode and a reason lets the removal through', async ({ baseURL }) => {
    // The mirror case. Without it, a route that refused every removal would pass the test
    // above while making the feature unusable.
    const admin = await apiAs('director', baseURL!);
    const { userId, leadId } = await memberWithOpenWork(admin);

    const { status, body } = await readJson(
      await admin.delete(`/api/campaigns/${fixture().campaignA}/members`, {
        data: {
          userId,
          mode: 'transfer_work',
          transferToUserId: fixture().users.sdrA.id,
          reason: 'PW_AUDIT transferring work during audit',
        },
      })
    );
    expect(
      status,
      `a fully-specified removal was refused: ${JSON.stringify(body).slice(0, 300)}`
    ).toBeLessThan(300);

    const members = await readJson(
      await admin.get(`/api/campaigns/${fixture().campaignA}/members`)
    );
    const rows = (Array.isArray(members.body)
      ? members.body
      : (members.body as { members?: unknown[] }).members ?? []) as { userId?: string; id?: string }[];
    expect(
      rows.some((m) => m.userId === userId || m.id === userId),
      'the member is still on the campaign after an accepted removal'
    ).toBe(false);

    await cleanUp(admin, userId, leadId);
    await admin.dispose();
  });

  test('the admin assignments door enforces the same gate', async ({ baseURL, recorder }) => {
    // Both routes delegate to `lib/admin/campaignMembers.ts` precisely so the rule cannot be
    // bypassed by picking the other endpoint. Testing only one would not show a regression
    // that re-implemented the check in one place and dropped it in the other.
    recorder.expectFailures(409);
    const admin = await apiAs('director', baseURL!);
    const { userId, leadId } = await memberWithOpenWork(admin);

    const { status, body } = await readJson(
      await admin.delete('/api/admin/assignments', {
        data: { userId, campaignId: fixture().campaignA },
      })
    );
    expect(
      status,
      `/api/admin/assignments did not enforce the impact gate (${status}): ${JSON.stringify(body).slice(0, 300)}`
    ).toBe(409);

    await cleanUp(admin, userId, leadId);
    await admin.dispose();
  });

  test('deactivating a user who still manages active reports is refused with 409', async ({
    baseURL,
    recorder,
  }) => {
    // `app/api/users/[id]/route.ts:151-170` — deactivation must not silently orphan a pod.
    recorder.expectFailures(409);
    const admin = await apiAs('director', baseURL!);
    const s = stamp();

    const mgr = await readJson(
      await admin.post('/api/users', {
        data: {
          email: `pw.mgr.${s}@audit.test`,
          password: disposablePassword(),
          firstName: 'PW',
          lastName: `Mgr${s}`,
          role: 'team_lead',
          managerId: fixture().users.floorManager.id,
        },
      })
    );
    expect(mgr.status).toBeLessThan(300);
    const mgrId = (mgr.body as { id: string }).id;

    const report = await readJson(
      await admin.post('/api/users', {
        data: {
          email: `pw.rep.${s}@audit.test`,
          password: disposablePassword(),
          firstName: 'PW',
          lastName: `Rep${s}`,
          role: 'sdr',
          managerId: mgrId,
        },
      })
    );
    expect(report.status).toBeLessThan(300);
    const reportId = (report.body as { id: string }).id;

    const refused = await readJson(await admin.put(`/api/users/${mgrId}`, { data: { isActive: false } }));
    expect(
      refused.status,
      `deactivating a manager with reports was allowed (${refused.status})`
    ).toBe(409);

    // And it goes through once the reports are given somewhere to go.
    const accepted = await readJson(
      await admin.put(`/api/users/${mgrId}`, {
        data: { isActive: false, reassignReportsTo: fixture().users.teamLead.id },
      })
    );
    expect(
      accepted.status,
      `deactivation with reassignment failed: ${JSON.stringify(accepted.body).slice(0, 300)}`
    ).toBe(200);

    await admin.put(`/api/users/${reportId}`, { data: { isActive: false } });
    await admin.dispose();
  });
});
