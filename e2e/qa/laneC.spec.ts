/**
 * Lane C — Leadgen Manager console + CSV import wizard + Leadgen member workspace.
 *
 * Throwaway QA scaffolding. Report-only: this lane never edits app code.
 *
 * Owned data: LeadPoolItem, ImportBatch/ImportRow, and Leads created by the
 * routing/convert step. Personas: dominic@telestar.vn, alex@telestar.vn.
 *
 * Playwright restarts the worker process after a failing test, which wipes
 * module state — so every observation is flushed to disk immediately instead of
 * being collected in an afterAll hook.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { attachRecorders, gotoTimed, laneDir, login, logout, note, shot, type Recorder } from './_helpers';
import { PERSONAS, LEADGEN_MANAGER_TABS } from './personas';

const LANE = 'C';
const FIXTURE = path.join(laneDir(LANE), 'fixture.csv');
const ARTIFACTS = laneDir(LANE, 'artifacts');
const OBS_FILE = path.join(ARTIFACTS, 'observations.json');

/** Every record this lane imports carries sourceName = the uploaded filename. */
const FIXTURE_TAG = 'fixture.csv';
const SEED_DUP_EMAIL = 'marcus.webb@northgate-logistics.com';
const LEADGEN_CAMPAIGN = 'Leadgen Qualification Pool';

type ImportCall = { at: string; status: number; dryRun: boolean; body: string };

let rec: Recorder;
let importCalls: ImportCall[];

function saveArtifact(name: string, contents: string): string {
  const file = path.join(ARTIFACTS, name);
  fs.writeFileSync(file, contents, 'utf8');
  return path.relative(process.cwd(), file);
}

/** Merge-and-flush so a worker restart never loses earlier tests' evidence. */
function saveObs(key: string, value: unknown): void {
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(fs.readFileSync(OBS_FILE, 'utf8')) as Record<string, unknown>;
  } catch {
    current = {};
  }
  current[key] = value;
  fs.writeFileSync(OBS_FILE, JSON.stringify(current, null, 2), 'utf8');
}

test.beforeEach(async ({ page }) => {
  rec = attachRecorders(page, LANE);
  importCalls = [];

  page.on('response', async (res) => {
    if (!res.url().includes('/api/leads/import')) return;
    if (res.request().method() !== 'POST') return;
    const post = res.request().postData() ?? '';
    let body = '';
    try {
      body = await res.text();
    } catch {
      body = '<unreadable>';
    }
    importCalls.push({
      at: new Date().toISOString(),
      status: res.status(),
      dryRun: post.includes('"dryRun":true'),
      body: body.slice(0, 20000),
    });
  });
});

/** Reads the pool through the API with the page's session cookies. */
async function poolQuery(page: Page, qs: string) {
  const res = await page.request.get(`/api/leadgen-pool?${qs}`);
  const ok = res.ok();
  const json = ok ? await res.json() : null;
  return { status: res.status(), ok, total: json?.total ?? -1, items: json?.items ?? [] };
}

const searchBox = (page: Page) => page.getByPlaceholder(/Search name, email, company/);
const countLine = (page: Page) => page.locator('text=/\\d+ records · page/').first();

/** The pool table is client-fetched behind a session gate; wait for it to settle. */
async function waitForPoolReady(page: Page): Promise<void> {
  await expect(searchBox(page)).toBeVisible({ timeout: 30000 });
  await expect(countLine(page)).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(1200);
}

/**
 * Typing into the search box races the console's mount/hydrate cycle — the
 * controlled input gets reset to '' if the subtree remounts. Re-fill until it sticks.
 */
async function fillPoolSearch(page: Page, term: string): Promise<void> {
  const box = searchBox(page);
  for (let attempt = 0; attempt < 5; attempt++) {
    await box.fill(term);
    await page.waitForTimeout(1400);
    if ((await box.inputValue()) === term) break;
  }
  await page.waitForTimeout(1600);
}

/** Polls until the table has rows (or the empty state), instead of a blind sleep. */
async function waitForPoolRows(page: Page, timeoutMs = 25000): Promise<number> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const rows = await page.locator('tbody input[type="checkbox"]').count();
    if (rows > 0) return rows;
    const empty = await page
      .getByText('No records match the current filters.')
      .isVisible()
      .catch(() => false);
    if (empty) return 0;
    await page.waitForTimeout(500);
  }
  return page.locator('tbody input[type="checkbox"]').count();
}

const statusSelect = (page: Page) =>
  page.locator('select').filter({ has: page.locator('option[value="qa_pending"]') }).first();
const qualSelect = (page: Page) =>
  page.locator('select').filter({ has: page.locator('option[value="needs_research"]') }).first();

/** Re-applies search + filters; the console resets them whenever it remounts. */
async function preparePoolView(
  page: Page,
  opts: { term?: string; status?: string; qualification?: string }
): Promise<number> {
  if (opts.term !== undefined && (await searchBox(page).inputValue()) !== opts.term) {
    await fillPoolSearch(page, opts.term);
  }
  if (opts.status !== undefined && (await statusSelect(page).inputValue()) !== opts.status) {
    await statusSelect(page).selectOption(opts.status);
    await page.waitForTimeout(1500);
  }
  if (opts.qualification !== undefined && (await qualSelect(page).inputValue()) !== opts.qualification) {
    await qualSelect(page).selectOption(opts.qualification);
    await page.waitForTimeout(1500);
  }
  return waitForPoolRows(page);
}

/**
 * Selecting rows is unreliable: the console unmounts on session revalidation
 * (app/leadgen-manager/page.tsx:65 returns null while `isSessionLoading`), which
 * resets search, filters and selection. Retry until the bulk bar actually shows.
 */
