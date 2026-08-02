import { test, expect } from '@playwright/test';

test.describe('Role-Based CRM Navigation & Journey Smoke Tests', () => {
  test('unauthenticated visitor gets redirected to login', async ({ page }) => {
    await page.goto('/');
    // Without active session, should redirect to /login
    await expect(page).toHaveURL(/.*login/);
    await expect(page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]')).toBeVisible();
  });

  test('login page has required branding and inputs', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('text=SalesFlow, text=Sign in, text=Login, text=Password').first()).toBeVisible();
  });
});
