/**
 * Lane D — SDR daily workflow (Phase 5).
 * Persona: lan.pham@telestar.vn (sdr). Report-only; no app code is modified.
 */
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { attachRecorders, gotoTimed, login, shot, sessionRole, note, laneDir } from './_helpers';
import { PERSONAS } from './personas';

const LANE = 'D';
const ME = PERSONAS.sdrLaneD;

test.describe.configure({ mode: 'serial' });

function dump(name: string, data: unknown): string {
  const file = path.join(laneDir(LANE, 'data'), `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

async function api(page: Page, url: string): Promise<any> {
  const res = await page.request.get(url);
  if (!res.ok()) return { __status: res.status(), __body: await res.text() };
  return res.json();
}

test('D0 — probe: what lan.pham actually owns', async ({ page }) => {
  const rec = attachRecorders(page, LANE);
  await login(page, ME);
  expect(await sessionRole(page)).toBe('sdr');

  const leads = await api(page, '/api/leads?limit=500');
  const today = await api(page, '/api/tasks?tab=today');
  const yest = await api(page, '/api/tasks?tab=yesterday');
  const overdue = await api(page, '/api/tasks?tab=overdue');

  const summary = {
    leadCount: Array.isArray(leads) ? leads.length : leads,
    leads: (Array.isArray(leads) ? leads : []).map((l: any) => ({
      id: l.id,
      firstName: l.firstName,
      lastName: l.lastName,
      company: l.company,
      email: l.email,
      stage: l.stage,
      priority: l.priority,
      assignedTo: l.assignedTo ? `${l.assignedTo.firstName} ${l.assignedTo.lastName}` : null,
      campaign: l.campaign?.name ?? null,
      archivedAt: l.archivedAt ?? null,
    })),
    tasks: {
      today: (Array.isArray(today) ? today : []).map((t: any) => ({
        id: t.id, type: t.type, status: t.status, title: t.title,
        lead: `${t.lead?.firstName} ${t.lead?.lastName}`, leadId: t.leadId, due: t.dueDate,
      })),
      yesterday: (Array.isArray(yest) ? yest : []).map((t: any) => ({ id: t.id, type: t.type, status: t.status })),
      overdue: (Array.isArray(overdue) ? overdue : []).map((t: any) => ({
        id: t.id, type: t.type, status: t.status, title: t.title,
        lead: `${t.lead?.firstName} ${t.lead?.lastName}`, leadId: t.leadId, due: t.dueDate,
      })),
    },
  };
  const file = dump('probe', summary);
  note(LANE, `D0 probe → ${file}`);
  await gotoTimed(page, '/', rec);
  await shot(page, LANE, 'D0-dashboard-first-load');
  rec.flush('D0-probe');
});

const visibleCount = async (page: Page) =>
  (await page.locator('span.font-mono', { hasText: /^\d+ of \d+$/ }).first().innerText()).trim();

test('D1 — dashboard tabs, counters and every task filter', async ({ page }) => {
  const rec = attachRecorders(page, LANE);
  await login(page, ME);
  await gotoTimed(page, '/', rec);
  await page.waitForSelector('h1');

  const findings: string[] = [];

  // ── Header counters vs API truth ────────────────────────────────────────────
  const statbar = (await page.locator('div.glass-card.rounded-xl').first().innerText()).replace(/\s+/g, ' ');
  findings.push(`statbar="${statbar}"`);

  // Tab counts
  const tabCounts: Record<string, string> = {};
  for (const tab of ['today', 'yesterday', 'overdue']) {
    const btn = page.locator('button', { hasText: new RegExp(`^${tab}\\s*\\d+$`, 'i') }).first();
    tabCounts[tab] = (await btn.innerText()).replace(/\s+/g, ' ');
  }
  findings.push(`tabs=${JSON.stringify(tabCounts)}`);

  // ── Which filters are even rendered? ────────────────────────────────────────
  const selects = await page.locator('div.px-5.py-2\\.5 select').count();
  const hasClient = await page.locator('option', { hasText: 'All clients' }).count();
  const hasCampaign = await page.locator('option', { hasText: 'All campaigns' }).count();
  findings.push(`filterSelects=${selects} clientFilterRendered=${hasClient} campaignFilterRendered=${hasCampaign}`);

  const base = await visibleCount(page);
  findings.push(`today baseline ${base}`);

  // ── Channel filter ──────────────────────────────────────────────────────────
  const channelSel = page.locator('select').filter({ has: page.locator('option[value="whatsapp"]') }).first();
  for (const ch of ['phone', 'email', 'linkedin', 'whatsapp', 'manual']) {
    await channelSel.selectOption(ch);
    await page.waitForTimeout(120);
    findings.push(`channel=${ch} → ${await visibleCount(page)}`);
  }
  await channelSel.selectOption('all');

  // ── Status filter (the interesting one on Today) ─────────────────────────────
  const statusSel = page.locator('select').filter({ has: page.locator('option[value="skipped"]') }).first();
  for (const st of ['pending', 'completed', 'skipped']) {
    await statusSel.selectOption(st);
    await page.waitForTimeout(120);
    findings.push(`today status=${st} → ${await visibleCount(page)}`);
  }
  await statusSel.selectOption('all');

  // ── Priority + stage ────────────────────────────────────────────────────────
  const prioSel = page.locator('select').filter({ has: page.locator('option[value="medium"]') }).first();
  for (const p of ['high', 'medium', 'low']) {
    await prioSel.selectOption(p);
    await page.waitForTimeout(120);
    findings.push(`priority=${p} → ${await visibleCount(page)}`);
  }
  await prioSel.selectOption('all');

  const stageSel = page.locator('select').filter({ has: page.locator('option[value="sequence_active"]') }).first();
  for (const s of ['new', 'sequence_active', 'replied', 'meeting_booked', 'won', 'lost']) {
    await stageSel.selectOption(s);
    await page.waitForTimeout(120);
    findings.push(`stage=${s} → ${await visibleCount(page)}`);
  }
  await stageSel.selectOption('all');

  // ── Search ──────────────────────────────────────────────────────────────────
  const search = page.getByPlaceholder('Search task or lead...');
  for (const q of ['Marcus', 'webb', 'Marcus Webb', 'OmniRetail', 'zzzz']) {
    await search.fill(q);
    await page.waitForTimeout(150);
    findings.push(`taskSearch="${q}" → ${await visibleCount(page)}`);
  }
  await search.fill('');
  await shot(page, LANE, 'D1-dashboard-filters');

  // ── Yesterday + Overdue tabs ────────────────────────────────────────────────
  await page.locator('button', { hasText: /^yesterday/i }).first().click();
  await page.waitForTimeout(200);
  findings.push(`yesterday visible ${await visibleCount(page)}`);
  await shot(page, LANE, 'D1-yesterday-tab');

  await page.locator('button', { hasText: /^overdue/i }).first().click();
  await page.waitForTimeout(200);
  findings.push(`overdue visible ${await visibleCount(page)}`);
  await statusSel.selectOption('completed');
  await page.waitForTimeout(150);
  findings.push(`overdue status=completed → ${await visibleCount(page)}`);
  await statusSel.selectOption('all');
  await shot(page, LANE, 'D1-overdue-tab');

  dump('D1-filters', findings);
  note(LANE, `D1 ${findings.join(' | ')}`);
  rec.flush('D1-dashboard-filters');
});

// ── D2 bulk-action safety ────────────────────────────────────────────────────
const LEADS = {
  ana: 'cmsc7654d006yvwukggaah7ue',
  fatima: 'cmsc7653r006ivwukkhpuizer',
  jake: 'cmsc765360062vwukddo7yvy8',
  marcus: 'cmsc7651s005mvwukeny7864q',
  nguyen: 'cmsc7653h006avwukrfc6uoxx',
  priya: 'cmsc7652v005uvwukfv7kopsf',
  kevin: 'cmsc76542006qvwukhx5tfijh',
};
const PHONE_TASK_TODAY = 'cmsc7659200auvwuku4j7uhrl';

async function createTask(page: Page, leadId: string, title: string, type = 'manual') {
  const res = await page.request.post('/api/tasks', {
    data: {
      leadId,
      type,
      title,
      description: 'QA lane D fixture',
      dueDate: '2026-08-03T10:00:00.000Z',
      priority: 'medium',
    },
  });
  const body = await res.json();
  if (!res.ok()) throw new Error(`createTask ${title} failed ${res.status()} ${JSON.stringify(body)}`);
  return body.id as string;
}

/** Full server-side snapshot of every task this SDR can see, keyed by id. */
async function snapshotTasks(page: Page): Promise<Record<string, any>> {
  const out: Record<string, any> = {};
  for (const tab of ['today', 'yesterday', 'overdue']) {
    const rows = await api(page, `/api/tasks?tab=${tab}`);
    for (const t of Array.isArray(rows) ? rows : []) {
      out[t.id] = {
        id: t.id, title: t.title, type: t.type, status: t.status,
        dueDate: t.dueDate, notes: t.notes ?? null, outcome: t.outcome ?? null, leadId: t.leadId,
      };
    }
  }
  return out;
}

function diffTasks(before: Record<string, any>, after: Record<string, any>) {
  const changed: string[] = [];
  for (const id of Object.keys(before)) {
    const b = before[id];
    const a = after[id];
    if (!a) { changed.push(`${b.title} :: LEFT-THE-THREE-TABS`); continue; }
    for (const k of ['status', 'dueDate', 'notes', 'outcome'] as const) {
      if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) changed.push(`${b.title} :: ${k}: ${b[k]} -> ${a[k]}`);
    }
  }
  for (const id of Object.keys(after)) if (!before[id]) changed.push(`${after[id].title} :: APPEARED`);
  return changed;
}

async function selectVisibleBySearch(page: Page, query: string): Promise<number> {
  await page.getByPlaceholder('Search task or lead...').fill(query);
  await page.waitForTimeout(300);
  const cb = page.locator('label', { hasText: 'Select all visible' }).locator('input[type="checkbox"]').first();
  if (await cb.isChecked()) await cb.uncheck();
  await cb.check();
  await page.waitForTimeout(250);
  const badge = page.locator('span').filter({ hasText: /^\d+ selected$/ }).first();
  return parseInt(await badge.innerText(), 10);
}

test('D2 — bulk actions touch only the selected records', async ({ page }) => {
  test.setTimeout(200000);
  const rec = attachRecorders(page, LANE);
  await login(page, ME);

  const stamp = Date.now().toString().slice(-6);
  const ids: Record<string, string> = {};
  ids.A1 = await createTask(page, LEADS.kevin, `QAD${stamp}-A1 reschedule me`);
  ids.A2 = await createTask(page, LEADS.ana, `QAD${stamp}-A2 reschedule me`);
  ids.B1 = await createTask(page, LEADS.fatima, `QAD${stamp}-B1 note me`);
  ids.C1 = await createTask(page, LEADS.priya, `QAD${stamp}-C1 complete me`);
  ids.C2 = await createTask(page, LEADS.jake, `QAD${stamp}-C2 complete me`);
  ids.D1 = await createTask(page, LEADS.nguyen, `QAD${stamp}-D1 mixed complete`);
  ids.E1 = await createTask(page, LEADS.marcus, `QAD${stamp}-E1 skip me`);
  dump('D2-fixture-ids', { stamp, ids });

  const evidence: Record<string, unknown> = { stamp, ids };
  await gotoTimed(page, '/', rec);
  await page.waitForSelector('h1');

  // ── A · bulk reschedule ─────────────────────────────────────────────────────
  let before = await snapshotTasks(page);
  let n = await selectVisibleBySearch(page, `QAD${stamp}-A`);
  expect(n, 'search QAD-A should select exactly 2 tasks').toBe(2);
  await page.locator('button').filter({ hasText: /^Reschedule$/ }).first().click();
  await page.locator('input[type="datetime-local"]').first().fill('2026-08-21T14:45');
  await page.locator('button').filter({ hasText: /^Move \d+ tasks?$/ }).first().click();
  await page.waitForTimeout(2000);
  await shot(page, LANE, 'D2-after-bulk-reschedule');
  let after = await snapshotTasks(page);
  evidence.A_diff = diffTasks(before, after);
  evidence.A_targetsAfter = [ids.A1, ids.A2].map((i) => after[i]?.dueDate ?? 'left-the-three-tabs');

  // ── B · bulk add note ───────────────────────────────────────────────────────
  const noteText = `QAD${stamp} bulk note`;
  const notesBefore: Record<string, number> = {};
  for (const [k, id] of Object.entries(LEADS)) {
    const rows = await api(page, `/api/notes?leadId=${id}`);
    notesBefore[k] = Array.isArray(rows) ? rows.length : -1;
  }
  before = await snapshotTasks(page);
  n = await selectVisibleBySearch(page, `QAD${stamp}-B`);
  expect(n).toBe(1);
  await page.locator('button').filter({ hasText: /^Add note$/ }).first().click();
  await page.getByPlaceholder('Note added to each selected lead...').fill(noteText);
  await page.locator('button').filter({ hasText: /^Add to \d+$/ }).first().click();
  await page.waitForTimeout(2000);
  const notesAfter: Record<string, number> = {};
  const noteHits: string[] = [];
  for (const [k, id] of Object.entries(LEADS)) {
    const rows = await api(page, `/api/notes?leadId=${id}`);
    notesAfter[k] = Array.isArray(rows) ? rows.length : -1;
    if (Array.isArray(rows) && rows.some((r: any) => r.content === noteText)) noteHits.push(k);
  }
  evidence.B_notesBefore = notesBefore;
  evidence.B_notesAfter = notesAfter;
  evidence.B_leadsWithNote = noteHits;
  evidence.B_taskDiff = diffTasks(before, await snapshotTasks(page));

  // ── C · bulk complete (manual tasks, no outcome needed) ─────────────────────
  before = await snapshotTasks(page);
  n = await selectVisibleBySearch(page, `QAD${stamp}-C`);
  expect(n).toBe(2);
  await page.locator('button').filter({ hasText: /^Complete$/ }).first().click();
  await page.waitForTimeout(2200);
  await shot(page, LANE, 'D2-after-bulk-complete');
  after = await snapshotTasks(page);
  evidence.C_diff = diffTasks(before, after);
  evidence.C_targetsAfter = [ids.C1, ids.C2].map((i) => after[i]?.status ?? 'left-the-three-tabs');

  // ── D · bulk complete on a MIXED selection incl. a phone task ───────────────
  before = await snapshotTasks(page);
  await page.getByPlaceholder('Search task or lead...').fill('');
  await page.waitForTimeout(400);
  const rowCheckbox = (needle: string) =>
    page.locator('div.p-4').filter({ hasText: needle }).first().locator('input[type="checkbox"]').first();
  await rowCheckbox(`QAD${stamp}-D1`).check();
  await rowCheckbox('Discovery call — Marcus Webb').check();
  await page.waitForTimeout(300);
  evidence.D_selected = await page.locator('span').filter({ hasText: /^\d+ selected$/ }).first().innerText();
  await page.locator('button').filter({ hasText: /^Complete$/ }).first().click();
  await page.waitForTimeout(2200);
  evidence.D_toast = await page
    .locator('div')
    .filter({ hasText: /task\(s\) updated/ })
    .last()
    .innerText()
    .then((s) => s.replace(/\s+/g, ' ').slice(0, 400))
    .catch(() => '(no toast captured)');
  await shot(page, LANE, 'D2-mixed-complete-result');
  after = await snapshotTasks(page);
  evidence.D_diff = diffTasks(before, after);
  evidence.D_phoneTaskStatus = after[PHONE_TASK_TODAY]?.status ?? 'left-the-three-tabs';

  // ── E · bulk skip vs single skip semantics ──────────────────────────────────
  before = await snapshotTasks(page);
  n = await selectVisibleBySearch(page, `QAD${stamp}-E`);
  expect(n).toBe(1);
  await page.locator('button').filter({ hasText: /^Skip$/ }).first().click();
  await page.waitForTimeout(2000);
  after = await snapshotTasks(page);
  evidence.E_diff = diffTasks(before, after);
  evidence.E_status = after[ids.E1]?.status ?? 'left-the-three-tabs';

  dump('D2-bulk-evidence', evidence);
  note(LANE, 'D2 evidence written');
  rec.flush('D2-bulk-safety');
});

test('D3 — leads pipeline: view toggle, search matrix, filters, scope', async ({ page }) => {
  test.setTimeout(200000);
  const rec = attachRecorders(page, LANE);
  await login(page, ME);

  const mine = await api(page, '/api/leads?limit=500');
  const campaignId = mine[0].campaign.id;

  // A lead STORED with diacritics, so the unaccented-query direction can be tested.
  let accentedId: string | null = null;
  const existing = (mine as any[]).find((l) => l.lastName === 'Hải');
  if (existing) accentedId = existing.id;
  else {
    const res = await page.request.post('/api/leads', {
      data: {
        firstName: 'Nguyễn', lastName: 'Hải', company: 'Đà Nẵng QA Co',
        email: `qa.haid.${Date.now()}@danangqa.vn`, campaignId, priority: 'warm',
      },
    });
    const body = await res.json();
    if (!res.ok()) throw new Error(`create accented lead failed ${res.status()} ${JSON.stringify(body)}`);
    accentedId = body.id;
  }

  // ── Search matrix, straight against the API (deterministic counts) ──────────
  const QUERIES: [string, string][] = [
    ['Marcus', 'first name'],
    ['Webb', 'last name'],
    ['webb', 'last name, lowercase'],
    ['Marcus Webb', 'full name'],
    ['Webb Marcus', 'reversed word order'],
    ['  Marcus   Webb  ', 'full name w/ padding'],
    ['OmniRetail', 'company'],
    ['marcus.webb@omniretail.sg', 'email'],
    ['Nguyen', 'unaccented query -> record stored UNACCENTED (Nguyen Thanh)'],
    ['Nguyễn', 'ACCENTED query -> record stored UNACCENTED (Nguyen Thanh)'],
    ['Nguyễn Hải', 'accented query -> record stored ACCENTED'],
    ['Hải', 'accented last name -> record stored ACCENTED'],
    ['Nguyen Hai', 'UNACCENTED query -> record stored ACCENTED'],
    ['Hai', 'unaccented last name -> record stored ACCENTED'],
    ['Đà Nẵng', 'accented company -> stored accented'],
    ['Da Nang', 'unaccented company -> stored accented'],
    ['Sales Director', 'job title (not a searched field)'],
    ['Ana Santos', 'contact.fullName style query'],
    ['zzzzzzz', 'no match'],
  ];
  const matrix: any[] = [];
  for (const [q, why] of QUERIES) {
    const rows = await api(page, `/api/leads?search=${encodeURIComponent(q)}`);
    matrix.push({
      query: q,
      note: why,
      count: Array.isArray(rows) ? rows.length : rows,
      hits: (Array.isArray(rows) ? rows : []).map((r: any) => `${r.firstName} ${r.lastName}`),
    });
  }

  // ── Filters + scope ─────────────────────────────────────────────────────────
  const filterProbes: any[] = [];
  const probe = async (label: string, url: string) => {
    const rows = await api(page, url);
    const arr = Array.isArray(rows) ? rows : [];
    filterProbes.push({
      label, url,
      count: Array.isArray(rows) ? arr.length : rows,
      allMine: arr.every((r: any) => r.assignedTo?.firstName === 'Lan'),
      owners: Array.from(new Set(arr.map((r: any) => `${r.assignedTo?.firstName} ${r.assignedTo?.lastName}`))),
    });
  };
  await probe('baseline', '/api/leads?limit=500');
  for (const s of ['new', 'sequence_active', 'replied', 'meeting_booked', 'won', 'lost']) {
    await probe(`stage=${s}`, `/api/leads?stage=${s}`);
  }
  for (const p of ['hot', 'warm', 'cold']) await probe(`priority=${p}`, `/api/leads?priority=${p}`);
  await probe('campaignId=mine', `/api/leads?campaignId=${campaignId}`);
  await probe('stage=new+priority=cold', '/api/leads?stage=new&priority=cold');
  await probe('search+stage combo', '/api/leads?search=Nguyen&stage=new');
  await probe('archived=true (ignored for sdr)', '/api/leads?archived=true');
  await probe('bogus campaignId', '/api/leads?campaignId=cmzzzzzzzzzzzzzzzzzzzzzzz');
  await probe('invalid stage (expect 400)', '/api/leads?stage=bogus');
  // Scope-widening attempt: ask for another rep's leads explicitly.
  const someoneElse = 'cmsc764yz0000vwuk00000000';
  await probe('assignedTo=other-user', `/api/leads?assignedTo=${someoneElse}`);
  await probe('limit=9999 (cap check)', '/api/leads?limit=9999');

  // ── UI: kanban <-> list toggle + search box parity ───────────────────────────
  await gotoTimed(page, '/leads', rec);
  await page.waitForSelector('h1');
  await shot(page, LANE, 'D3-leads-default-view');
  const ui: any = {};
  ui.defaultViewKanbanPressed = await page
    .locator('[aria-label="Kanban view"]').first().getAttribute('class');

  await page.locator('[aria-label="Table view"]').first().click();
  await page.waitForTimeout(600);
  ui.tableRows = await page.locator('tbody tr').count();
  await shot(page, LANE, 'D3-leads-table-view');

  await page.locator('[aria-label="Kanban view"]').first().click();
  await page.waitForTimeout(600);
  ui.kanbanColumns = await page.locator('[aria-label*="leads"]').count();
  await shot(page, LANE, 'D3-leads-kanban-view');

  const box = page.getByPlaceholder('Search full name, email, company, phone...');
  const uiSearch: any[] = [];
  for (const q of ['Marcus Webb', 'Webb Marcus', 'Nguyen Hai', 'Nguyễn Hải', 'zzzzzzz']) {
    await box.fill(q);
    await page.waitForTimeout(1400);
    const cards = await page.locator('[aria-label*="leads"]').allInnerTexts().catch(() => []);
    const bodyTxt = (await page.locator('main, body').first().innerText()).replace(/\s+/g, ' ');
    uiSearch.push({
      q,
      kanbanColumnHeaders: cards.map((c) => c.split('\n')[0]).slice(0, 8),
      mentionsWebb: bodyTxt.includes('Webb'),
      mentionsHai: bodyTxt.includes('Hải'),
    });
  }
  await box.fill('');
  await shot(page, LANE, 'D3-leads-search');

  dump('D3-search-matrix', { matrix, filterProbes, ui, uiSearch, accentedId });
  note(LANE, 'D3 search matrix written');
  rec.flush('D3-leads');
});

test('D2c — recheck the D2 fixture tasks straight from the API', async ({ page }) => {
  const rec = attachRecorders(page, LANE);
  await login(page, ME);
  const fixture = JSON.parse(
    fs.readFileSync(path.join(laneDir(LANE, 'data'), 'D2-fixture-ids.json'), 'utf8')
  );
  const rows: any[] = [];
  for (const [k, id] of Object.entries(fixture.ids as Record<string, string>)) {
    const r = await page.request.get(`/api/tasks/${id}`);
    const b = r.ok() ? await r.json() : { err: r.status(), body: await r.text() };
    rows.push({ key: k, id, title: b.title, dueDate: b.dueDate, status: b.status, outcome: b.outcome, notes: b.notes });
  }
  const phone = await page.request.get(`/api/tasks/${PHONE_TASK_TODAY}`);
  const pb = phone.ok() ? await phone.json() : null;
  dump('D2c-recheck', { rows, phoneTask: pb && { status: pb.status, outcome: pb.outcome, dueDate: pb.dueDate } });
  rec.flush('D2c-recheck');
});

test('D2b — bulk reschedule, instrumented', async ({ page }) => {
  test.setTimeout(150000);
  const rec = attachRecorders(page, LANE);
  const wire: any[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/tasks/bulk')) wire.push({ dir: 'req', method: r.method(), body: r.postData() });
  });
  page.on('response', async (r) => {
    if (r.url().includes('/api/tasks/bulk')) {
      wire.push({ dir: 'res', status: r.status(), body: await r.text().catch(() => '?') });
    }
  });

  await login(page, ME);
  const stamp = Date.now().toString().slice(-6);
  const t1 = await createTask(page, LEADS.kevin, `QAR${stamp}-R1`);
  const t2 = await createTask(page, LEADS.ana, `QAR${stamp}-R2`);

  await gotoTimed(page, '/', rec);
  await page.waitForSelector('h1');

  const n = await selectVisibleBySearch(page, `QAR${stamp}-R`);
  expect(n).toBe(2);

  await page.locator('button').filter({ hasText: /^Reschedule$/ }).first().click();
  const dt = page.locator('input[type="datetime-local"]').first();
  await expect(dt).toBeVisible();
  await dt.fill('2026-08-21T14:45');
  await page.waitForTimeout(300);
  const dtValue = await dt.inputValue();
  const moveBtn = page.locator('button').filter({ hasText: /^Move \d+ tasks?$/ }).first();
  const btnText = await moveBtn.innerText();
  const btnDisabled = await moveBtn.isDisabled();
  await shot(page, LANE, 'D2b-reschedule-panel');
  await moveBtn.click({ force: true });
  await page.waitForTimeout(2500);
  await shot(page, LANE, 'D2b-after-move-click');

  // Read the two tasks back directly, unfiltered by tab.
  const readBack: any[] = [];
  for (const id of [t1, t2]) {
    const r = await page.request.get(`/api/tasks/${id}`);
    readBack.push(r.ok() ? await r.json() : { status: r.status(), body: await r.text() });
  }

  const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  dump('D2b-reschedule', {
    dtValue, btnText, btnDisabled, wire,
    readBack: readBack.map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate, status: t.status })),
    pageMentionsUpdated: /task\(s\) updated/.test(bodyText),
    bodySnippet: bodyText.slice(0, 400),
  });
  rec.flush('D2b-reschedule');
});