async function selectPoolRows(
  page: Page,
  want: number,
  view: { term?: string; status?: string; qualification?: string }
): Promise<{ rows: number; selected: number; attempts: number }> {
  let rows = 0;
  for (let attempt = 1; attempt <= 4; attempt++) {
    rows = await preparePoolView(page, view);
    if (rows === 0) return { rows: 0, selected: 0, attempts: attempt };
    const take = Math.min(want, rows);
    const boxes = page.locator('tbody input[type="checkbox"]');
    for (let i = 0; i < take; i++) {
      await boxes.nth(i).check({ timeout: 5000 }).catch(() => {});
    }
    await page.waitForTimeout(1000);
    const bar = page.locator('text=/\\d+ selected/').first();
    if (await bar.isVisible().catch(() => false)) {
      const label = await bar.innerText();
      return { rows, selected: Number(label.match(/(\d+) selected/)?.[1] ?? 0), attempts: attempt };
    }
  }
  return { rows, selected: 0, attempts: 4 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3 — Leadgen Manager
// ─────────────────────────────────────────────────────────────────────────────

test('C1 leadgen-manager: all 7 tabs plus the dead ?tab=import sidebar link', async ({ page }) => {
  test.setTimeout(150_000);
  await login(page, PERSONAS.leadgenManager);

  const tabReport: Record<string, unknown>[] = [];

  for (const tab of LEADGEN_MANAGER_TABS) {
    const url = tab === 'overview' ? '/leadgen-manager' : `/leadgen-manager?tab=${tab}`;
    const before = rec.consoleErrors.length + rec.pageErrors.length;
    const nav = await gotoTimed(page, url, rec);
    await page.waitForTimeout(2000); // let the tab's fetches settle
    await shot(page, LANE, `c1-tab-${tab}`);

    const body = (await page.locator('body').first().innerText()).replace(/\s+/g, ' ').trim();
    tabReport.push({
      tab,
      finalUrl: nav.finalUrl,
      newConsoleIssues: rec.consoleErrors.length + rec.pageErrors.length - before,
      bodyExcerpt: body.slice(0, 900),
      bodyLength: body.length,
      hasEmptyStateCopy: /No records|No requirements|no data|nothing/i.test(body),
    });
  }

  // The known dead sidebar link: ?tab=import is not a tab id, so it silently
  // falls back to the Overview tab instead of opening the import wizard.
  await gotoTimed(page, '/leadgen-manager?tab=import', rec);
  await page.waitForTimeout(1500);
  await shot(page, LANE, 'c1-tab-import-dead-link');
  const importModalOpen = await page.getByText('Bulk Upload Leads').isVisible().catch(() => false);
  const overviewActive = await page
    .locator('button')
    .filter({ hasText: /^Overview$/ })
    .first()
    .getAttribute('class');

  // Same thing via the actual sidebar nav item a manager would click.
  const sidebarImport = page.getByRole('link', { name: /Import Center/i }).first();
  const sidebarImportExists = await sidebarImport.isVisible().catch(() => false);
  let urlAfterSidebarClick = '';
  let modalAfterSidebarClick = false;
  if (sidebarImportExists) {
    await sidebarImport.click();
    await page.waitForTimeout(2000);
    await shot(page, LANE, 'c1-sidebar-import-center-click');
    urlAfterSidebarClick = page.url();
    modalAfterSidebarClick = await page.getByText('Bulk Upload Leads').isVisible().catch(() => false);
  }

  saveObs('c1', {
    tabs: tabReport,
    deadImportTab: {
      urlAfterDirectNav: page.url(),
      importModalOpened: importModalOpen,
      overviewTabButtonClass: overviewActive,
      sidebarImportCenterLinkPresent: sidebarImportExists,
      urlAfterSidebarClick,
      modalAfterSidebarClick,
    },
  });

  note(LANE, `C1 tabs: ${JSON.stringify(tabReport.map((t) => ({ t: t.tab, len: t.bodyLength })))}`);
  rec.flush('c1-tab-navigation');

  expect(sidebarImportExists, 'sidebar exposes an "Import Center" entry').toBeTruthy();
  expect
    .soft(modalAfterSidebarClick, 'clicking sidebar "Import Center" must open the import wizard')
    .toBeTruthy();
  expect
    .soft(importModalOpen, '?tab=import should open the import wizard, not silently fall back')
    .toBeTruthy();
});

test('C2 import wizard: 5 steps, dry run, error download, duplicate resolution, confirm', async ({ page }) => {
  test.setTimeout(240_000);
  await login(page, PERSONAS.leadgenManager);
  await gotoTimed(page, '/leadgen-manager?tab=pool', rec);
  await waitForPoolReady(page);

  // ── Seed one colliding record so the dry run has real existing-data matches.
  const existingMarcus = await poolQuery(page, `search=${encodeURIComponent(SEED_DUP_EMAIL)}&pageSize=5`);
  if (existingMarcus.total === 0) {
    await page.getByRole('button', { name: /Add Record/i }).click();
    await page.getByPlaceholder('First name').fill('Marcus');
    await page.getByPlaceholder('Last name').fill('Webb');
    await page.getByPlaceholder('Email', { exact: true }).fill(SEED_DUP_EMAIL);
    await page.getByPlaceholder('Company', { exact: true }).fill('Northgate Logistics');
    await page.getByRole('button', { name: /^Add Record$/ }).last().click();
    await page.waitForTimeout(2000);
  }
  const seeded = await poolQuery(page, `search=${encodeURIComponent(SEED_DUP_EMAIL)}&pageSize=5`);
  const poolBefore = await poolQuery(page, `search=${encodeURIComponent(FIXTURE_TAG)}&pageSize=200`);

  // ── Step 1: upload ────────────────────────────────────────────────────────
  await page.getByRole('button', { name: /Import to Internal DB/i }).click();
  await expect(page.getByText('Bulk Upload Leads')).toBeVisible();
  await shot(page, LANE, 'c2-step1-upload');
  const stepLabel = async () => (await page.locator('text=/Step \\d of 5/').first().innerText()).trim();
  const step1Label = await stepLabel();
  const uploadCopy = (await page.locator('.glass-card').innerText()).replace(/\s+/g, ' ').trim();

  // The console remounts under the wizard and takes the modal with it (see the
  // c2-wizard-vanished screenshots). Retry from the top and count how often.
  let wizardVanished = 0;
  let uploadAttempts = 0;
  for (let attempt = 1; attempt <= 4; attempt++) {
    uploadAttempts = attempt;
    if (!(await page.getByText('Bulk Upload Leads').isVisible().catch(() => false))) {
      await page.getByRole('button', { name: /Import to Internal DB/i }).click();
      await expect(page.getByText('Bulk Upload Leads')).toBeVisible({ timeout: 20000 });
    }
    await page.locator('input[type="file"]').setInputFiles(FIXTURE);
    const parsed = await page
      .getByText(/rows detected/)
      .isVisible({ timeout: 20000 })
      .catch(() => false);
    await page.waitForTimeout(1500);
    const stillOpen = await page.getByText('Bulk Upload Leads').isVisible().catch(() => false);
    if (parsed && stillOpen) break;
    if (!stillOpen) {
      wizardVanished++;
      await shot(page, LANE, `c2-wizard-vanished-attempt-${attempt}`);
    }
  }
  await expect(page.getByText(/rows detected/)).toBeVisible({ timeout: 20000 });

  // ── Step 2: mapping ───────────────────────────────────────────────────────
  await page.waitForTimeout(600);
  await shot(page, LANE, 'c2-step2-mapping');
  const step2Label = await stepLabel();
  const rowsDetected = (await page.getByText(/rows detected/).innerText()).trim();

  const mapping: Record<string, string> = {};
  const mapRows = page.locator('div.grid.grid-cols-\\[130px_1fr\\]');
  const mapCount = await mapRows.count();
  for (let i = 0; i < mapCount; i++) {
    const row = mapRows.nth(i);
    const label = (await row.locator('label').innerText()).replace('*', '').trim();
    mapping[label] = await row.locator('select').inputValue();
  }
  const unmappedRequired = ['First Name', 'Last Name', 'Primary Email', 'Company'].filter((k) => !mapping[k]);
  const previewHeaders = await page.locator('table thead th').allInnerTexts();

  await page.getByRole('button', { name: 'Continue' }).click();

  // ── Step 3: context ───────────────────────────────────────────────────────
  await expect(page.getByText(/internal lead database/i).first()).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, LANE, 'c2-step3-context');
  const step3Label = await stepLabel();
  const contextText = (await page.locator('.glass-card').innerText()).replace(/\s+/g, ' ').trim();

  await page.getByRole('button', { name: /Run Duplicate Check/i }).click();

  // ── Step 4: review ────────────────────────────────────────────────────────
  await expect(page.getByText('Importable')).toBeVisible({ timeout: 40000 });
  await page.waitForTimeout(600);
  await shot(page, LANE, 'c2-step4-review');
  const step4Label = await stepLabel();

  const tiles: Record<string, string> = {};
  for (const label of ['Total', 'Importable', 'Duplicates', 'Errors', 'Risky', 'Bad Email']) {
    const tile = page.locator('div.rounded-xl').filter({ hasText: new RegExp(`^${label}`) }).first();
    tiles[label] = (await tile.innerText().catch(() => '?')).replace(/\s+/g, ' ').trim();
  }
  const reviewText = (await page.locator('.glass-card').innerText()).replace(/\s+/g, ' ').trim();
  const dryRunCall = importCalls.find((c) => c.dryRun);
  const dryRun = dryRunCall ? JSON.parse(dryRunCall.body) : null;
  saveArtifact('dry-run-summary.json', JSON.stringify(dryRun, null, 2));

  // ── Error-row CSV download ────────────────────────────────────────────────
  let errorCsv = '';
  let errorCsvPath = '';
  const dlButton = page.getByRole('button', { name: /Download error rows/i });
  const hasDownload = await dlButton.isVisible().catch(() => false);
  if (hasDownload) {
    const [download] = await Promise.all([page.waitForEvent('download'), dlButton.click()]);
    const target = path.join(ARTIFACTS, 'import-errors.csv');
    await download.saveAs(target);
    errorCsv = fs.readFileSync(target, 'utf8');
    errorCsvPath = path.relative(process.cwd(), target);
  }

  // ── Duplicate resolution: flip the existing-data match to "update" ────────
  const resolutionSelects = page.locator('select').filter({ has: page.locator('option[value="update"]') });
  const dupSelectCount = await resolutionSelects.count();
  const dupRowsText = await page.locator('div.max-h-56 > div').allInnerTexts().catch(() => [] as string[]);
  const bulkResolutionButtons = await page
    .getByRole('button', { name: /^All (skip|update|import)$/ })
    .allInnerTexts()
    .catch(() => [] as string[]);
  if (dupSelectCount > 0) await resolutionSelects.first().selectOption('update');
  await shot(page, LANE, 'c2-step4-review-resolution-update');

  await page.getByRole('button', { name: 'Review Import' }).click();

  // ── Step 5: confirm ───────────────────────────────────────────────────────
  await expect(page.getByText(/Ready to queue/i)).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, LANE, 'c2-step5-confirm');
  const step5Label = await stepLabel();
  const confirmText = (await page.locator('.glass-card').innerText()).replace(/\s+/g, ' ').trim();

  await page.getByRole('button', { name: 'Confirm Import' }).click();
  await page.waitForTimeout(4000);
  const toastText = await page.locator('body').innerText();
  await shot(page, LANE, 'c2-after-confirm');

  const realCall = importCalls.find((c) => !c.dryRun);
  saveArtifact('confirm-import-response.json', JSON.stringify(realCall ?? null, null, 2));

  // Did the rows actually land? Give a (possibly async) worker a fair window.
  let poolAfter = await poolQuery(page, `search=${encodeURIComponent(FIXTURE_TAG)}&pageSize=200`);
  for (let i = 0; i < 6 && poolAfter.total <= poolBefore.total; i++) {
    await page.waitForTimeout(2500);
    poolAfter = await poolQuery(page, `search=${encodeURIComponent(FIXTURE_TAG)}&pageSize=200`);
  }

  await gotoTimed(page, '/leadgen-manager?tab=pool', rec);
  await waitForPoolReady(page);
  await fillPoolSearch(page, FIXTURE_TAG);
  await waitForPoolRows(page);
  await shot(page, LANE, 'c2-pool-after-import');

  // Was the "update" resolution actually applied to the pre-seeded record?
  const marcusAfter = await poolQuery(page, `search=${encodeURIComponent(SEED_DUP_EMAIL)}&pageSize=5`);

  saveObs('c2', {
    preSeededDuplicateTotal: seeded.total,
    uploadAttemptsNeeded: uploadAttempts,
    wizardVanishedDuringUpload: wizardVanished,
    stepLabels: [step1Label, step2Label, step3Label, step4Label, step5Label],
    uploadStepCopy: uploadCopy.slice(0, 600),
    rowsDetected,
    autoMapping: mapping,
    unmappedRequiredFields: unmappedRequired,
    mappingPreviewHeaders: previewHeaders,
    contextStepText: contextText.slice(0, 1400),
    reviewTiles: tiles,
    reviewStepText: reviewText.slice(0, 2500),
    dryRun: dryRun && {
      total: dryRun.total,
      toImport: dryRun.toImport,
      rowsWithErrors: dryRun.rowsWithErrors,
      duplicateCount: dryRun.duplicates?.length,
      warnings: dryRun.warnings,
      errorRows: dryRun.errorRows,
      riskyEmails: dryRun.riskyEmails,
      undeliverableEmails: dryRun.undeliverableEmails,
      exactDuplicates: dryRun.exactDuplicates,
      possibleMatches: dryRun.possibleMatches,
    },
    warningsRenderedInUi: /Duplicate phone/i.test(reviewText),
    duplicateRowsShown: dupRowsText,
    bulkResolutionButtons,
    errorCsv: { downloaded: hasDownload, path: errorCsvPath, contents: errorCsv },
    confirmStepText: confirmText.slice(0, 1400),
    confirmResponse: realCall ? { status: realCall.status, body: realCall.body } : null,
    toastAfterConfirm: (toastText.match(/Import(ed| queued)[^\n]*/) ?? ['<none captured>'])[0],
    poolTotalBefore: poolBefore.total,
    poolTotalAfter: poolAfter.total,
    updatedRecordAfterResolution: (marcusAfter.items as Record<string, unknown>[])[0] ?? null,
    landedSample: (poolAfter.items as Record<string, unknown>[]).slice(0, 12).map((i) => ({
      name: [i.firstName, i.lastName].filter(Boolean).join(' '),
      company: i.company,
      email: i.email,
      sourceType: i.sourceType,
      sourceName: i.sourceName,
      qualification: i.qualification,
      status: i.status,
    })),
  });

  note(LANE, `C2 confirm status=${realCall?.status} poolBefore=${poolBefore.total} poolAfter=${poolAfter.total}`);
  rec.flush('c2-import-wizard');

  expect(realCall, 'Confirm Import must issue a POST /api/leads/import').toBeTruthy();
  expect(realCall!.status, `import must not error (${realCall!.body})`).toBeLessThan(400);

  // On a first run the rows land; on a repeat run every row is already in the
  // pool, so "nothing new" is correct as long as the dry run said so.
  const landedOrCorrectlyDeduped =
    poolAfter.total > poolBefore.total || (dryRun?.toImport === 0 && (dryRun?.duplicates?.length ?? 0) > 0);
  expect(
    landedOrCorrectlyDeduped,
    `rows must land or be explained as duplicates (before=${poolBefore.total}, after=${poolAfter.total}, toImport=${dryRun?.toImport}, dups=${dryRun?.duplicates?.length}, response=${realCall?.status} ${realCall?.body})`
  ).toBeTruthy();
});

