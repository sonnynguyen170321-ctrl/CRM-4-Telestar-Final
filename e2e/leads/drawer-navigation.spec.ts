/**
 * Previous / next inside the lead drawer (owner request: step through the list without closing
 * the drawer).
 *
 * Two things only a browser can show. The drawer moves to the next lead in the order the table
 * shows them. And a draft started on one lead does not travel to the next — the drawer holds a
 * half-typed note, and a note saved after stepping would land on the wrong prospect.
 */
import { test, expect } from '../support/test';
import { apiAs, readJson } from '../support/api';
import { fixture, storageStatePath } from '../support/fixture';
import { uniqueSuffix } from '../support/ids';

test.use({ storageState: storageStatePath('director') as string });

test('the lead drawer steps through the table and drops drafts on the way', async ({ page, baseURL }) => {
  const admin = await apiAs('director', baseURL!);
  const stamp = `${Date.now()}${uniqueSuffix()}`;
  const company = `PW_AUDIT_CO_NAV_${stamp}`;
  const leadIds: string[] = [];
  for (const suffix of ['A', 'B']) {
    const { status, body } = await readJson(
      await admin.post('/api/leads', {
        data: {
          firstName: 'PW',
          lastName: `Nav${suffix}${stamp}`,
          company,
          email: `pw.nav${suffix.toLowerCase()}.${stamp}@audit.test`,
          campaignId: fixture().campaignA,
        },
      })
    );
    expect(status, `lead create failed: ${JSON.stringify(body).slice(0, 200)}`).toBeLessThan(300);
    leadIds.push((body as { id: string }).id);
  }

  try {
    await page.goto('/leads');
    await page.getByPlaceholder('Search full name, email, company, phone...').fill(company);
    const rows = page.locator('tbody tr').filter({ hasText: company });
    await expect(rows).toHaveCount(2);

    // Whatever order the table chose is the order the drawer must follow.
    const first = (await rows.nth(0).textContent())?.includes(`NavA${stamp}`) ? `NavA${stamp}` : `NavB${stamp}`;
    const second = first === `NavA${stamp}` ? `NavB${stamp}` : `NavA${stamp}`;
    const drawerHeading = (name: string) => page.getByRole('heading', { level: 2, name: new RegExp(name) });
    const position = page.getByRole('group', { name: 'Move between leads' });

    await rows.nth(0).click();
    await expect(drawerHeading(first)).toBeVisible();
    await expect(position).toContainText('1 / 2');

    // Start a note on the first lead, then step away without saving it.
    await page.getByRole('button', { name: 'Timeline Feed' }).click();
    const note = page.getByPlaceholder('Add a new note to this timeline...');
    await note.fill('draft meant for the first lead');
    await page.getByRole('button', { name: 'Next lead' }).click();

    await expect(drawerHeading(second)).toBeVisible();
    await expect(position).toContainText('2 / 2');
    await expect(page.getByRole('button', { name: 'Next lead' })).toBeDisabled();
    await page.getByRole('button', { name: 'Timeline Feed' }).click();
    await expect(page.getByPlaceholder('Add a new note to this timeline...')).toHaveValue('');

    // `k` steps back when focus is not in a field.
    await drawerHeading(second).click();
    await page.keyboard.press('k');
    await expect(drawerHeading(first)).toBeVisible();
  } finally {
    for (const id of leadIds) await admin.delete(`/api/leads/${id}`);
    await admin.dispose();
  }
});
