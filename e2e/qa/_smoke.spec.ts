/**
 * Harness smoke test. Run this BEFORE spawning lane agents.
 *
 * Proves: dev server is up, login works for all 6 roles, the session resolves to
 * the role we expect, and the recorder actually writes evidence to disk.
 */
import { test, expect } from '@playwright/test';
import { attachRecorders, gotoTimed, login, logout, sessionRole, shot } from './_helpers';
import { PERSONAS, PERSONA_ROLE, type PersonaKey } from './personas';

const LANE = '_smoke';

const CHECKS: PersonaKey[] = [
  'director',
  'floorManager',
  'teamLead',
  'sdrLaneD',
  'leadgenManager',
  'leadgen',
];

test.describe('QA harness smoke', () => {
  test('login page renders for an anonymous visitor', async ({ page }) => {
    const rec = attachRecorders(page, LANE);
    await gotoTimed(page, '/', rec);

    await expect(page).toHaveURL(/login/);
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await shot(page, LANE, 'login-page');
    rec.flush('anonymous-redirect');
  });

  for (const key of CHECKS) {
    const email = PERSONAS[key];
    const expectedRole = PERSONA_ROLE[key];

    test(`${key} (${expectedRole}) can log in and session resolves correctly`, async ({ page }) => {
      const rec = attachRecorders(page, LANE);

      await login(page, email);
      const role = await sessionRole(page);
      expect(role, `${email} should authenticate as ${expectedRole}`).toBe(expectedRole);

      // Landing page differs by role: leadgen roles are bounced off / by
      // app/page.tsx:81-85, everyone else stays on the dashboard.
      const nav = await gotoTimed(page, '/', rec);
      await shot(page, LANE, `landing-${key}`);

      await logout(page);
      rec.flush(`login-${key}`);

      expect(nav.finalUrl).not.toContain('/login');
    });
  }
});