test('C2b import wizard: what happens to a file bigger than the inline import cap', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, PERSONAS.leadgenManager);
  await gotoTimed(page, '/leadgen-manager', rec);
  await page.waitForTimeout(1500);

  // INLINE_IMPORT_MAX_ROWS is 2000 (lib/workflows/importInline.ts:15). A real BPO
  // vendor list is routinely larger, so probe one row past the cap.
  const OVERSIZE = 2001;
  const rows = Array.from({ length: OVERSIZE }, (_, i) => ({
    firstName: 'Probe',
    lastName: `Row${i}`,
    company: `QA Lane C Oversize ${i}`,
    email: `qa.lane.c.oversize.${i}@example-oversize.test`,
  }));

  const res = await page.request.post('/api/leads/import', {
    data: {
      leads: rows,
      targetType: 'pool',
      emailQualityMode: 'recommended',
      filename: 'qa-lane-c-oversize-probe.csv',
      defaultResolution: 'skip',
    },
    timeout: 120_000,
  });
  const status = res.status();
  const body = await res.text();

  // Did the rejected batch leave residue behind?
  const batches = await page.request.get('/api/admin/imports?limit=20').catch(() => null);
  const batchBody = batches && batches.ok() ? (await batches.text()).slice(0, 4000) : `<status ${batches?.status()}>`;

  const landed = await poolQuery(page, 'search=oversize-probe&pageSize=5');

  saveObs('c2b', {
    rowsSent: OVERSIZE,
    inlineCapFromSource: 2000,
    responseStatus: status,
    responseBody: body.slice(0, 2000),
    poolRecordsCreated: landed.total,
    adminImportsSnapshot: batchBody,
  });
  saveArtifact('oversize-import-response.json', JSON.stringify({ status, body }, null, 2));

  note(LANE, `C2b oversize import → ${status}`);
  rec.flush('c2b-oversize-import');

  expect
    .soft(status, 'a 2001-row list must not be rejected outright when no worker is running')
    .toBeLessThan(400);
});

