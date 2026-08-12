import { test, expect, request, type Page } from '@playwright/test';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'TelestarDemo!2026';
const SDR_EMAIL = 'demo.sdr@telestar.demo';
const DANA = 'demo-lead-dana';

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

async function openProspect(page: Page, leadId: string): Promise<void> {
  await page.goto('/ai');
  await page.getByTestId(`prospect-${leadId}`).first().click();
  await expect(page.getByTestId('handoff-package')).toBeVisible({ timeout: 45_000 });
}

test.describe('SDR Exception Workflows (Reply Classes A, B, D)', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  test.beforeEach(async ({ page, baseURL }) => {
    await signIn(page, baseURL!, SDR_EMAIL);
  });

  test('Reply Class A (Opt-Out / Stop) operational workflow', async ({ page }) => {
    await openProspect(page, DANA);
    await page.getByTestId('demo-reply-unsubscribe').click();

    await page.goto('/inbox');
    await expect(page.getByText('Unified Inbox')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText(/Class A/i).first()).toBeVisible({ timeout: 45_000 });
  });

  test('Reply Class B (Administrative / OOO) operational workflow', async ({ page }) => {
    await openProspect(page, DANA);
    await page.getByTestId('demo-reply-ooo').click();

    await page.goto('/inbox');
    await expect(page.getByText('Unified Inbox')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText(/Class B/i).first()).toBeVisible({ timeout: 45_000 });
  });

  test('Reply Class D (Human Review Required) operational workflow', async ({ page }) => {
    await openProspect(page, DANA);
    await page.getByTestId('demo-reply-ambiguous').click();

    await page.goto('/inbox');
    await expect(page.getByText('Unified Inbox')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText(/Class D/i).first()).toBeVisible({ timeout: 45_000 });
  });
});
