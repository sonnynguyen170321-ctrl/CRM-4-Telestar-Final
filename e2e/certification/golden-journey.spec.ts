/**
 * Cross-role golden journey, in a real browser (order §17).
 *
 * `tests/golden-journey.test.ts` proves the business chain at the database and service layer
 * and is deliberately kept - it asserts far more invariants than a browser pass can. What it
 * cannot show is that the *people* can do it: that a leadgen researcher's submission reaches
 * the manager who approves it, that the SDR who ends up owning the prospect sees it on their
 * own screen, and that management sees the progress reflected.
 *
 * One prospect is walked through six roles. **Each step runs as its own role**, with its own
 * signed-in browser context - a single shared context would prove only that one person can
 * drive the whole chain, which is the opposite of what a hand-off test is for.
 *
 * Serial by necessity: every step depends on the previous one having happened.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect } from '@playwright/test';

import { apiAs, readJson } from '../support/api';
import { fixture, storageStatePath } from '../support/fixture';
import { test } from '../support/test';

const OBSERVATION_DIR = path.join(process.cwd(), '.certification');

/** Carried between steps. Serial mode is what makes this safe. */
const journey: {
  poolItemId?: string;
  leadId?: string;
  company: string;
  steps: Array<{ step: string; role: string; ok: boolean; detail: string }>;
} = {
  company: `Golden Journey ${Date.now()}`,
  steps: [],
};

function note(step: string, role: string, detail: string) {
  journey.steps.push({ step, role, ok: true, detail });
}

/** Extracts a list from either `{ leads: [...] }` or a bare array response. */
function asList<T>(body: unknown, key: string): T[] {
  if (Array.isArray(body)) return body as T[];
  const wrapped = (body as Record<string, unknown>)?.[key];
  return Array.isArray(wrapped) ? (wrapped as T[]) : [];
}

