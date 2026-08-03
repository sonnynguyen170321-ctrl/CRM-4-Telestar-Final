import { test, expect } from '@playwright/test';

test.describe('Role-Based E2E Persona Journeys & Navigation', () => {
  test('Unauthenticated user is redirected to login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/.*login/);
    await expect(page.locator('text=Telestar CRM')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  // ─── 1. DIRECTOR JOURNEY ──────────────────────────────────────────────
  test.describe('1. Director Persona Journey', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/login');
      const directorBtn = page.locator('button', { hasText: 'dean@telestar.vn' });
      if (await directorBtn.isVisible()) {
        await directorBtn.click();
      } else {
        await page.fill('input[type="email"]', 'dean@telestar.vn');
        await page.fill('input[type="password"]', 'telestar2026');
        await page.click('button[type="submit"]');
      }
      await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 10000 });
    });

    test('Director has full executive access across all modules', async ({ page }) => {
      // Step 1: Director Cockpit
      await page.goto('/director');
      await expect(page.locator('h1', { hasText: 'Director Cockpit' })).toBeVisible();

      // Step 2: Team View & Floor Leaderboard
      await page.goto('/team');
      await expect(page).toHaveURL(/.*team/);

      // Step 3: Opportunities & Revenue Forecasting
      await page.goto('/opportunities');
      await expect(page).toHaveURL(/.*opportunities/);

      // Step 4: Client Performance Reports
      await page.goto('/client-reports');
      await expect(page).toHaveURL(/.*client-reports/);

      // Step 5: Deliverability & Email Health
      await page.goto('/email-health');
      await expect(page).toHaveURL(/.*email-health/);

      // Step 6: Leadgen Manager Hub
      await page.goto('/leadgen-manager');
      await expect(page).toHaveURL(/.*leadgen-manager/);
    });
  });

  // ─── 2. FLOOR MANAGER JOURNEY ─────────────────────────────────────────
  test.describe('2. Floor Manager Persona Journey', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/login');
      const fmBtn = page.locator('button', { hasText: 'sonny@telestar.vn' });
      if (await fmBtn.isVisible()) {
        await fmBtn.click();
      } else {
        await page.fill('input[type="email"]', 'sonny@telestar.vn');
        await page.fill('input[type="password"]', 'telestar2026');
        await page.click('button[type="submit"]');
      }
      await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 10000 });
    });

    test('Floor Manager accesses team supervision, meetings, and deliverability', async ({ page }) => {
      // Step 1: Team Floor Hub
      await page.goto('/team');
      await expect(page).toHaveURL(/.*team/);

      // Step 2: Leads Pipeline Oversight
      await page.goto('/leads');
      await expect(page).toHaveURL(/.*leads/);

      // Step 3: Meetings & Quality Control
      await page.goto('/meetings');
      await expect(page).toHaveURL(/.*meetings/);

      // Step 4: Deliverability Management
      await page.goto('/email-health');
      await expect(page).toHaveURL(/.*email-health/);

      // Step 5: Leadgen Manager Data Pool
      await page.goto('/leadgen-manager');
      await expect(page).toHaveURL(/.*leadgen-manager/);
    });
  });

  // ─── 3. TEAM LEAD JOURNEY ─────────────────────────────────────────────
  test.describe('3. Team Lead Persona Journey', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/login');
      const tlBtn = page.locator('button', { hasText: 'brandon@telestar.vn' });
      if (await tlBtn.isVisible()) {
        await tlBtn.click();
      } else {
        await page.fill('input[type="email"]', 'brandon@telestar.vn');
        await page.fill('input[type="password"]', 'telestar2026');
        await page.click('button[type="submit"]');
      }
      await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 10000 });
    });

    test('Team Lead supervises pod tasks and sequence executions', async ({ page }) => {
      // Step 1: Daily Task Board
      await page.goto('/');
      await expect(page).toHaveURL('/');

      // Step 2: Leads pipeline
      await page.goto('/leads');
      await expect(page).toHaveURL(/.*leads/);

      // Step 3: Sequences cadences
      await page.goto('/sequences');
      await expect(page).toHaveURL(/.*sequences/);

      // Step 4: Meetings
      await page.goto('/meetings');
      await expect(page).toHaveURL(/.*meetings/);
    });
  });

  // ─── 4. SDR JOURNEY ───────────────────────────────────────────────────
  test.describe('4. SDR Persona Journey', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/login');
      const sdrBtn = page.locator('button', { hasText: 'lan.pham@telestar.vn' });
      if (await sdrBtn.isVisible()) {
        await sdrBtn.click();
      } else {
        await page.fill('input[type="email"]', 'lan.pham@telestar.vn');
        await page.fill('input[type="password"]', 'telestar2026');
        await page.click('button[type="submit"]');
      }
      await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 10000 });
    });

    test('SDR executes focused daily task queue and is gated from executive hubs', async ({ page }) => {
      // Step 1: Task Dashboard
      await page.goto('/');
      await expect(page).toHaveURL('/');

      // Step 2: Leads pipeline
      await page.goto('/leads');
      await expect(page).toHaveURL(/.*leads/);

      // Step 3: Meetings view
      await page.goto('/meetings');
      await expect(page).toHaveURL(/.*meetings/);

      // Step 4: Unified Inbox
      await page.goto('/inbox');
      await expect(page).toHaveURL(/.*inbox/);

      // Step 5: Director Cockpit Gated
      await page.goto('/director');
      await expect(page).not.toHaveURL(/.*director/);

      // Step 6: Team Floor Gated
      await page.goto('/team');
      await expect(page).not.toHaveURL(/.*team/);
    });
  });

  // ─── 5. LEADGEN SPECIALIST JOURNEY ────────────────────────────────────
  test.describe('5. Leadgen Specialist Persona Journey', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/login');
      const leadgenBtn = page.locator('button', { hasText: 'alex@telestar.vn' });
      if (await leadgenBtn.isVisible()) {
        await leadgenBtn.click();
      } else {
        await page.fill('input[type="email"]', 'alex@telestar.vn');
        await page.fill('input[type="password"]', 'telestar2026');
        await page.click('button[type="submit"]');
      }
      await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 10000 });
    });

    test('Leadgen Specialist auto-routes to /leadgen prospecting workbench', async ({ page }) => {
      // Step 1: Navigating to / auto-redirects to /leadgen
      await page.goto('/');
      await expect(page).toHaveURL(/.*leadgen/);

      // Step 2: Gated from manager ecosystem
      await page.goto('/leadgen-manager');
      await expect(page).not.toHaveURL(/.*leadgen-manager/);
    });
  });

  // ─── 6. LEADGEN MANAGER JOURNEY ───────────────────────────────────────
  test.describe('6. Leadgen Manager Persona Journey', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/login');
      const lgMgrBtn = page.locator('button', { hasText: 'dominic@telestar.vn' });
      if (await lgMgrBtn.isVisible()) {
        await lgMgrBtn.click();
      } else {
        await page.fill('input[type="email"]', 'dominic@telestar.vn');
        await page.fill('input[type="password"]', 'telestar2026');
        await page.click('button[type="submit"]');
      }
      await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 10000 });
    });

    test('Leadgen Manager has access to 7-tab database ecosystem', async ({ page }) => {
      await page.goto('/leadgen-manager');
      await expect(page).toHaveURL(/.*leadgen-manager/);

      // Mirrors the TABS array in app/leadgen-manager/page.tsx. Importing is a
      // header action ("Import to Internal DB") that opens a modal, not a tab —
      // this test previously looked for an "Import Center" tab that no longer exists.
      for (const label of [
        'Overview',
        'Internal Database',
        'Qualification Queue',
        'Campaign Routing',
        'Export Center',
        'Team Performance',
        'Source Performance',
      ]) {
        await expect(page.locator('button', { hasText: label }).first()).toBeVisible();
      }

      await expect(page.locator('button', { hasText: 'Import to Internal DB' })).toBeVisible();
    });
  });
});
