import { test, expect } from '@playwright/test';

test.describe('Role-Based E2E Persona Journeys & Navigation', () => {
  test('Unauthenticated user is redirected to login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/.*login/);
    await expect(page.locator('text=Telestar CRM')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test.describe('1. Director Role Experience', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/login');
      // Click Demo Account or login with credentials
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
      // 1. Director Cockpit
      await page.goto('/director');
      await expect(page.locator('h1', { hasText: 'Director Cockpit' })).toBeVisible();

      // 2. Team View
      await page.goto('/team');
      await expect(page).toHaveURL(/.*team/);

      // 3. Opportunities & Revenue Forecasting
      await page.goto('/opportunities');
      await expect(page).toHaveURL(/.*opportunities/);

      // 4. Client Performance Reports
      await page.goto('/client-reports');
      await expect(page).toHaveURL(/.*client-reports/);

      // 5. Deliverability & Email Health
      await page.goto('/email-health');
      await expect(page).toHaveURL(/.*email-health/);

      // 6. Leadgen Manager Hub
      await page.goto('/leadgen-manager');
      await expect(page).toHaveURL(/.*leadgen-manager/);
    });
  });

  test.describe('2. SDR Role Experience', () => {
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

    test('SDR is restricted from executive screens and sees focused workbench', async ({ page }) => {
      // 1. Task Dashboard
      await page.goto('/');
      await expect(page).toHaveURL('/');

      // 2. Leads pipeline
      await page.goto('/leads');
      await expect(page).toHaveURL(/.*leads/);

      // 3. Attempting to access Director cockpit redirects away
      await page.goto('/director');
      await expect(page).not.toHaveURL(/.*director/);

      // 4. Attempting to access Team Floor manager view redirects away
      await page.goto('/team');
      await expect(page).not.toHaveURL(/.*team/);

      // 5. Meetings view for personal booked calls
      await page.goto('/meetings');
      await expect(page).toHaveURL(/.*meetings/);
    });
  });

  test.describe('3. Leadgen Specialist Role Experience', () => {
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

    test('Leadgen is auto-redirected to dedicated /leadgen prospecting workbench', async ({ page }) => {
      // Navigating to / should auto-route to /leadgen
      await page.goto('/');
      await expect(page).toHaveURL(/.*leadgen/);

      // Leadgen manager management console redirects away
      await page.goto('/leadgen-manager');
      await expect(page).not.toHaveURL(/.*leadgen-manager/);
    });
  });

  test.describe('4. Leadgen Manager Role Experience', () => {
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

    test('Leadgen Manager has access to the full 7-tab database ecosystem', async ({ page }) => {
      await page.goto('/leadgen-manager');
      await expect(page).toHaveURL(/.*leadgen-manager/);
      await expect(page.locator('button', { hasText: 'Internal Database' })).toBeVisible();
      await expect(page.locator('button', { hasText: 'Import Center' })).toBeVisible();
      await expect(page.locator('button', { hasText: 'Qualification Queue' })).toBeVisible();
      await expect(page.locator('button', { hasText: 'Campaign Routing' })).toBeVisible();
      await expect(page.locator('button', { hasText: 'Export Center' })).toBeVisible();
      await expect(page.locator('button', { hasText: 'Team Performance' })).toBeVisible();
      await expect(page.locator('button', { hasText: 'Source Performance' })).toBeVisible();
    });
  });
});
