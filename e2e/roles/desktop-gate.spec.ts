/**
 * §42 — the desktop-only gate.
 *
 * `.claude/rules/frontend-ux.md` is explicit that the CRM is desktop-only (1280px+) and that
 * below 1024px a full-screen gate blocks the app rather than reflowing it. The failure this
 * guards against is not "it looks bad on a phone" — it is the app *half*-rendering below the
 * threshold, with the sidebar, a modal or the command palette painting on top of the gate.
 *
 * All three viewports live in one spec rather than three Playwright projects: running the
 * entire suite three times over would triple the run for no additional signal.
 */
import { test, expect } from '../support/test';
import { storageStatePath } from '../support/fixture';

test.use({ storageState: storageStatePath('director') as string });

/**
 * The gate's own copy, from `components/DesktopOnlyGate.tsx:33`. Matching the real string
 * matters: a loose guess (`/use a desktop/`) matched nothing and reported the gate missing
 * when it was rendering correctly.
 */
const GATE_COPY = /built for desktop/i;

const SUPPORTED = [
  { label: '1440x900 (primary)', width: 1440, height: 900 },
  { label: '1024x768 (lower bound)', width: 1024, height: 768 },
];

for (const vp of SUPPORTED) {
  test(`the CRM renders normally at ${vp.label}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/leads', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(
      page.getByText(GATE_COPY),
      `the desktop gate appeared at a supported width (${vp.label})`
    ).toHaveCount(0);

    // The page must not scroll sideways at a supported width.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, `horizontal overflow of ${overflow}px at ${vp.label}`).toBeLessThanOrEqual(1);
  });
}

test('below the supported width the gate replaces the app rather than layering over it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto('/leads', { waitUntil: 'domcontentloaded' });

  await expect(page.getByText(GATE_COPY).first()).toBeVisible();

  // The specific regression §42 names: chrome bleeding through the gate. Navigation links are
  // the cheapest proxy — if the sidebar is still rendered, the gate is an overlay, not a gate.
  await expect(
    page.getByRole('link', { name: /^Leads$/ }),
    'sidebar navigation is still rendered underneath the desktop gate'
  ).toHaveCount(0);
});
