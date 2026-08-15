/**
 * §16 — the browser half of the no-silent-removal rule.
 *
 * `campaign-member-impact.spec.ts` proves the API refuses a mode-less removal with 409 through
 * both doors, and `tests/admin-impact.test.ts` proves the service computes the counts. Neither
 * can prove the half that actually protects a director at 6pm: that the dialog *appears*, that
 * it *shows* what is about to be stranded, that Confirm stays inert until a handling mode is
 * named, and that Cancel is a true no-op rather than an optimistic removal the UI has already
 * applied. A 409 nobody is shown is a silent removal with extra steps.
 *
 * This coverage existed as `e2e/qa/laneG.spec.ts` and had never run once: `e2e/qa/**` matches no
 * project in `playwright.config.ts`, so eight files that look like specs were dead surface. An
 * independent audit caught it. The assertions are promoted here; the QA lane's artefact recorder
 * (screenshots, run notes, `qa-runs/`) is deliberately left behind — writing into the project
 * directory is what forced that lane to demand a production build, because every write triggered
 * Fast Refresh and remounted the page mid-assertion.
 *
 * **Serial and self-seeding.** It mutates campaign membership and lead ownership, so it creates
 * its own user, its own leads, and tears them down. `mode: 'serial'` keeps the four steps in
 * order against one fixture rather than racing each other for the same member row.
 */
import { test, expect } from '../support/test';
import { apiAs, readJson } from '../support/api';
import { fixture, storageStatePath } from '../support/fixture';
import { uniqueSuffix, disposablePassword } from '../support/ids';
import type { APIRequestContext, Page } from '@playwright/test';

test.use({ storageState: storageStatePath('director') as string });
test.describe.configure({ mode: 'serial' });

type Seed = {
  memberId: string;
  memberName: string;
  targetId: string;
  leadIds: string[];
};

let seed: Seed | null = null;

/** A campaign member holding open leads — without owned work the dialog would show zero. */
async function seedMemberWithWork(admin: APIRequestContext): Promise<Seed> {
  const s = `${Date.now()}${uniqueSuffix()}`;
  const lastName = `Removal${s}`;

  const created = await readJson(
    await admin.post('/api/users', {
      data: {
        email: `pw.removal.${s}@audit.test`,
        password: disposablePassword(),
        firstName: 'PW',
        lastName,
        role: 'sdr',
        managerId: fixture().users.teamLead.id,
      },
    })
  );
  expect(created.status, `member create failed: ${JSON.stringify(created.body)}`).toBeLessThan(300);
  const memberId = (created.body as { id: string }).id;

  // The transfer target has to already be a campaign member, or the dialog offers to add them
  // and the assertion becomes about a different flow.
  const targetId = fixture().users.sdrA.id;

  const added = await readJson(
    await admin.post(`/api/campaigns/${fixture().campaignA}/members`, {
      data: { userIds: [memberId, targetId] },
    })
  );
  expect(added.status, `add to campaign failed: ${JSON.stringify(added.body)}`).toBeLessThan(300);

  const leadIds: string[] = [];
  for (let i = 0; i < 3; i++) {
    const lead = await readJson(
      await admin.post('/api/leads', {
        data: {
          firstName: 'PW',
          lastName: `RemovalLead${s}${i}`,
          company: `PW_AUDIT_CO_REMOVAL_${s}`,
          email: `pw.removal.lead.${s}.${i}@audit.test`,
          campaignId: fixture().campaignA,
          assignedToId: memberId,
          stage: 'new',
        },
      })
    );
    expect(lead.status, `lead create failed: ${JSON.stringify(lead.body)}`).toBeLessThan(300);
    leadIds.push((lead.body as { id: string }).id);
  }

  return { memberId, memberName: lastName, targetId, leadIds };
}

