/**
 * Lane G — the no-silent-removal guarantee, end to end.
 *
 * This is the one lane that exists for a single product rule:
 *
 *   Removing a campaign member who still owns open work must show the operator
 *   what they are about to strand, and must refuse to proceed until they say
 *   what happens to it.
 *
 * Vitest already proves the 409 at the service layer (tests/admin-impact.test.ts).
 * What only a browser can prove is the half that protects a real director: the
 * dialog appears, it carries non-zero counts, Cancel leaves the member in place,
 * and confirming actually moves the work to the named target.
 *
 * MUTATING lane. It seeds its own campaign, members and work through the API,
 * then tears them down — it must not run concurrently against a DB another lane
 * is asserting counts on.
 *
 * ── Run it against a production build, not `next dev` ───────────────────────
 *
 *   npm run build
 *   node ./node_modules/next/dist/bin/next start -p 3200
 *   BASE_URL=http://localhost:3200 npx playwright test e2e/qa/laneG.spec.ts
 *
 * The harness writes its artefacts (qa-runs/, screenshots, notes) into the
 * project directory, which the dev server watches. Every write triggers Fast
 * Refresh, which REMOUNTS the page and resets component state — so the impact
 * dialog vanishes mid-assertion. The read-only lanes tolerate that; a lane that
 * opens a dialog and asserts on it does not.
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { attachRecorders, gotoTimed, laneDir, note, shot, type Recorder } from './_helpers';
import { PERSONAS, PASSWORD } from './personas';
import fs from 'node:fs';
import path from 'node:path';

const LANE = 'G';

/**
 * Signs in through the credentials callback rather than the login form.
 *
 * The shared `login()` helper clicks the dev-only Demo Accounts button, which
 * needs React to have hydrated. Against a dev server that is actively
 * recompiling, the markup is present but the handler is not yet attached, so
 * the click silently does nothing and the login times out. This lane asserts on
 * a mutation flow and cannot afford that flake.
 *
 * `page.request` shares the browser context's cookie jar, so the session cookie
 * set here authenticates subsequent page navigations.
 */
async function apiLogin(page: Page, email: string): Promise<void> {
  const csrfRes = await page.request.get('/api/auth/csrf');
  expect(csrfRes.ok(), 'could not read a CSRF token').toBeTruthy();
  const { csrfToken } = await csrfRes.json();

  const res = await page.request.post('/api/auth/callback/credentials', {
    form: { csrfToken, email, password: PASSWORD, redirect: 'false', json: 'true' },
    maxRedirects: 0,
  });
  // NextAuth answers a successful credentials sign-in with a redirect.
  expect([200, 302], `sign-in failed for ${email}`).toContain(res.status());

  const session = await (await page.request.get('/api/auth/session')).json();
  expect(session?.user?.email, `no session established for ${email}`).toBe(email);
}

/** Distinctive enough that a failed teardown is obvious in the UI. */
const STAMP = `qa-laneG-${Date.now()}`;

type Seeded = {
  campaignId: string;
  campaignName: string;
  clientId: string;
  fromUserId: string;
  fromUserName: string;
  toUserId: string;
  toUserName: string;
  leadIds: string[];
};

let seeded: Seeded | null = null;
let recorder: Recorder;

function record(name: string, payload: unknown): void {
  fs.writeFileSync(
    path.join(laneDir(LANE, 'data'), `${name}.json`),
    JSON.stringify(payload, null, 2)
  );
}

/**
 * Seeds through the app's own API rather than Prisma, so the lane exercises the
 * same authorization the UI does and needs no DB credentials.
 */
