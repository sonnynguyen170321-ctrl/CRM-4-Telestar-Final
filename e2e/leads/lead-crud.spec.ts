/**
 * §13 — lead management, and §47 — persistence.
 *
 * The rule this file follows: **every mutation is verified after a re-read, not from the
 * response body.** A 200 proves the request was accepted; it does not prove anything was
 * written, and React optimistic state proves less than that. So each case mutates, re-reads
 * through a fresh request, and asserts on what came back from the database.
 *
 * §14's activity-trail requirement is covered where the API exposes it: stage changes and
 * notes are asserted against `/api/activities`, because the auto-logging described in
 * `SKILL.md` is the source of truth for Team View and coaching. If that
 * silently stopped working, nothing else in the product would fail loudly.
 *
 * Data is `PW_AUDIT`-prefixed per §53 and each test archives what it created.
 */
import { test, expect } from '../support/test';
import { apiAs, readJson } from '../support/api';
import { fixture } from '../support/fixture';
import { uniqueSuffix } from '../support/ids';
import type { APIRequestContext } from '@playwright/test';

const stamp = () => `${Date.now()}${uniqueSuffix()}`;

type Lead = {
  id: string;
  firstName: string;
  lastName: string;
  company: string;
  email: string;
  stage: string;
  tags?: string[];
  assignedToId?: string;
  archivedAt?: string | null;
};

async function createLead(api: APIRequestContext, overrides: Record<string, unknown> = {}) {
  const s = stamp();
  const res = await api.post('/api/leads', {
    data: {
      firstName: 'PW',
      lastName: `Lead${s}`,
      company: `PW_AUDIT_CO_${s}`,
      email: `pw.lead.${s}@audit.test`,
      campaignId: fixture().campaignA,
      assignedToId: fixture().users.sdrA.id,
      ...overrides,
    },
  });
  const { status, body } = await readJson(res);
  expect(status, `lead create failed: ${JSON.stringify(body).slice(0, 300)}`).toBeLessThan(300);
  return body as Lead;
}

/** Re-read straight from the API. Never trust the body of the mutation itself. */
async function readLead(api: APIRequestContext, id: string) {
  const { status, body } = await readJson(await api.get(`/api/leads/${id}`));
  expect(status, `lead re-read failed for ${id}`).toBe(200);
  return body as Lead;
}

async function archive(api: APIRequestContext, id: string) {
  await api.delete(`/api/leads/${id}`);
}

test.describe('lead CRUD', () => {
  test('a created lead persists with the fields it was given', async ({ baseURL }) => {
    const api = await apiAs('director', baseURL!);
    const created = await createLead(api);

    const reread = await readLead(api, created.id);
    expect(reread.company).toBe(created.company);
    expect(reread.email).toBe(created.email);
    expect(reread.stage, 'a new lead should start in the `new` stage').toBe('new');

    await archive(api, created.id);
    await api.dispose();
  });

  test('an edit survives a re-read', async ({ baseURL }) => {
    const api = await apiAs('director', baseURL!);
    const lead = await createLead(api);

    const edited = `PW_AUDIT_CO_EDITED_${stamp()}`;
    const { status } = await readJson(
      await api.put(`/api/leads/${lead.id}`, { data: { company: edited, title: 'PW Auditor' } })
    );
    expect(status).toBe(200);

    const reread = await readLead(api, lead.id);
    expect(reread.company, 'the edit did not persist').toBe(edited);

    await archive(api, lead.id);
    await api.dispose();
  });

  test('a stage change persists and writes an activity', async ({ baseURL }) => {
    const api = await apiAs('director', baseURL!);
    const lead = await createLead(api);

    const { status } = await readJson(
      await api.put(`/api/leads/${lead.id}`, { data: { stage: 'replied' } })
    );
    expect(status).toBe(200);
    expect((await readLead(api, lead.id)).stage).toBe('replied');

    // Auto-logging is a cross-cutting guarantee, not a nice-to-have: the Team View
    // leaderboard and coaching read from this table.
    const { body } = await readJson(await api.get(`/api/activities?leadId=${lead.id}&limit=50`));
    const rows = (Array.isArray(body) ? body : (body as { activities?: unknown[] }).activities ?? []) as {
      type?: string;
      leadId?: string;
    }[];
    expect(
      rows.some((a) => a.leadId === lead.id),
      'a stage change wrote no activity for the lead'
    ).toBe(true);

    await archive(api, lead.id);
    await api.dispose();
  });

  test('priority and tags persist', async ({ baseURL }) => {
    const api = await apiAs('director', baseURL!);
    const lead = await createLead(api);

    const { status } = await readJson(
      await api.put(`/api/leads/${lead.id}`, {
        data: { priority: 'hot', tags: ['PW_AUDIT_TAG', 'second'] },
      })
    );
    expect(status).toBe(200);

    const reread = await readLead(api, lead.id);
    expect(reread.tags ?? []).toContain('PW_AUDIT_TAG');

    await archive(api, lead.id);
    await api.dispose();
  });

  test('reassigning a lead moves it into the new owner scope', async ({ baseURL }) => {
    // Ownership is the thing role scoping is built on, so asserting the field changed is not
    // enough — the new owner has to actually be able to read it, and the old one not.
    const api = await apiAs('director', baseURL!);
    const lead = await createLead(api, { assignedToId: fixture().users.sdrA.id });

    const { status } = await readJson(
      await api.put(`/api/leads/${lead.id}`, { data: { assignedToId: fixture().users.sdrB.id } })
    );
    expect(status).toBe(200);

    const newOwner = await apiAs('sdrB', baseURL!);
    expect((await readJson(await newOwner.get(`/api/leads/${lead.id}`))).status).toBe(200);
    await newOwner.dispose();

    const oldOwner = await apiAs('sdrA', baseURL!);
    const refused = await readJson(await oldOwner.get(`/api/leads/${lead.id}`));
    expect([403, 404], `the previous owner can still read the lead (${refused.status})`).toContain(
      refused.status
    );
    await oldOwner.dispose();

    await archive(api, lead.id);
    await api.dispose();
  });

  test('archiving soft-deletes rather than destroying the row', async ({ baseURL, recorder }) => {
    // `.claude/rules/workers-runtime.md` forbids hard delete for archive, so this asserts
    // the row survives — a 404 on re-read would be indistinguishable from data loss.
    recorder.expectFailures(404, 403);
    const api = await apiAs('director', baseURL!);
    const lead = await createLead(api);

    const { status } = await readJson(await api.delete(`/api/leads/${lead.id}`));
    expect(status, 'archive request failed').toBeLessThan(300);

    const listed = await readJson(await api.get('/api/leads?limit=200'));
    const rows = (Array.isArray(listed.body) ? listed.body : (listed.body as { leads?: unknown[] }).leads ?? []) as {
      id?: string;
    }[];
    expect(rows.some((r) => r.id === lead.id), 'an archived lead is still in the default list').toBe(
      false
    );

    // Restore proves the row was not destroyed.
    const restored = await readJson(await api.post(`/api/leads/${lead.id}/restore`));
    expect(
      restored.status,
      `restore failed (${restored.status}) — archive may have hard-deleted the row`
    ).toBeLessThan(300);
    expect((await readLead(api, lead.id)).id).toBe(lead.id);

    await archive(api, lead.id);
    await api.dispose();
  });
});