async function impactFor(page: Page, userId: string) {
  const res = await page.request.get(
    `/api/campaigns/${fixture().campaignA}/member-impact/${userId}`
  );
  expect(res.ok(), `impact fetch failed: ${await res.text()}`).toBeTruthy();
  return (await res.json()) as { openLeads: number; openTasks: number; totalOpen: number };
}

test.describe('§16 the removal dialog discloses what a removal would strand', () => {
  test.beforeAll(async ({ baseURL }) => {
    seed = await seedMemberWithWork(await apiAs('director', baseURL!));
  });

  test.afterAll(async ({ baseURL }) => {
    if (!seed) return;
    const admin = await apiAs('director', baseURL!);
    for (const id of seed.leadIds) {
      await admin.delete(`/api/leads/${id}`).catch(() => {});
    }
  });

  test('shows non-zero owned work, keeps Confirm inert, and Cancel changes nothing', async ({
    page,
  }) => {
    const s = seed!;
    await page.goto(`/admin/campaigns/${fixture().campaignA}/members`, {
      waitUntil: 'domcontentloaded',
    });

    const memberRow = page.getByRole('row').filter({ hasText: s.memberName });
    await expect(memberRow, 'seeded member should be listed').toBeVisible();

    await memberRow.getByRole('button', { name: /remove/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // The disclosure itself. CLAUDE.md records that this dialog was extended to list stale
    // attributions precisely so an operator is not surprised by what a transfer leaves behind.
    await expect(dialog).toContainText(/still owns live work/i);
    await expect(dialog).toContainText(/open lead/i);

    // Inert until a handling mode is named — the UI expression of the 409.
    const confirm = dialog.getByRole('button', { name: /remove from campaign/i });
    await expect(confirm, 'confirm must be disabled before a mode is picked').toBeDisabled();

    await dialog.getByRole('button', { name: /^cancel$/i }).click();
    await expect(dialog).toBeHidden();

    // A reload, not just a re-query: an optimistic removal that only updated local state would
    // survive an in-page assertion and disappear here.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(
      page.getByRole('row').filter({ hasText: s.memberName }),
      'member must survive a cancelled removal'
    ).toBeVisible();

    // And the work is still theirs — Cancel must not have half-applied a transfer.
    const impact = await impactFor(page, s.memberId);
    expect(impact.openLeads, 'cancelled removal must not move work').toBeGreaterThan(0);
  });

  test('naming a transfer target moves the work and only then removes the member', async ({
    page,
  }) => {
    const s = seed!;
    await page.goto(`/admin/campaigns/${fixture().campaignA}/members`, {
      waitUntil: 'domcontentloaded',
    });

    const before = await impactFor(page, s.memberId);
    expect(before.openLeads, 'fixture must still have open leads').toBeGreaterThan(0);
    const targetBefore = await impactFor(page, s.targetId);

    const memberRow = page.getByRole('row').filter({ hasText: s.memberName });
    await memberRow.getByRole('button', { name: /remove/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: /transfer to another user/i }).check();
    // Selected by value: the option label carries a role suffix and sometimes a "will be added
    // to the campaign" note, so matching on visible text is brittle.
    await dialog.getByRole('combobox').selectOption(s.targetId);
    await dialog.getByRole('textbox').fill('E2E — transfer proof');

    const confirm = dialog.getByRole('button', { name: /remove from campaign/i });
    await expect(confirm, 'confirm should enable once a mode and target are chosen').toBeEnabled();
    await confirm.click();

    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(
      page.getByRole('row').filter({ hasText: s.memberName }),
      'member should be gone after a completed transfer'
    ).toBeHidden({ timeout: 30_000 });

    // The counts must land on the named target rather than simply vanishing — "removed and the
    // work disappeared" is the exact outcome this rule exists to prevent.
    const targetAfter = await impactFor(page, s.targetId);
    expect(
      targetAfter.openLeads,
      'the target must now own the transferred leads'
    ).toBeGreaterThanOrEqual(targetBefore.openLeads + before.openLeads);
  });
});