test('C3 internal database: search by name, accented + unaccented Vietnamese, filters, empty state', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await login(page, PERSONAS.leadgenManager);
  await gotoTimed(page, '/leadgen-manager?tab=pool', rec);
  await waitForPoolReady(page);

  const results: Record<string, unknown>[] = [];
  const searches: [string, string][] = [
    ['first name', 'Marcus'],
    ['last name', 'Webb'],
    ['ascii full name', 'Marcus Webb'],
    ['vietnamese first name accented', 'Nguyễn'],
    // "Nguyen" also appears inside the record's email address, so it is not a
    // clean accent probe. "Giám" (title) appears nowhere else in the record.
    ['vietnamese first name unaccented', 'Nguyen'],
    ['accent probe accented (title)', 'Giám'],
    ['accent probe unaccented (title)', 'Giam'],
    ['vietnamese full name accented', 'Nguyễn Văn An'],
    ['vietnamese full name unaccented', 'Nguyen Van An'],
    ['vietnamese surname accented', 'Văn An'],
    ['company', 'Saigon Tech'],
    ['email', 'kenji.tanaka@meridiansolar.jp'],
    ['no match', 'zzqqxx-no-such-record'],
  ];

  for (const [label, term] of searches) {
    await fillPoolSearch(page, term);
    await waitForPoolRows(page, 12000);
    const line = (await countLine(page).innerText()).trim();
    const empty = await page.getByText('No records match the current filters.').isVisible().catch(() => false);
    const api = await poolQuery(page, `search=${encodeURIComponent(term)}&pageSize=5`);
    results.push({ label, term, uiCountLine: line, emptyStateShown: empty, apiTotal: api.total });
    if (label.startsWith('vietnamese') || label === 'no match') {
      await shot(page, LANE, `c3-search-${label.replace(/\s+/g, '-')}`);
    }
  }

  // Source filter: CSV-imported records should be reachable from a source option.
  await fillPoolSearch(page, FIXTURE_TAG);
  await waitForPoolRows(page, 12000);
  const allSourcesCount = (await countLine(page).innerText()).trim();
  const sourceSelect = page.locator('select').filter({ has: page.locator('option[value="csv_import"]') }).first();
  const sourceOptions = await sourceSelect.locator('option').allInnerTexts();
  await sourceSelect.selectOption('csv_import');
  await page.waitForTimeout(2500);
  const csvImportCount = (await countLine(page).innerText()).trim();
  await shot(page, LANE, 'c3-filter-source-csv-import');
  await sourceSelect.selectOption('');
  await page.waitForTimeout(2000);

  await qualSelect(page).selectOption('unreviewed');
  await page.waitForTimeout(2500);
  const unreviewedCount = (await countLine(page).innerText()).trim();
  await qualSelect(page).selectOption('');

  const apiVendor = await poolQuery(page, `search=${encodeURIComponent(FIXTURE_TAG)}&sourceType=vendor&pageSize=5`);
  const apiCsv = await poolQuery(page, `search=${encodeURIComponent(FIXTURE_TAG)}&sourceType=csv_import&pageSize=5`);

  saveObs('c3', {
    searches: results,
    sourceFilterOptions: sourceOptions,
    allSourcesCount,
    csvImportFilterCount: csvImportCount,
    unreviewedFilterCount: unreviewedCount,
    apiSourceTypeVendorTotal: apiVendor.total,
    apiSourceTypeCsvImportTotal: apiCsv.total,
  });

  note(LANE, `C3 search results: ${JSON.stringify(results)}`);
  rec.flush('c3-pool-search');

  const by = (l: string) => results.find((r) => r.label === l);
  expect(by('first name')?.apiTotal, 'first-name search should work').toBeGreaterThan(0);
  expect.soft(by('ascii full name')?.apiTotal, 'searching "Marcus Webb" should find Marcus Webb').toBeGreaterThan(0);
  expect.soft(by('vietnamese first name accented')?.apiTotal, 'accented "Nguyễn" should find the record').toBeGreaterThan(0);
  expect.soft(by('accent probe unaccented (title)')?.apiTotal, 'unaccented "Giam" should find "Giám đốc"').toBeGreaterThan(0);
  expect.soft(by('vietnamese full name accented')?.apiTotal, 'full accented name should find the record').toBeGreaterThan(0);
  expect.soft(apiCsv.total, 'CSV-imported records should be reachable via the CSV Import source filter').toBeGreaterThan(0);
});