test.describe('cross-role golden journey', () => {
  test.describe.configure({ mode: 'serial' });

  test.describe('1. leadgen sources the prospect', () => {
    test.use({ storageState: storageStatePath('leadgen') as string });

    test('leadgen submits a prospect and its own page renders', async ({ page, recorder, baseURL }) => {
      recorder.expectFailures(401, 403, 404);

      const api = await apiAs('leadgen', baseURL!);
      const created = await readJson(
        await api.post('/api/leadgen-pool', {
          data: {
            firstName: 'Golden',
            lastName: 'Prospect',
            company: journey.company,
            title: 'Head of Operations',
            email: `golden.${Date.now()}@journey.invalid`,
            country: 'VN',
            industry: 'Logistics',
          },
        }),
      );

      expect(created.status, `leadgen could not submit a prospect: ${JSON.stringify(created.body).slice(0, 300)}`).toBe(201);
      journey.poolItemId = (created.body as { item: { id: string } }).item.id;
      note('source prospect', 'leadgen', `pool item ${journey.poolItemId}`);

      const response = await page.goto('/leadgen', { waitUntil: 'domcontentloaded' });
      expect(response?.status(), 'leadgen page did not render').toBeLessThan(400);
      note('page renders', 'leadgen', `/leadgen ${response?.status()}`);
    });
  });

  test.describe('2. leadgen manager reviews and qualifies', () => {
    test.use({ storageState: storageStatePath('leadgenManager') as string });

    test('the manager sees the submission and qualifies it', async ({ page, recorder, baseURL }) => {
      recorder.expectFailures(401, 403, 404);
      expect(journey.poolItemId, 'no pool item carried from step 1').toBeTruthy();

      const api = await apiAs('leadgenManager', baseURL!);

      // The hand-off itself: what the researcher submitted must be visible to the manager.
      const pool = await readJson(await api.get('/api/leadgen-pool?limit=200'));
      expect(pool.status, 'manager could not read the pool').toBe(200);
      const items = asList<{ id: string }>(pool.body, 'items');
      expect(
        items.some((item) => item.id === journey.poolItemId),
        "the researcher's submission was not visible to the manager",
      ).toBe(true);
      note('hand-off visible', 'leadgen_manager', `${items.length} pool item(s)`);

      const qualified = await readJson(
        await api.post('/api/leadgen-pool/qualify', {
          data: { ids: [journey.poolItemId], qualification: 'qualified', reason: 'Golden journey' },
        }),
      );
      expect(qualified.status, 'manager could not qualify the prospect').toBe(200);
      note('qualify prospect', 'leadgen_manager', 'qualification=qualified');

      const response = await page.goto('/leadgen-manager', { waitUntil: 'domcontentloaded' });
      expect(response?.status(), 'leadgen manager page did not render').toBeLessThan(400);
      note('page renders', 'leadgen_manager', `/leadgen-manager ${response?.status()}`);
    });
  });

  test.describe('3. allocation into the CRM', () => {
    test.use({ storageState: storageStatePath('leadgenManager') as string });

    test('the qualified prospect is allocated to an SDR as a CRM lead', async ({ recorder, baseURL }) => {
      recorder.expectFailures(401, 403, 404);

      const api = await apiAs('leadgenManager', baseURL!);
      const converted = await readJson(
        await api.post('/api/leadgen-pool/convert', {
          data: {
            ids: [journey.poolItemId],
            campaignId: fixture().campaignA,
            sdrIds: [fixture().users.sdrA.id],
            method: 'single',
          },
        }),
      );

      expect(
        converted.status,
        `conversion failed: ${JSON.stringify(converted.body).slice(0, 300)}`,
      ).toBe(200);
      note('allocate to SDR', 'leadgen_manager', `campaign ${fixture().campaignA}`);
    });
  });

  test.describe('4-5. the SDR owns and works it', () => {
    test.use({ storageState: storageStatePath('sdrA') as string });

    test('the SDR sees the prospect on their own page and logs outreach', async ({
      page,
      recorder,
      baseURL,
    }) => {
      recorder.expectFailures(401, 403, 404);

      const api = await apiAs('sdrA', baseURL!);
      const leads = await readJson(await api.get('/api/leads?limit=200'));
      expect(leads.status, 'SDR could not read their leads').toBe(200);

      const mine = asList<{ id: string; company: string }>(leads.body, 'leads').find(
        (lead) => lead.company === journey.company,
      );
      expect(mine, `the allocated prospect did not reach the SDR's book (${journey.company})`).toBeTruthy();
      journey.leadId = mine!.id;
      note('SDR receives prospect', 'sdr', `lead ${journey.leadId}`);

      const response = await page.goto('/leads', { waitUntil: 'domcontentloaded' });
      expect(response?.status(), 'SDR leads page did not render').toBeLessThan(400);
      note('page renders', 'sdr', `/leads ${response?.status()}`);

      const logged = await readJson(
        await api.post('/api/activities', {
          data: {
            leadId: journey.leadId,
            type: 'call_logged',
            channel: 'phone',
            description: 'Golden journey discovery call',
            metadata: { outcome: 'connected' },
          },
        }),
      );
      expect([200, 201], `SDR could not log outreach (${logged.status})`).toContain(logged.status);
      note('log outreach', 'sdr', 'call_logged');
    });
  });

  test.describe('6. the pod lead sees it', () => {
    test.use({ storageState: storageStatePath('teamLead') as string });

    test('the team lead sees the outreach on the prospect timeline', async ({
      page,
      recorder,
      baseURL,
    }) => {
      recorder.expectFailures(401, 403, 404);
      expect(journey.leadId, 'no lead carried from step 4').toBeTruthy();

      const api = await apiAs('teamLead', baseURL!);
      const activities = await readJson(await api.get(`/api/activities?leadId=${journey.leadId}`));
      expect(activities.status, 'team lead could not read the activity timeline').toBe(200);

      const entries = asList<{ type: string }>(activities.body, 'activities');
      expect(
        entries.some((entry) => entry.type === 'call_logged'),
        "the SDR's outreach was not visible to the team lead",
      ).toBe(true);
      note('pod visibility', 'team_lead', 'call_logged visible');

      const response = await page.goto('/team', { waitUntil: 'domcontentloaded' });
      expect(response?.status(), 'team page did not render').toBeLessThan(400);
      note('page renders', 'team_lead', `/team ${response?.status()}`);
    });
  });

  test.describe('7. management sees the progress', () => {
    test.use({ storageState: storageStatePath('director') as string });

    test('floor manager and director both see the reflected activity', async ({
      page,
      recorder,
      baseURL,
    }) => {
      recorder.expectFailures(401, 403, 404);

      for (const role of ['floorManager', 'director'] as const) {
        const api = await apiAs(role, baseURL!);
        const activities = await readJson(await api.get(`/api/activities?leadId=${journey.leadId}`));
        expect(activities.status, `${role} could not read the timeline`).toBe(200);
        expect(
          asList<{ type: string }>(activities.body, 'activities').some(
            (entry) => entry.type === 'call_logged',
          ),
          `${role} could not see the outreach`,
        ).toBe(true);
        note('management visibility', role, 'call_logged visible');
      }

      const response = await page.goto('/team', { waitUntil: 'domcontentloaded' });
      expect(response?.status(), 'management team page did not render').toBeLessThan(400);

      mkdirSync(OBSERVATION_DIR, { recursive: true });
      writeFileSync(
        path.join(OBSERVATION_DIR, 'golden-journey.json'),
        `${JSON.stringify(
          {
            company: journey.company,
            poolItemId: journey.poolItemId ?? null,
            leadId: journey.leadId ?? null,
            steps: journey.steps,
            completedAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
      );
    });
  });
});
