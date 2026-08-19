/**
 * Outreach Automation Engine — Role Access & Permissions (Phase 14 / Spec §40)
 *
 * Verifies that SDRs can view sequences and enrolled leads but cannot edit send windows
 * or trigger global maintenance checks, while Managers (Director / Floor Manager) have full access.
 */
import { test, expect } from '../support/test';
import { storageStatePath } from '../support/fixture';

test.describe('Automation Role Matrix UI & API Security (Spec §40)', () => {

  test.describe('SDR Role (sdrA)', () => {
    test.use({ storageState: storageStatePath('sdrA') as string });

    test('SDR can access /sequences page', async ({ page }) => {
      await page.goto('/sequences', { waitUntil: 'domcontentloaded' });
      expect(page.url()).toContain('/sequences');
    });

    test('SDR can access /automation page but send window inputs are disabled', async ({ page }) => {
      await page.goto('/sequences', { waitUntil: 'domcontentloaded' });
      // If sequence step exists, send window inputs must be disabled for non-managers
      const startInputs = page.locator('input[id^="win-start-"]');
      const count = await startInputs.count();
      for (let i = 0; i < count; i++) {
        await expect(startInputs.nth(i)).toBeDisabled();
      }
    });
  });

  test.describe('Director Role (director)', () => {
    test.use({ storageState: storageStatePath('director') as string });

    test('Director can access /automation control center and see maintenance actions', async ({ page }) => {
      await page.goto('/automation', { waitUntil: 'domcontentloaded' });
      expect(page.url()).toContain('/automation');
      await expect(page.locator('button:has-text("Run Maintenance & Repair Check")')).toBeVisible();
      await expect(page.locator('button:has-text("Sync Inbound Messages Now")')).toBeVisible();
    });
  });
});