test('C4b leadgen console loses search, filters and selection on session revalidation', async ({ page }) => {
  test.setTimeout(150_000);
  await login(page, PERSONAS.leadgenManager);
  await gotoTimed(page, '/leadgen-manager?tab=qualify', rec);
  await waitForPoolReady(page);

  const picked = await selectPoolRows(page, 1, { term: FIXTURE_TAG });
  await shot(page, LANE, 'c4b-selection-before-refocus');
  const beforeSearch = await searchBox(page).inputValue();
  const beforeBar = await page.locator('text=/\\d+ selected/').first().isVisible().catch(() => false);

  // NextAuth revalidates the session on window focus; AppContext maps that to
  // isSessionLoading=true and the console returns null, unmounting everything.
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(4000);
  await shot(page, LANE, 'c4b-after-refocus');

  const afterSearch = await searchBox(page).inputValue().catch(() => '<input gone>');
  const afterBar = await page.locator('text=/\\d+ selected/').first().isVisible().catch(() => false);
  const afterCount = await countLine(page).innerText().catch(() => '<none>');

  saveObs('c4b', {
    selectionAttemptsNeeded: picked.attempts,
    rowsFound: picked.rows,
    selectedBefore: picked.selected,
    searchBefore: beforeSearch,
    bulkBarBefore: beforeBar,
    searchAfterRefocus: afterSearch,
    bulkBarAfterRefocus: afterBar,
    countLineAfterRefocus: afterCount.trim(),
  });

  note(LANE, `C4b attempts=${picked.attempts} searchAfter="${afterSearch}" barAfter=${afterBar}`);
  rec.flush('c4b-state-wipe');

  expect.soft(picked.attempts, 'selecting a row should work on the first try').toBe(1);
  expect.soft(afterSearch, 'the search box must survive a window refocus').toBe(FIXTURE_TAG);
  expect.soft(afterBar, 'the row selection must survive a window refocus').toBeTruthy();
});

