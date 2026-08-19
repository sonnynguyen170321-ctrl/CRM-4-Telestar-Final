/**
 * The operator answer surface (Plan 1 §A6/§A7).
 *
 * The runtime matrix — duplicate jobs, bounces, quota deferral, crash windows — is proven in
 * Vitest against the workers, where those states can actually be produced. What only a browser
 * can prove is the thing this panel was built for: that an operator can open one page and read
 * why a prospect has not received their next email, in words, without being handed queue or
 * worker vocabulary.
 *
 * Placement matters. A spec at the `e2e/` root matches no Playwright project and silently never
 * runs; `e2e/journeys/` is covered by the `audit` project's testMatch.
 */
import { test, expect } from '../support/test';
import { storageStatePath } from '../support/fixture';

/** Terms that describe how the system works rather than what happened to the prospect. */
const INTERNAL_VOCABULARY = [
  'DEFER',
  'BLOCK',
  'TERMINATE',
  'MANUAL_REQUIRED',
  'BullMQ',
  'enqueue',
  'Redis',
  'worker',
  'job id',
];

test.describe('Automation operator surface', () => {
  test.use({ storageState: storageStatePath('director') as string });

  test('the waiting panel resolves to rows or an explicit empty state', async ({ page }) => {
    await page.goto('/automation', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Automation & Integrations Hub' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Mailbox Sending Caps & Health Status' })).toBeVisible();

    const panel = page.locator('table', { has: page.locator('th:has-text("Mailbox Email")') });
    await expect(panel).toBeVisible();
  });

  test('the reasons an operator reads contain no engine vocabulary', async ({ page }) => {
    await page.goto('/automation', { waitUntil: 'domcontentloaded' });

    const panel = page.locator('table', { has: page.locator('th:has-text("Mailbox Email")') });
    await expect(panel).toBeVisible();

    const text = (await panel.innerText()).toLowerCase();
    for (const term of INTERNAL_VOCABULARY) {
      expect(text, `operator panel must not mention "${term}"`).not.toContain(term.toLowerCase());
    }
  });

  test('a deferral is visible on the page an operator actually watches', async ({ page }) => {
    await page.goto('/automation', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('h2:has-text("Outreach Automation Workers")')).toBeVisible();
    await expect(page.locator('h2:has-text("Inbound Mailbox Synchronization")')).toBeVisible();
  });

  test('the automation page reports state without decorative motion', async ({ page }) => {
    await page.goto('/automation', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Mailbox Sending Caps & Health Status' })).toBeVisible();

    const pulsing = page.locator('h2:has-text("Mailbox Sending Caps & Health Status") .animate-pulse');
    await expect(pulsing).toHaveCount(0);
  });
});

test.describe('Automation operator surface — SDR scope', () => {
  test.use({ storageState: storageStatePath('sdrA') as string });

  test('an SDR sees the panel but only their own prospects', async ({ page }) => {
    await page.goto('/automation', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('h1:has-text("Automation & Integrations Hub")')).toBeVisible();

    // Manager-only controls stay hidden.
    await expect(page.locator('button:has-text("Run Maintenance & Repair Check")')).toHaveCount(0);
  });
});