test.describe('notes and reminders', () => {
  test('a note persists against its lead', async ({ baseURL }) => {
    const api = await apiAs('director', baseURL!);
    const lead = await createLead(api);
    const content = `PW_AUDIT_NOTE_${stamp()}`;

    const { status } = await readJson(
      await api.post('/api/notes', { data: { leadId: lead.id, content } })
    );
    expect(status).toBeLessThan(300);

    const { body } = await readJson(await api.get(`/api/notes?leadId=${lead.id}`));
    const notes = (Array.isArray(body) ? body : (body as { notes?: unknown[] }).notes ?? []) as {
      content?: string;
    }[];
    expect(notes.some((n) => n.content === content), 'the note did not persist').toBe(true);

    await archive(api, lead.id);
    await api.dispose();
  });

  test('a reminder persists against its lead', async ({ baseURL }) => {
    const api = await apiAs('director', baseURL!);
    const lead = await createLead(api);
    const text = `PW_AUDIT_REMINDER_${stamp()}`;

    const { status } = await readJson(
      await api.post('/api/reminders', {
        data: { leadId: lead.id, text, dueAt: new Date(Date.now() + 86_400_000).toISOString() },
      })
    );
    expect(status).toBeLessThan(300);

    const { body } = await readJson(await api.get('/api/reminders'));
    const rows = (Array.isArray(body) ? body : (body as { reminders?: unknown[] }).reminders ?? []) as {
      text?: string;
    }[];
    expect(rows.some((r) => r.text === text), 'the reminder did not persist').toBe(true);

    await archive(api, lead.id);
    await api.dispose();
  });
});

test.describe('concurrency', () => {
  test('two simultaneous creates of the same email do not both succeed', async ({
    baseURL,
    recorder,
  }) => {
    // §46. There is a partial unique index on (tenantId, campaignId, normalizedEmail), so the
    // expected outcome is one row — either one request loses, or both resolve to the same lead.
    recorder.expectFailures(400, 409, 422, 500);
    const api = await apiAs('director', baseURL!);
    const s = stamp();
    const payload = {
      firstName: 'PW',
      lastName: `Race${s}`,
      company: `PW_AUDIT_CO_RACE_${s}`,
      email: `pw.race.${s}@audit.test`,
      campaignId: fixture().campaignA,
      assignedToId: fixture().users.sdrA.id,
    };

    const [a, b] = await Promise.all([
      api.post('/api/leads', { data: payload }),
      api.post('/api/leads', { data: payload }),
    ]);
    const results = [await readJson(a), await readJson(b)];

    const { body } = await readJson(
      await api.get(`/api/leads?search=${encodeURIComponent(payload.email)}&limit=50`)
    );
    const rows = (Array.isArray(body) ? body : (body as { leads?: unknown[] }).leads ?? []) as {
      id?: string;
      email?: string;
    }[];
    const matches = rows.filter((r) => r.email === payload.email);
    expect(
      matches.length,
      `duplicate leads created for one email (statuses ${results.map((r) => r.status).join(',')})`
    ).toBeLessThanOrEqual(1);

    for (const m of matches) await archive(api, m.id!);
    await api.dispose();
  });
});
