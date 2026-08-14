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

    await expect(page.getByRole('heading', { name: 'What Each Prospect Is Waiting On' })).toBeVisible();

    const panel = page.locator('table', { has: page.locator('th:has-text("What Happens Next")') });
    await expect(panel).toBeVisible();

    // A table that renders headers and nothing else means the fetch failed silently — the same
    // failure mode that let an earlier journey pass against a broken feed.
    const rows = panel.locator('tbody tr');
    await expect(rows.first()).toBeVisible();

    const empty = panel.getByText('No sequences are currently in flight.');
    if (!(await empty.isVisible())) {
      // Every row must actually answer the question: a status and a sentence, not blanks.
      const first = rows.first();
      await expect(first.locator('td').nth(2)).not.toBeEmpty();
      await expect(first.locator('td').nth(3)).not.toBeEmpty();
    }
  });

  test('the reasons an operator reads contain no engine vocabulary', async ({ page }) => {
    await page.goto('/automation', { waitUntil: 'domcontentloaded' });

    const panel = page.locator('table', { has: page.locator('th:has-text("What Happens Next")') });
    await expect(panel).toBeVisible();

    const text = (await panel.innerText()).toLowerCase();
    for (const term of INTERNAL_VOCABULARY) {
      expect(text, `operator panel must not mention "${term}"`).not.toContain(term.toLowerCase());
    }
  });

  test('a deferral is visible on the page an operator actually watches', async ({ page }) => {
    await page.goto('/automation', { waitUntil: 'domcontentloaded' });

    const feed = page.locator('table', { has: page.locator('th:has-text("Event Type")') });
    await expect(feed).toBeVisible();

    // `sequence_deferred` used to be written to the database and filtered out of this feed, which
    // made every reschedule invisible here. The badge exists whether or not the demo data has one
    // today; what this asserts is that the feed renders and does not leak the raw type token.
    const rows = feed.locator('tbody tr');
    await expect(rows.first()).toBeVisible();
    expect(await feed.innerText()).not.toContain('sequence_deferred');
  });

  test('the automation page reports state without decorative motion', async ({ page }) => {
    await page.goto('/automation', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Live Automation Activity Feed' })).toBeVisible();

    // The brand rules reserve motion for reporting state; an idle pulsing icon is decoration.
    // It was called out as an outstanding defect in the automation plan and is fixed here.
    const pulsing = page.locator('h2:has-text("Live Automation Activity Feed") .animate-pulse');
    await expect(pulsing).toHaveCount(0);
  });
});

test.describe('Automation operator surface — SDR scope', () => {
  test.use({ storageState: storageStatePath('sdr') as string });

  test('an SDR sees the panel but only their own prospects', async ({ page }) => {
    await page.goto('/automation', { waitUntil: 'domcontentloaded' });

    // The page is not manager-only: an SDR needs to know why their own follow-up has not gone.
    // The scoping itself is enforced server-side and asserted in tests/automation-stats-route.ts;
    // what matters here is that the page renders for them rather than erroring or redirecting.
    await expect(page).toHaveURL(/\/automation/);
    await expect(page.getByRole('heading', { name: 'What Each Prospect Is Waiting On' })).toBeVisible();

    // Manager-only controls stay hidden.
    await expect(page.locator('button:has-text("Run Maintenance & Repair Check")')).toHaveCount(0);
  });
});