async function seedFixture(api: APIRequestContext): Promise<Seeded> {
  const clientRes = await api.post('/api/clients', {
    data: {
      name: `${STAMP} Client`,
      industry: 'QA',
      contactName: 'QA Contact',
      contactEmail: `${STAMP}@qa.test`,
    },
  });
  expect(clientRes.ok(), `client create failed: ${await clientRes.text()}`).toBeTruthy();
  const client = await clientRes.json();

  const campaignRes = await api.post('/api/campaigns', {
    data: { name: `${STAMP} Campaign`, clientId: client.id, status: 'active' },
  });
  expect(campaignRes.ok(), `campaign create failed: ${await campaignRes.text()}`).toBeTruthy();
  const campaign = await campaignRes.json();

  // Two real seeded SDRs — the lane moves work between them and asserts on both.
  const usersRes = await api.get('/api/admin/users');
  expect(usersRes.ok()).toBeTruthy();
  const { users } = await usersRes.json();
  const sdrs = (users as { id: string; name: string; email: string; role: string; isActive: boolean }[])
    .filter((u) => u.role === 'sdr' && u.isActive);
  expect(sdrs.length, 'need at least two active SDRs to seed this lane').toBeGreaterThanOrEqual(2);

  const from = sdrs.find((u) => u.email === PERSONAS.sdrLaneD) ?? sdrs[0];
  const to = sdrs.find((u) => u.id !== from.id)!;

  const memberRes = await api.post(`/api/campaigns/${campaign.id}/members`, {
    data: { userIds: [from.id, to.id] },
  });
  expect(memberRes.ok(), `member add failed: ${await memberRes.text()}`).toBeTruthy();

  // Give `from` work to own. Without this the dialog would legitimately show
  // zero and the lane would prove nothing.
  const leadIds: string[] = [];
  for (let i = 0; i < 3; i++) {
    const leadRes = await api.post('/api/leads', {
      data: {
        firstName: `${STAMP}-lead${i}`,
        lastName: 'Target',
        company: `${STAMP} Prospect`,
        email: `${STAMP}-lead${i}@qa.test`,
        campaignId: campaign.id,
        assignedToId: from.id,
        stage: 'new',
      },
    });
    expect(leadRes.ok(), `lead create failed: ${await leadRes.text()}`).toBeTruthy();
    leadIds.push((await leadRes.json()).id);
  }

  return {
    campaignId: campaign.id,
    campaignName: campaign.name,
    clientId: client.id,
    fromUserId: from.id,
    fromUserName: from.name,
    toUserId: to.id,
    toUserName: to.name,
    leadIds,
  };
}

async function teardown(api: APIRequestContext, s: Seeded): Promise<void> {
  for (const id of s.leadIds) {
    await api.delete(`/api/leads/${id}`).catch(() => {});
  }
  // Campaigns and clients have no DELETE by design — retire them instead so the
  // next run's overview does not flag a QA campaign as needing attention.
  await api
    .put(`/api/campaigns/${s.campaignId}`, { data: { status: 'completed' } })
    .catch(() => {});
  await api
    .put(`/api/clients/${s.clientId}`, {
      data: { status: 'churned', cascade: 'pause_campaigns', reason: 'QA lane teardown' },
    })
    .catch(() => {});
}

test.describe.configure({ mode: 'serial', timeout: 180_000 });

