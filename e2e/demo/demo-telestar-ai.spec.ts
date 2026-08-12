import { test, expect, request, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * The demo walkthrough — one prospect, end to end.
 *
 * ```text
 * sign in → console → the prospect → research → why AI contacted them
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
 * Screenshots land in `playwright/demo-shots/` so a presenter can see what the last run looked
 * like without replaying it.
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

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

/** Open a prospect in the console and wait for its handoff package. */
async function openProspect(page: Page, leadId: string): Promise<void> {
  await page.getByTestId(`prospect-${leadId}`).first().click();
  await expect(page.getByTestId('handoff-package')).toBeVisible();
}

test.describe('Telestar AI — demo walkthrough', () => {
  test.describe.configure({ mode: 'serial' });

  test('the SDR story: research, reply, classification, handoff, assistance', async ({ page, baseURL }) => {
    await signIn(page, baseURL!, SDR_EMAIL);

    // ---------------------------------------------------------------- the board
    await page.goto('/ai');
    await expect(page.getByRole('heading', { name: 'Telestar AI Console' })).toBeVisible();
    await expect(page.getByTestId('console-buckets')).toBeVisible();
    await expect(page.getByTestId('bucket-ai_managed-count')).not.toHaveText('0');
    await shot(page, '01-console');

    // ---------------------------------------------------------------- the prospect
    await openProspect(page, DANA);
    await expect(page.getByTestId('operating-state')).toHaveText('ai_managed');
    // Research evidence is what the outreach was grounded in — the "why did AI contact them".
    await expect(page.getByTestId('why-contacted')).toContainText('Rotterdam');
    await shot(page, '02-prospect-and-research');

    // ---------------------------------------------------------------- the reply
    await page.getByTestId('demo-reply-interest').click();
    await expect(page.getByTestId('handback-result')).toContainText('class C');
    await expect(page.getByTestId('handback-result')).toContainText('handed to the SDR');

    await openProspect(page, DANA);
    // AI has stopped touching the prospect and a human owns them.
    await expect(page.getByTestId('operating-state')).toHaveText('human_attention');
    await expect(page.getByTestId('latest-reply')).toContainText('implementation works');
    await expect(page.getByTestId('reply-kind')).toBeVisible();
    await expect(page.getByTestId('recommended-objective')).not.toBeEmpty();
    await shot(page, '03-handoff-package');

    // The prospect now sits in the SDR's attention bucket.
    await expect(page.getByTestId('bucket-needs_attention-count')).not.toHaveText('0');

    // ---------------------------------------------------------------- AI assists, never sends
    await page.getByTestId('assist-reply_draft').click();
    await expect(page.getByTestId('assist-output')).toBeVisible({ timeout: 30_000 });
    // With no provider configured this reports unavailability *and* still shows the CRM's own
    // objective — the degradation path is part of the demo, not a failure of it.
    await expect(page.getByTestId('assist-output')).toContainText(/Suggested reply|AI is unavailable/);
    await shot(page, '04-ai-assistance');
  });

  test('the ownership loop: waiting, re-engagement eligible, explicit handback', async ({ page, baseURL }) => {
    await signIn(page, baseURL!, SDR_EMAIL);
    await page.goto('/ai');

    // Marcus was seeded already waiting, with his last touch far enough back to be eligible.
    await expect(page.getByTestId('bucket-waiting-count')).not.toHaveText('0');
    await openProspect(page, MARCUS);
    await expect(page.getByTestId('operating-state')).toHaveText('waiting_for_prospect');
    await shot(page, '05-waiting');

    // Handback is the SDR's explicit action. It opens a work order and starts no outreach.
    await page.getByTestId('handback').click();
    await expect(page.getByTestId('handback-result')).toContainText('Re-engagement work order');
    await expect(page.getByTestId('handback-result')).toContainText('No outreach has started');
    await shot(page, '06-handback');

    await openProspect(page, MARCUS);
    await expect(page.getByTestId('operating-state')).toHaveText('ai_reengagement');
  });

  test('the manager view: totals, timeline and a proposed playbook change', async ({ page, baseURL }) => {
    await signIn(page, baseURL!, DIRECTOR_EMAIL);
    await page.goto('/ai');

    await expect(page.getByRole('heading', { name: 'Telestar AI Console' })).toBeVisible();
    await expect(page.getByTestId('total-ai-managed')).toBeVisible();
    await expect(page.getByTestId('total-human-owned')).toBeVisible();
    await expect(page.getByTestId('timeline')).toBeVisible();

    // Phase 10, demo minimum: an outcome, its evidence, and a change that requires a human.
    await expect(page.getByTestId('insights')).toBeVisible();
    await expect(page.getByTestId('insights')).toContainText('Positive reply');
    await expect(page.getByTestId('insights')).toContainText('manager approval required');
    await shot(page, '07-manager-view');
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
  });
});