test('C4 qualification queue: qualify 5, disqualify 1 with a reason + QA notes', async ({ page }) => {
  test.setTimeout(200_000);
  await login(page, PERSONAS.leadgenManager);
  await gotoTimed(page, '/leadgen-manager?tab=qualify', rec);
  await waitForPoolReady(page);

  const unfilteredCount = (await countLine(page).innerText()).trim();
  const picked = await selectPoolRows(page, 5, { term: FIXTURE_TAG });
  const rowCount = picked.rows;
  await shot(page, LANE, 'c4-selected-for-qualify');
  const before = (await countLine(page).innerText()).trim();

  const qaNotesBox = page.getByPlaceholder(/verified title/i);
  const qaNotesPresent = await qaNotesBox.isVisible().catch(() => false);
  if (qaNotesPresent) await qaNotesBox.fill('QA lane C: verified title + company domain');

  let afterQualify = before;
  if (picked.selected > 0) {
    await page.getByRole('button', { name: /^Qualify$/ }).click();
    await page.waitForTimeout(5000);
    afterQualify = (await countLine(page).innerText()).trim();
  }
  await shot(page, LANE, 'c4-after-qualify');

  // Disqualify the remaining one, with a reason.
  const remaining = await selectPoolRows(page, 1, { term: FIXTURE_TAG });
  let disqualified = false;
  if (remaining.selected > 0) {
    await page.getByPlaceholder('Disqualification reason').fill('Out of ICP - sub-10 employee company');
    await page.getByRole('button', { name: /Disqualify/i }).click();
    await page.waitForTimeout(5000);
    disqualified = true;
  }
  const afterDisqualify = (await countLine(page).innerText()).trim();
  await shot(page, LANE, 'c4-after-disqualify');

  const qualifiedApi = await poolQuery(page, `search=${encodeURIComponent(FIXTURE_TAG)}&qualification=qualified&pageSize=50`);
  const disqualifiedApi = await poolQuery(page, `search=${encodeURIComponent(FIXTURE_TAG)}&qualification=disqualified&pageSize=50`);
  const allApi = await poolQuery(page, `search=${encodeURIComponent(FIXTURE_TAG)}&pageSize=200`);

  await gotoTimed(page, '/leadgen-manager', rec);
  await page.waitForTimeout(2500);
  const overviewText = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
  await shot(page, LANE, 'c4-overview-after-qualify');

  const firstQualified = (qualifiedApi.items as Record<string, unknown>[])[0] ?? null;
  const firstDisqualified = (disqualifiedApi.items as Record<string, unknown>[])[0] ?? null;

  saveObs('c4', {
    unfilteredQueueCount: unfilteredCount,
    queueCountBefore: before,
    rowsInQueue: rowCount,
    selectionAttemptsNeeded: picked.attempts,
    qaNotesFieldPresent: qaNotesPresent,
    qualifiedCount: picked.selected,
    queueCountAfterQualify: afterQualify,
    disqualifiedOne: disqualified,
    queueCountAfterDisqualify: afterDisqualify,
    apiQualifiedTotal: qualifiedApi.total,
    apiDisqualifiedTotal: disqualifiedApi.total,
    apiAllFixtureTotal: allApi.total,
    qualifiedRecordShape: firstQualified && {
      qualification: firstQualified.qualification,
      status: firstQualified.status,
      qualifiedBy: firstQualified.qualifiedBy,
      qaNotes: (firstQualified as { qaNotes?: string }).qaNotes ?? '<not returned by API>',
    },
    disqualifiedRecordShape: firstDisqualified && {
      qualification: firstDisqualified.qualification,
      status: firstDisqualified.status,
      qualifiedBy: firstDisqualified.qualifiedBy,
      disqualifiedReason: (firstDisqualified as { disqualifiedReason?: string }).disqualifiedReason ?? '<not returned by API>',
    },
    overviewExcerpt: overviewText.slice(0, 1500),
  });

  note(LANE, `C4 qualified=${qualifiedApi.total} disqualified=${disqualifiedApi.total}`);
  rec.flush('c4-qualification-queue');

  expect(rowCount, 'the qualification queue should show the freshly imported records').toBeGreaterThan(0);
  expect(qualifiedApi.total, 'qualified records should be persisted').toBeGreaterThanOrEqual(1);
  expect(disqualifiedApi.total, 'the disqualified record should be persisted').toBeGreaterThanOrEqual(1);
});