test.describe('Lane G — no silent removal', () => {
  test.beforeEach(async ({ page }) => {
    recorder = attachRecorders(page, LANE);
  });

  test.afterEach(async () => {
    recorder.flush('lane-g');
  });

  test('seeds a member who owns work', async ({ page }) => {
    await apiLogin(page, PERSONAS.director);
    seeded = await seedFixture(page.request);
    record('seed', seeded);
    note(LANE, `Seeded ${seeded.campaignName}: ${seeded.fromUserName} owns ${seeded.leadIds.length} leads.`);
  });

  test('the removal dialog shows non-zero impact and Cancel keeps the member', async ({ page }) => {
    expect(seeded, 'seed step must run first').not.toBeNull();
    const s = seeded!;

    await apiLogin(page, PERSONAS.director);
    await gotoTimed(page, `/admin/campaigns/${s.campaignId}/members`, recorder);

    const memberRow = page.getByRole('row').filter({ hasText: s.fromUserName });
    await expect(memberRow, 'seeded member should be listed').toBeVisible();

    await memberRow.getByRole('button', { name: /remove/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await shot(page, LANE, 'impact-dialog');

    // The whole point: the operator is told what they are about to strand.
    await expect(dialog).toContainText(/still owns live work/i);
    await expect(dialog).toContainText(/open lead/i);

    // Confirm must be inert until a handling mode is chosen.
    const confirm = dialog.getByRole('button', { name: /remove from campaign/i });
    await expect(confirm, 'confirm must be disabled before a mode is picked').toBeDisabled();

    await dialog.getByRole('button', { name: /^cancel$/i }).click();
    await expect(dialog).toBeHidden();

    // Cancel must be a true no-op, not an optimistic removal.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(
      page.getByRole('row').filter({ hasText: s.fromUserName }),
      'member must survive a cancelled removal'
    ).toBeVisible();

    note(LANE, 'PASS — impact dialog blocks removal and Cancel is a no-op.');
  });

  test('the API refuses a mode-less removal with 409 even when called directly', async ({ page }) => {
    const s = seeded!;
    await apiLogin(page, PERSONAS.director);

    // The UI guard is only half of it. A caller bypassing the dialog must also
    // be refused, otherwise the guarantee is cosmetic.
    const res = await page.request.delete(`/api/campaigns/${s.campaignId}/members`, {
      data: { userId: s.fromUserId },
    });
    expect(res.status(), 'mode-less removal must be refused').toBe(409);

    const body = await res.json();
    expect(body.impact?.openLeads, 'the 409 must carry the counts').toBeGreaterThan(0);
    record('mode-less-409', body);

    note(LANE, `PASS — direct DELETE without a mode returned 409 with ${body.impact.openLeads} open leads.`);
  });

  test('transferring moves the work to the named target and removes the member', async ({ page }) => {
    const s = seeded!;
    await apiLogin(page, PERSONAS.director);
    await gotoTimed(page, `/admin/campaigns/${s.campaignId}/members`, recorder);

    const before = await impactFor(page, s.campaignId, s.fromUserId);
    expect(before.openLeads, 'fixture must still have open leads').toBeGreaterThan(0);

    const memberRow = page.getByRole('row').filter({ hasText: s.fromUserName });
    await memberRow.getByRole('button', { name: /remove/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: /transfer to another user/i }).check();
    // Select by value: the option label carries a role suffix and sometimes a
    // "will be added to the campaign" note, so matching on text is brittle.
    await dialog.getByRole('combobox').selectOption(s.toUserId);
    await dialog.getByRole('textbox').fill('QA lane G — transfer proof');

    const confirm = dialog.getByRole('button', { name: /remove from campaign/i });
    await expect(confirm, 'confirm should enable once a mode and target are chosen').toBeEnabled();
    await shot(page, LANE, 'transfer-ready');
    await confirm.click();

    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(
      page.getByRole('row').filter({ hasText: s.fromUserName }),
      'member should be gone after a completed transfer'
    ).toBeHidden({ timeout: 30_000 });

    // The counts must land on the target, not simply vanish.
    const after = await impactFor(page, s.campaignId, s.toUserId);
    expect(after.openLeads, 'the target must now own the transferred leads').toBeGreaterThanOrEqual(
      before.openLeads
    );

    record('transfer-result', { before, after });
    note(
      LANE,
      `PASS — ${before.openLeads} open leads moved from ${s.fromUserName} to ${s.toUserName}.`
    );
  });

  test('teardown', async ({ page }) => {
    if (!seeded) return;
    await apiLogin(page, PERSONAS.director);
    await teardown(page.request, seeded);
    note(LANE, 'Teardown complete.');
  });
});

async function impactFor(
  page: Page,
  campaignId: string,
  userId: string
): Promise<{ openLeads: number; openTasks: number; totalOpen: number }> {
  const res = await page.request.get(`/api/campaigns/${campaignId}/member-impact/${userId}`);
  expect(res.ok(), `impact fetch failed: ${await res.text()}`).toBeTruthy();
  return res.json();
}
