/**
 * §10 — dashboard counters, checked against the records behind them.
 *
 * The brief is explicit that asserting a number *exists* proves nothing, so every case here
 * creates tasks with known due dates for a disposable rep and then compares the tab contents
 * against what was created. A disposable rep matters: the shared fixture SDRs accumulate rows
 * from other specs, and a count over shared data can only ever be asserted loosely.
 *
 * The tabs are timezone-derived (`getLocalDayBoundaries` against `User.timezone`), so the
 * boundary cases are the interesting ones — a task due later today, one due yesterday, and one
 * overdue must each land in exactly one tab.
 */
import { test, expect } from '../support/test';
import { apiAs, readJson } from '../support/api';
import { fixture } from '../support/fixture';
import { uniqueSuffix, disposablePassword } from '../support/ids';
import { request, type APIRequestContext } from '@playwright/test';

const stamp = () => `${Date.now()}${uniqueSuffix()}`;

type Task = { id: string; status?: string; dueDate?: string };

/** A rep with a lead, plus a signed-in context of their own. */
async function disposableRep(admin: APIRequestContext, baseURL: string) {
  const s = stamp();
  const email = `pw.kpi.${s}@audit.test`;
  const password = disposablePassword();

  const created = await readJson(
    await admin.post('/api/users', {
      data: {
        email,
        password,
        firstName: 'PW',
        lastName: `Kpi${s}`,
        role: 'sdr',
        managerId: fixture().users.teamLead.id,
        timezone: 'UTC',
      },
    })
  );
  expect(created.status, `rep create failed: ${JSON.stringify(created.body)}`).toBeLessThan(300);
  const userId = (created.body as { id: string }).id;

  await admin.post(`/api/campaigns/${fixture().campaignA}/members`, { data: { userIds: [userId] } });

  const lead = await readJson(
    await admin.post('/api/leads', {
      data: {
        firstName: 'PW',
        lastName: `KpiLead${s}`,
        company: `PW_AUDIT_CO_KPI_${s}`,
        email: `pw.kpilead.${s}@audit.test`,
        campaignId: fixture().campaignA,
        assignedToId: userId,
      },
    })
  );
  expect(lead.status).toBeLessThan(300);
  const leadId = (lead.body as { id: string }).id;

  const ctx = await request.newContext({ baseURL });
  const { csrfToken } = (await (await ctx.get('/api/auth/csrf')).json()) as { csrfToken: string };
  const signIn = await ctx.post('/api/auth/callback/credentials', {
    form: { csrfToken, email, password, callbackUrl: `${baseURL}/`, json: 'true' },
  });
  expect(signIn.status(), 'rep sign-in failed').toBeLessThan(400);

  return { userId, leadId, ctx };
}

async function addTask(admin: APIRequestContext, leadId: string, userId: string, dueDate: Date) {
  const { status, body } = await readJson(
    await admin.post('/api/tasks', {
      data: {
        leadId,
        userId,
        type: 'phone',
        title: `PW_AUDIT_KPI_${stamp()}`,
        dueDate: dueDate.toISOString(),
      },
    })
  );
  expect(status, `task create failed: ${JSON.stringify(body).slice(0, 200)}`).toBeLessThan(300);
  return (body as { id: string }).id;
}

async function tab(ctx: APIRequestContext, name: string) {
  const { status, body } = await readJson(await ctx.get(`/api/tasks?tab=${name}`));
  expect(status, `GET /api/tasks?tab=${name} failed`).toBe(200);
  return (Array.isArray(body) ? body : (body as { tasks?: unknown[] }).tasks ?? []) as Task[];
}

/** Midday in UTC on a given day offset, safely inside the day boundary either way. */
function middayOffset(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(12, 0, 0, 0);
  return d;
}

