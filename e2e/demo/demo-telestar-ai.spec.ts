import { test, expect, request, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * The demo walkthrough — one prospect, end to end, in the order it is presented.
 *
 * ```text
 * sign in → dashboard → leads → command center → the prospect → research
 *   → a controlled inbound reply → classification → handoff
 *   → AI assistance the SDR reads and edits
 *   → the ghosted prospect → re-engagement eligible → explicit handback
 *   → the manager view and the proposed playbook change
 * ```
 *
 * It drives the real product: the reply goes through `handleApplyReply`, the handoff through the
 * transition service, the handback through a `reengagement` work order. Nothing here is staged.
 *
 * Requires the demo tenant:
 *
 * ```bash
 * npm run demo:reset
 * BASE_URL=http://localhost:3000 npx playwright test --project=demo
 * ```
 *
 * Screenshots land in `playwright/demo-shots/` under the eight names the presentation deck
 * expects, so a presenter has a usable fallback without replaying the run.
 */

const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'TelestarDemo!2026';
const SDR_EMAIL = 'demo.sdr@telestar.demo';
const DIRECTOR_EMAIL = 'demo.director@telestar.demo';
const DANA = 'demo-lead-dana';
const MARCUS = 'demo-lead-marcus';

const SHOTS = path.join('playwright', 'demo-shots');

/**
 * Sign in over the API, not the form.
 *
 * The login form is controlled React state whose submit handler closes over its render's values,
 * so a fast `fill` + `click` can post empty fields; and merely visiting `/login` rotates
 * next-auth's CSRF cookie. `e2e/auth/authentication.spec.ts` covers the form itself — this spec
 * only needs a valid session.
 */
async function signIn(page: Page, baseURL: string, email: string): Promise<void> {
  const ctx = await request.newContext({ baseURL });
  const { csrfToken } = (await (await ctx.get('/api/auth/csrf')).json()) as { csrfToken: string };
  const res = await ctx.post('/api/auth/callback/credentials', {
    form: { csrfToken, email, password: DEMO_PASSWORD, redirect: 'false', callbackUrl: '/' },
    maxRedirects: 0,
    failOnStatusCode: false,
  });
  expect([200, 302]).toContain(res.status());

  const cookies = await ctx.storageState();
  await page.context().addCookies(cookies.cookies);
  await ctx.dispose();
}

/**
 * Capture what the presenter will actually have on screen.
 *
 * Viewport-sized, not `fullPage`. A full-page capture of these routes paints the fixed sidebar
 * and header partway down the stitched image, which makes a perfectly correct page look broken in
 * the backup deck. `focus` scrolls the moment being illustrated into frame first.
 */
async function shot(page: Page, name: string, focus?: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  if (focus) {
    await page.getByTestId(focus).first().scrollIntoViewIfNeeded();
    // Let the smooth-scroll settle before the shutter; the app's transitions are ~200ms.
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

/** Open a prospect in the command center and wait for its intelligence workspace. */
async function openProspect(page: Page, leadId: string): Promise<void> {
  await page.getByTestId(`prospect-${leadId}`).first().click();
  await expect(page.getByTestId('handoff-package')).toBeVisible();
}

test.describe('Telestar AI — demo walkthrough', () => {
  // Serial because the story is stateful: the reply has to land before the handoff can be read.
  // The 60s default is a poor fit here — delivering the reply runs classification, the transition
  // service and its Task/Notification/Activity writes end to end, and in dev each new route
  // compiles on first hit. The budget is generous so a slow first compile reads as slow, not
  // broken.
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  test('the opening screens: dashboard and the prospect table', async ({ page, baseURL }) => {
    await signIn(page, baseURL!, SDR_EMAIL);

    // ---------------------------------------------------------------- dashboard
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Good (morning|afternoon|evening)/);
    // The demo tenant announces itself, and says outbound mail is going nowhere.
    await expect(page.getByTestId('demo-environment')).toBeVisible();
    await expect(page.getByTestId('email-dry-run')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Needs your attention' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'AI working now' })).toBeVisible();
    // Wait for the board to actually resolve — a screenshot of the skeletons is worthless as a
    // backup asset, and an assertion that only checks the headings would happily pass over one.
    await expect(page.getByText('Managing prospects')).toBeVisible();
    await shot(page, '01-dashboard');

    // ---------------------------------------------------------------- leads
    // The pipeline opens on kanban; the operating table is the other half of the same route.
    await page.goto('/leads');
    await page.getByRole('button', { name: 'Table view' }).click();
    await expect(page.getByRole('columnheader', { name: 'Operating State' })).toBeVisible();
    // Rows, not the loading skeleton and not the "no prospects match" empty state.
    await expect(page.getByRole('cell', { name: 'Dana Whitfield VP Operations' })).toBeVisible();
    // No raw enum reaches the screen — the table shows the salesperson's word for the state.
    await expect(page.locator('tbody')).not.toContainText('ready_for_outreach');
    await expect(page.locator('tbody')).not.toContainText('human_attention');
    await shot(page, '02-leads');
  });

  test('the SDR story: research, reply, classification, handoff, assistance', async ({ page, baseURL }) => {
    await signIn(page, baseURL!, SDR_EMAIL);

    // ---------------------------------------------------------------- the board
    await page.goto('/ai');
    await expect(page.getByRole('heading', { name: 'AI Command Center' })).toBeVisible();
    await expect(page.getByTestId('console-buckets')).toBeVisible();
    await expect(page.getByTestId('operating-loop')).toBeVisible();
    await expect(page.getByTestId('bucket-ai_managed-count')).not.toHaveText('0');
    await shot(page, '06-ai-command-center');

    // ---------------------------------------------------------------- the prospect
    await openProspect(page, DANA);
    // The badge reads "AI Managing"; the enum travels with it for tests and diagnostics only.
    await expect(page.getByTestId('operating-state')).toHaveAttribute('data-state', 'ai_managed');
    await expect(page.getByTestId('operating-state')).toHaveText('AI Managing');
    // Research evidence is what the outreach was grounded in — the "why did AI contact them".
    await expect(page.getByTestId('why-contacted')).toContainText('Rotterdam');
    await expect(page.getByTestId('ai-status')).toBeVisible();
    await expect(page.getByTestId('next-action')).not.toBeEmpty();
    await shot(page, '03-dana-intelligence', 'why-contacted');

    // ---------------------------------------------------------------- the reply
    // Delivering the reply runs the whole real chain — sync chokepoint, classification, the
    // handoff transition and its Task/Notification/Activity writes — so it gets a longer budget
    // than the 10s default. In dev the route also compiles on first hit.
    await page.getByTestId('demo-reply-interest').click();
    await expect(page.getByTestId('handback-result')).toContainText('class C', { timeout: 45_000 });
    await expect(page.getByTestId('handback-result')).toContainText('handed to the SDR');

    await openProspect(page, DANA);
    // AI has stopped touching the prospect and a human owns them.
    await expect(page.getByTestId('operating-state')).toHaveAttribute('data-state', 'human_attention');
    await expect(page.getByTestId('latest-reply')).toContainText('implementation works');
    await expect(page.getByTestId('latest-reply')).toContainText('AI stopped autonomous outreach');
    await expect(page.getByTestId('latest-reply')).toContainText('Ownership transferred to');
    await expect(page.getByTestId('reply-kind')).toBeVisible();
    await expect(page.getByTestId('recommended-objective')).not.toBeEmpty();
    await shot(page, '04-dana-handoff', 'latest-reply');

    // The prospect now sits in the SDR's attention bucket.
    await expect(page.getByTestId('bucket-needs_attention-count')).not.toHaveText('0');

    // ---------------------------------------------------------------- AI assists, never sends
    await page.getByTestId('assist-reply_draft').click();
    await expect(page.getByTestId('assist-output')).toBeVisible({ timeout: 30_000 });
    // With no provider configured this reports unavailability *and* still shows the CRM's own
    // objective — the degradation path is part of the demo, not a failure of it.
    await expect(page.getByTestId('assist-output')).toContainText(
      /Suggested reply|AI assistance unavailable/
    );
    await shot(page, '05-dana-ai-assistance', 'assist-output');

    // ---------------------------------------------------------------- back to the dashboard
    // Re-shot now that Dana has replied: the opening screen of the deck should show a real
    // attention queue, not the (correct, but unpersuasive) "nothing needs you" empty state that
    // the pre-reply capture in the first test necessarily gets.
    await page.goto('/');
    await expect(page.getByText('Managing prospects')).toBeVisible();
    await expect(page.getByRole('link', { name: /Review handoff/ }).first()).toBeVisible();
    await shot(page, '01-dashboard');
  });

  test('the ownership loop: waiting, re-engagement eligible, explicit handback', async ({ page, baseURL }) => {
    await signIn(page, baseURL!, SDR_EMAIL);
    await page.goto('/ai');

    // Marcus was seeded already waiting, with his last touch far enough back to be eligible.
    await expect(page.getByTestId('bucket-waiting-count')).not.toHaveText('0');
    await openProspect(page, MARCUS);
    await expect(page.getByTestId('operating-state')).toHaveAttribute('data-state', 'waiting_for_prospect');
    await expect(page.getByTestId('handback')).toBeVisible();
    await shot(page, '07-marcus-reengagement', 'handback');

    // Handback is the SDR's explicit action. It opens a work order and starts no outreach.
    await page.getByTestId('handback').click();
    await expect(page.getByTestId('handback-result')).toContainText('Re-engagement work order', {
      timeout: 45_000,
    });
    await expect(page.getByTestId('handback-result')).toContainText('No outreach has started');

    await openProspect(page, MARCUS);
    await expect(page.getByTestId('operating-state')).toHaveAttribute('data-state', 'ai_reengagement');
  });

  test('the manager view: totals, timeline and a proposed playbook change', async ({ page, baseURL }) => {
    await signIn(page, baseURL!, DIRECTOR_EMAIL);
    await page.goto('/ai');

    await expect(page.getByRole('heading', { name: 'AI Command Center' })).toBeVisible();
    await expect(page.getByTestId('total-ai-managed')).toBeVisible();
    await expect(page.getByTestId('total-human-owned')).toBeVisible();
    await expect(page.getByTestId('timeline')).toBeVisible();

    // Phase 10, demo minimum: an outcome, its evidence, and a change that requires a human.
    await expect(page.getByTestId('insights')).toBeVisible();
    await expect(page.getByTestId('insights')).toContainText('Positive reply');
    await expect(page.getByTestId('insights')).toContainText('manager approval required');
    await shot(page, '08-manager-insight', 'insights');
  });

  test('the diagnostic escape hatch answers what the prospect actually is', async ({ page, baseURL }) => {
    await signIn(page, baseURL!, SDR_EMAIL);

    const res = await page.request.get(`/api/demo/diagnostics?leadId=${DANA}`);
    expect(res.ok()).toBe(true);
    const body = await res.json();

    expect(body.lead.operatingState).toBe('human_attention');
    expect(body.enrollments.length).toBeGreaterThan(0);
    expect(body.inboundMessages[0].replyClass).toBe('C');
    expect(body.transitions.length).toBeGreaterThan(0);

    // The environment endpoint the header badge reads: demo tenant, mail not leaving the building.
    const env = await page.request.get('/api/demo/environment');
    expect(env.ok()).toBe(true);
    const envBody = await env.json();
    expect(envBody.isDemoTenant).toBe(true);
    expect(envBody.emailDryRun).toBe(true);
  });
});