test('C5 campaign routing: assign then convert qualified records into working leads', async ({ page }) => {
  test.setTimeout(240_000);
  await login(page, PERSONAS.leadgenManager);
  await gotoTimed(page, '/leadgen-manager?tab=routing', rec);
  await waitForPoolReady(page);
  await shot(page, LANE, 'c5-routing-tab');

  const pickedForAssign = await selectPoolRows(page, 50, { term: FIXTURE_TAG });
  const rowCount = pickedForAssign.rows;
  const routableCount = (await countLine(page).innerText()).trim();
  await shot(page, LANE, 'c5-routing-filtered');

  // The assign/convert panel is the only place with a campaign <select> and
  // <label>-wrapped rep checkboxes, so target those directly.
  const dialogCampaignSelect = () =>
    page.locator('select').filter({ hasText: LEADGEN_CAMPAIGN }).last();
  const repRows = () => page.locator('label').filter({ has: page.locator('input[type="checkbox"]') });

  // ── Assign (tag with campaign + rep) ──────────────────────────────────────
  let assignWorked = false;
  let sdrPickerOptions: string[] = [];
  if (pickedForAssign.selected > 0) {
    await page.getByRole('button', { name: /Assign to Campaign \/ SDR/i }).click();
    await expect(page.getByRole('heading', { name: 'Assign' })).toBeVisible();
    await shot(page, LANE, 'c5-assign-dialog');
    await dialogCampaignSelect().selectOption({ label: LEADGEN_CAMPAIGN });
    sdrPickerOptions = (await repRows().allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim());
    // Whoever the picker actually offers — see the roster recorded above.
    const firstRep = repRows().first();
    if (await firstRep.isVisible().catch(() => false)) await firstRep.locator('input').check();
    await page.getByRole('button', { name: 'Apply Assignment' }).click();
    await page.waitForTimeout(5000);
    assignWorked = true;
  }
  await shot(page, LANE, 'c5-after-assign');

  const afterAssign = await poolQuery(page, `search=${encodeURIComponent(FIXTURE_TAG)}&pageSize=200`);

  // Assign flips status to assigned_to_campaign, which drops rows out of the
  // routing view's default status filter — widen it before converting.
  const pickedForConvert = await selectPoolRows(page, 50, {
    term: FIXTURE_TAG,
    status: '',
    qualification: 'qualified',
  });
  const convertCount = pickedForConvert.rows;
  await shot(page, LANE, 'c5-selected-for-convert');

  let convertRepsChosen: string[] = [];
  if (pickedForConvert.selected > 0) {
    await page.getByRole('button', { name: /Convert to Leads/i }).click();
    await expect(page.getByRole('heading', { name: 'Convert to Leads' })).toBeVisible();
    await dialogCampaignSelect().selectOption({ label: LEADGEN_CAMPAIGN });

    const repCount = await repRows().count();
    for (let i = 0; i < Math.min(2, repCount); i++) {
      await repRows().nth(i).locator('input').check();
      convertRepsChosen.push((await repRows().nth(i).innerText()).replace(/\s+/g, ' ').trim());
    }
    const rr = page.locator('input[type="radio"][name="method"]').nth(1);
    if (await rr.isVisible().catch(() => false)) await rr.check();
    await shot(page, LANE, 'c5-convert-dialog');
    await page.getByRole('button', { name: 'Convert & Assign' }).click();
    await page.waitForTimeout(8000);
  }
  await shot(page, LANE, 'c5-after-convert');

  const afterConvert = await poolQuery(page, `search=${encodeURIComponent(FIXTURE_TAG)}&pageSize=200`);
  const converted = (afterConvert.items as Record<string, unknown>[]).filter((i) => i.convertedLeadId);

  const leadsRes = await page.request.get('/api/leads?pageSize=500');
  const leadsJson = leadsRes.ok() ? await leadsRes.json() : null;
  const leadArray: Record<string, unknown>[] = Array.isArray(leadsJson) ? leadsJson : (leadsJson?.leads ?? []);
  const convertedIds = new Set(converted.map((c) => c.convertedLeadId));
  const myLeads = leadArray.filter((l) => convertedIds.has(l.id));
  const emails = myLeads.map((l) => String(l.email ?? '').toLowerCase());
  const dupEmails = emails.filter((e, i) => e && emails.indexOf(e) !== i);
  const laneTagged = leadArray.filter((l) => String(l.importListName ?? '') === FIXTURE_TAG);

  saveObs('c5', {
    routableCountLine: routableCount,
    rowsOnRoutingTab: rowCount,
    selectedForAssign: pickedForAssign.selected,
    assignSelectionAttempts: pickedForAssign.attempts,
    assignRan: assignWorked,
    sdrPickerOptions,
    convertRepsChosen,
    afterAssign: (afterAssign.items as Record<string, unknown>[]).slice(0, 12).map((i) => ({
      name: [i.firstName, i.lastName].filter(Boolean).join(' '),
      status: i.status,
      qualification: i.qualification,
      campaign: (i.assignedCampaign as { name?: string } | null)?.name ?? null,
      sdr: (i.assignedSdr as { firstName?: string } | null)?.firstName ?? null,
    })),
    rowsAvailableToConvert: convertCount,
    selectedForConvert: pickedForConvert.selected,
    convertSelectionAttempts: pickedForConvert.attempts,
    convertedPoolItems: converted.length,
    convertedSample: converted.slice(0, 12).map((i) => ({
      name: [i.firstName, i.lastName].filter(Boolean).join(' '),
      status: i.status,
      convertedLeadId: i.convertedLeadId,
      campaign: (i.assignedCampaign as { name?: string } | null)?.name ?? null,
      sdr: (i.assignedSdr as { firstName?: string } | null)?.firstName ?? null,
    })),
    leadsApiStatus: leadsRes.status(),
    totalLeadsVisibleToManager: leadArray.length,
    createdLeads: myLeads.map((l) => ({
      id: l.id,
      name: `${l.firstName} ${l.lastName}`,
      email: l.email,
      company: l.company,
      stage: l.stage,
      source: l.source,
      importListName: l.importListName,
      vendorSource: l.vendorSource,
      assignedTo: (l.assignedTo as { firstName?: string } | null)?.firstName ?? null,
      campaign: (l.campaign as { name?: string } | null)?.name ?? null,
      priority: l.priority,
    })),
    leadsTaggedWithFixtureList: laneTagged.length,
    duplicateEmailsAmongCreatedLeads: dupEmails,
  });

  note(LANE, `C5 converted=${converted.length} leads=${myLeads.length} dupEmails=${dupEmails.length}`);
  rec.flush('c5-campaign-routing');

  expect(rowCount, 'routing tab should list the qualified records').toBeGreaterThan(0);
  expect(converted.length, 'qualified pool records should convert into leads').toBeGreaterThan(0);
  expect(myLeads.length, 'converted lead IDs should resolve to real Lead records').toBe(converted.length);
  expect.soft(dupEmails, 'conversion should not create duplicate lead emails').toEqual([]);
});

test('C6 export center: CSV download has real rows and sane columns', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, PERSONAS.leadgenManager);
  await gotoTimed(page, '/leadgen-manager?tab=export', rec);
  await page.waitForTimeout(2000);
  await shot(page, LANE, 'c6-export-tab');

  await page.getByPlaceholder(/name, email, company, title, source/).fill(FIXTURE_TAG);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Download CSV/i }).click(),
  ]);
  const target = path.join(ARTIFACTS, 'pool-export.csv');
  await download.saveAs(target);
  const csv = fs.readFileSync(target, 'utf8');
  const lines = csv.split(/\r?\n/).filter(Boolean);
  await page.waitForTimeout(1000);
  await shot(page, LANE, 'c6-after-export');

  saveObs('c6', {
    suggestedFilename: download.suggestedFilename(),
    savedTo: path.relative(process.cwd(), target),
    headerRow: lines[0],
    rowCount: lines.length - 1,
    sample: lines.slice(1, 4),
    containsVietnameseRow: /Nguy/.test(csv),
    vietnameseRow: lines.find((l) => /Nguy/.test(l)) ?? null,
    hasBom: csv.charCodeAt(0) === 0xfeff,
    exportsRoutingColumns: /campaign|sdr|assigned/i.test(lines[0] ?? ''),
  });

  note(LANE, `C6 export rows=${lines.length - 1}`);
  rec.flush('c6-export');

  expect(lines.length, 'export must contain a header plus at least one row').toBeGreaterThan(1);
  expect(lines[0]).toContain('email');
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4 — Leadgen member
// ─────────────────────────────────────────────────────────────────────────────