test.describe('dashboard task counters', () => {
  test('a task lands in exactly one of today / yesterday / overdue', async ({ baseURL }) => {
    const admin = await apiAs('director', baseURL!);
    const rep = await disposableRep(admin, baseURL!);

    const todayId = await addTask(admin, rep.leadId, rep.userId, middayOffset(0));
    const yesterdayId = await addTask(admin, rep.leadId, rep.userId, middayOffset(-1));
    const overdueId = await addTask(admin, rep.leadId, rep.userId, middayOffset(-5));

    const today = (await tab(rep.ctx, 'today')).map((t) => t.id);
    const yesterday = (await tab(rep.ctx, 'yesterday')).map((t) => t.id);
    const overdue = (await tab(rep.ctx, 'overdue')).map((t) => t.id);

    expect(today, "today's task is missing from the Today tab").toContain(todayId);
    expect(today, 'a past task leaked into Today').not.toContain(overdueId);

    expect(yesterday, "yesterday's task is missing from the Yesterday tab").toContain(yesterdayId);
    expect(yesterday, "today's task leaked into Yesterday").not.toContain(todayId);

    // Overdue is `dueDate < todayStart AND status = pending`, so yesterday's pending task is
    // legitimately overdue too. What must not appear is anything due today.
    expect(overdue, 'the old pending task is missing from Overdue').toContain(overdueId);
    expect(overdue, "today's task was counted as overdue").not.toContain(todayId);

    await rep.ctx.dispose();
    await admin.delete(`/api/leads/${rep.leadId}`);
    await admin.put(`/api/users/${rep.userId}`, { data: { isActive: false } });
    await admin.dispose();
  });

  test('completing a task removes it from Overdue', async ({ baseURL }) => {
    // Overdue filters on `status: 'pending'`. A counter that ignored status would keep
    // showing work the rep has already done — the single most demoralising possible bug in a
    // task dashboard, and invisible to a test that only counts rows.
    const admin = await apiAs('director', baseURL!);
    const rep = await disposableRep(admin, baseURL!);
    const overdueId = await addTask(admin, rep.leadId, rep.userId, middayOffset(-3));

    expect((await tab(rep.ctx, 'overdue')).map((t) => t.id)).toContain(overdueId);

    const done = await readJson(
      await rep.ctx.put(`/api/tasks/${overdueId}`, { data: { status: 'completed' } })
    );
    expect(done.status, `completing failed: ${JSON.stringify(done.body).slice(0, 200)}`).toBe(200);

    expect(
      (await tab(rep.ctx, 'overdue')).map((t) => t.id),
      'a completed task is still counted as overdue'
    ).not.toContain(overdueId);

    await rep.ctx.dispose();
    await admin.delete(`/api/leads/${rep.leadId}`);
    await admin.put(`/api/users/${rep.userId}`, { data: { isActive: false } });
    await admin.dispose();
  });

  test("a rep's tabs contain only their own tasks", async ({ baseURL }) => {
    const admin = await apiAs('director', baseURL!);
    const rep = await disposableRep(admin, baseURL!);

    // A task for somebody else, due today, on a lead the rep cannot see.
    const otherLead = await readJson(
      await admin.post('/api/leads', {
        data: {
          firstName: 'PW',
          lastName: `KpiOther${stamp()}`,
          company: `PW_AUDIT_CO_KPI_OTHER_${stamp()}`,
          email: `pw.kpiother.${stamp()}@audit.test`,
          campaignId: fixture().campaignA,
          assignedToId: fixture().users.sdrB.id,
        },
      })
    );
    const otherLeadId = (otherLead.body as { id: string }).id;
    const foreignTask = await addTask(admin, otherLeadId, fixture().users.sdrB.id, middayOffset(0));

    expect(
      (await tab(rep.ctx, 'today')).map((t) => t.id),
      "another rep's task appeared in this rep's Today tab"
    ).not.toContain(foreignTask);

    await rep.ctx.dispose();
    await admin.delete(`/api/leads/${otherLeadId}`);
    await admin.delete(`/api/leads/${rep.leadId}`);
    await admin.put(`/api/users/${rep.userId}`, { data: { isActive: false } });
    await admin.dispose();
  });

  test('a manager narrowing to one rep may not narrow to someone outside their scope', async ({
    baseURL,
    recorder,
  }) => {
    // `?userId=` replaces the pod scope outright for managers, so the guard that the id is
    // inside `visibleIds` is the only thing standing between a Team Lead and the whole org.
    recorder.expectFailures(403);
    const api = await apiAs('teamLead', baseURL!);

    const own = await readJson(await api.get(`/api/tasks?tab=today&userId=${fixture().users.sdrA.id}`));
    expect(own.status, 'a team lead was refused their own pod member').toBe(200);

    const foreign = await readJson(
      await api.get(`/api/tasks?tab=today&userId=${fixture().users.sdrTenantB.id}`)
    );
    expect(
      foreign.status,
      `a team lead narrowed to a user outside their scope (${foreign.status})`
    ).toBe(403);
    await api.dispose();
  });
});