test('C7 leadgen member: landing, orientation, and which controls are actually usable', async ({ page }) => {
  test.setTimeout(150_000);
  await logout(page);
  await login(page, PERSONAS.leadgen);

  const nav = await gotoTimed(page, '/', rec);
  await page.waitForTimeout(3000);
  await shot(page, LANE, 'c7-leadgen-landing');

  const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
  const sidebarLinks = await page.locator('nav a, aside a').allInnerTexts().catch(() => [] as string[]);
  const buttons = await page.getByRole('button').allInnerTexts();

  const poolApi = await poolQuery(page, 'pageSize=5');
  const managerPage = await gotoTimed(page, '/leadgen-manager?tab=pool', rec);
  await page.waitForTimeout(2500);
  await shot(page, LANE, 'c7-leadgen-tries-manager-console');
  const managerPageUrl = page.url();

  await gotoTimed(page, '/leadgen', rec);
  await page.waitForTimeout(2500);
  const statTiles = await page.locator('.grid .bg-card-bg').allInnerTexts().catch(() => [] as string[]);
  const kanbanEmpty = await page.getByText('No leads found.').isVisible().catch(() => false);
  await shot(page, LANE, 'c7-leadgen-workspace');

  // Does the member's view show any "what do I do today" signal?
  const hasTaskLanguage = /task|due|today|overdue|to do|queue/i.test(bodyText);

  saveObs('c7', {
    landedFrom: '/',
    finalUrl: nav.finalUrl,
    sidebarLinks,
    buttonsOnLanding: buttons,
    statTiles: statTiles.map((s) => s.replace(/\s+/g, ' ').trim()),
    kanbanEmpty,
    hasTaskOrTodayLanguage: hasTaskLanguage,
    bodyExcerpt: bodyText.slice(0, 2000),
    poolApiStatusForLeadgenMember: poolApi.status,
    poolApiTotalForLeadgenMember: poolApi.total,
    leadgenManagerRouteResult: {
      requested: '/leadgen-manager?tab=pool',
      landedOn: managerPageUrl,
      nav: managerPage.finalUrl,
    },
  });

  note(LANE, `C7 landing=${nav.finalUrl} poolApi=${poolApi.status}/${poolApi.total}`);
  rec.flush('c7-leadgen-landing');

  expect(nav.finalUrl, 'a leadgen member should be redirected to their own workspace').toContain('/leadgen');
});

test('C8 leadgen member: enrich a lead and add a note, then verify it persists', async ({ page }) => {
  test.setTimeout(200_000);
  await logout(page);
  await login(page, PERSONAS.leadgen);
  await gotoTimed(page, '/leadgen', rec);
  await page.waitForTimeout(3500);

  const leadsRes = await page.request.get('/api/leads?pageSize=500');
  const leadsJson = leadsRes.ok() ? await leadsRes.json() : null;
  const leadArray: Record<string, unknown>[] = Array.isArray(leadsJson) ? leadsJson : (leadsJson?.leads ?? []);
  const laneOwned = leadArray.filter((l) => String(l.importListName ?? '') === FIXTURE_TAG);
  const target = laneOwned[0] ?? null;

  saveObs('c8_visibleLeads', {
    apiStatus: leadsRes.status(),
    total: leadArray.length,
    laneOwnedVisible: laneOwned.length,
    laneOwnedSample: laneOwned.slice(0, 6).map((l) => ({
      name: `${l.firstName} ${l.lastName}`,
      company: l.company,
      source: l.source,
      assignedTo: (l.assignedTo as { firstName?: string } | null)?.firstName ?? null,
    })),
  });

  if (!target) {
    saveObs('c8', { skipped: 'no lane-owned lead visible to the leadgen member' });
    rec.flush('c8-leadgen-enrich');
    test.skip(true, 'no lane-owned lead visible to the leadgen member — see C5/C7 findings');
    return;
  }

  const name = `${target.firstName} ${target.lastName}`;
  await page.getByText(name, { exact: false }).first().click();
  await expect(page.getByText('Prospect Profile')).toBeVisible({ timeout: 25000 });
  await shot(page, LANE, 'c8-lead-panel-before');

  await page.getByRole('button', { name: 'Edit' }).first().click();
  await page.waitForTimeout(500);
  const editableLabels = await page.locator('label').allInnerTexts();

  const newTitle = 'Head of Revenue Operations (QA-C)';
  const newPhone = '+1 415 555 9999';
  const newLinkedIn = 'https://www.linkedin.com/in/qa-lane-c-enriched';

  const fieldByLabel = (label: string) =>
    page.locator('div').filter({ has: page.locator(`label:text-is("${label}")`) }).locator('input').first();

  await fieldByLabel('Title').fill(newTitle);
  await fieldByLabel('Phone').fill(newPhone);
  await fieldByLabel('LinkedIn URL').fill(newLinkedIn);
  await shot(page, LANE, 'c8-lead-panel-editing');
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await page.waitForTimeout(3000);
  await shot(page, LANE, 'c8-lead-panel-saved');

  const noteText = 'QA lane C - enrichment pass: verified title, direct dial and LinkedIn.';
  const noteBox = page.getByPlaceholder('Add a new note to this timeline...');
  const noteBoxVisible = await noteBox.isVisible().catch(() => false);
  if (noteBoxVisible) {
    await noteBox.fill(noteText);
    await page.getByRole('button', { name: /Save Note/i }).click();
    await page.waitForTimeout(3000);
  }
  await shot(page, LANE, 'c8-lead-panel-note-added');

  const panelButtons = await page.getByRole('button').allInnerTexts();

  const verifyRes = await page.request.get(`/api/leads/${target.id}`);
  const verify = verifyRes.ok() ? await verifyRes.json() : null;

  await logout(page);
  await login(page, PERSONAS.leadgenManager);
  const mgrRes = await page.request.get(`/api/leads/${target.id}`);
  const mgrView = mgrRes.ok() ? await mgrRes.json() : null;

  saveObs('c8', {
    targetLead: { id: target.id, name, company: target.company },
    editableProfileLabels: editableLabels.filter((l) =>
      /Name|Company|Title|Email|Phone|LinkedIn|WhatsApp|Website|Industry|Country/i.test(l)
    ),
    websiteFieldPresent: editableLabels.some((l) => /website/i.test(l)),
    noteComposerPresent: noteBoxVisible,
    hasSubmitForQaAffordance: panelButtons.some((b) => /submit|qa|complete|hand ?off|ready/i.test(b)),
    panelButtons,
    afterSave: verify && {
      title: verify.title,
      phone: verify.phone,
      linkedIn: verify.linkedIn,
      noteCount: (verify.notes ?? []).length,
      lastNote: (verify.notes ?? [])[0]?.content ?? null,
    },
    managerSeesSameValues: mgrView && {
      status: mgrRes.status(),
      title: mgrView.title,
      phone: mgrView.phone,
      linkedIn: mgrView.linkedIn,
      noteCount: (mgrView.notes ?? []).length,
    },
  });

  note(LANE, `C8 enriched lead ${target.id}; saved title=${verify?.title}`);
  rec.flush('c8-leadgen-enrich');

  expect(verify?.title, 'title edit must persist').toBe(newTitle);
  expect(verify?.linkedIn, 'linkedIn edit must persist').toBe(newLinkedIn);
  expect.soft((mgrView?.notes ?? []).length, 'the manager must see the note the member added').toBeGreaterThan(0);
});
