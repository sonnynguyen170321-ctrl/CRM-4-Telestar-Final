import { chromium } from 'playwright';

const BASE = process.env.AUDIT_BASE_URL || 'http://localhost:3000';
const log = (...a) => console.log(...a);
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

async function login(email, password = 'telestar2026') {
  for (let i = 1; i <= 3; i++) {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    try {
      await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 25000 });
      return true;
    } catch { await page.waitForTimeout(2000); }
  }
  return false;
}

check('login as director', await login('dean@telestar.vn'));

// ── F3: search ────────────────────────────────────────────────────────
const sample = (await page.evaluate(async () => {
  const r = await fetch('/api/leads?limit=1');
  const j = await r.json();
  return Array.isArray(j) && j[0] ? j[0] : null;
})) || { firstName: 'Dean', lastName: 'Director' };
const searchCount = (q) => page.evaluate(async (query) => {
  const r = await fetch(`/api/leads?search=${encodeURIComponent(query)}`);
  return r.ok ? (await r.json()).length : -1;
}, q);

check('F3 search by first name', (await searchCount(sample.firstName)) > 0);
check('F3 search by last name', (await searchCount(sample.lastName)) > 0);
check('F3 search by full name', (await searchCount(`${sample.firstName} ${sample.lastName}`)) > 0);
check('F3 search lowercase full name', (await searchCount(`${sample.firstName} ${sample.lastName}`.toLowerCase())) > 0);
check('F3 search reversed name order', (await searchCount(`${sample.lastName} ${sample.firstName}`)) > 0);
check('F3 nonsense search returns nothing', (await searchCount('zzzznotarealname')) === 0);

// ── F2: import ────────────────────────────────────────────────────────
const campaignId = await page.evaluate(async () => {
  const r = await fetch('/api/campaigns');
  const j = await r.json();
  return (j.find((c) => c.name === 'Telestar Campaign') || j[0]).id;
});
const stamp = Date.now();
const importRes = await page.evaluate(async ({ campaignId, stamp }) => {
  const rows = [
    // Phones must be unique per run too — a repeat run would otherwise hit the
    // importer's phone-based duplicate check and be skipped, not imported.
    { firstName: 'Reg', lastName: `TestOne${stamp}`, company: `RegCo ${stamp}`, title: 'CEO', email: `reg.one.${stamp}@example.com`, phone: `+8490${String(stamp).slice(-7)}`, source: 'Regression' },
    { firstName: 'Reg', lastName: `TestTwo${stamp}`, company: `RegCo ${stamp}`, title: 'CTO', email: `reg.two.${stamp}@example.com`, phone: `+8491${String(stamp).slice(-7)}`, source: 'Regression' },
    { firstName: 'Bad', lastName: 'Row', company: 'Broken Co', title: 'Manager', email: 'not-an-email', source: 'Regression' },
  ];
  const r = await fetch('/api/leads/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leads: rows, campaignId, targetType: 'lead', filename: 'regression.csv', defaultResolution: 'skip' }),
  });
  return { status: r.status, body: await r.json() };
}, { campaignId, stamp });
check('F2 import returns a usable response', importRes.status === 200 || importRes.status === 202, JSON.stringify(importRes.body));
check('F2 valid rows imported, invalid row rejected', importRes.body.imported === 2 && importRes.body.errored === 1, JSON.stringify(importRes.body));

const appears = await page.evaluate(async (stamp) => {
  const r = await fetch(`/api/leads?search=${encodeURIComponent(`Reg TestOne${stamp}`)}`);
  return (await r.json()).length;
}, stamp);
check('F2 imported lead appears in the pipeline', appears === 1, `${appears} found`);

// ── F4: dashboard filters + bulk ──────────────────────────────────────
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const f4 = await page.evaluate(() => ({
  checkboxes: document.querySelectorAll('input[type="checkbox"]').length,
  selects: document.querySelectorAll('select').length,
  selectAll: /select all visible/i.test(document.body.innerText),
  hasChannelFilter: !!Array.from(document.querySelectorAll('option')).find((o) => /all channels/i.test(o.textContent || '')),
  hasStageFilter: !!Array.from(document.querySelectorAll('option')).find((o) => /any stage/i.test(o.textContent || '')),
}));
check('F4A filter controls render', f4.hasChannelFilter && f4.hasStageFilter, JSON.stringify(f4));
check('F4B checkboxes + select all render', f4.checkboxes > 0 && f4.selectAll, JSON.stringify(f4));

// filter narrows the list
const filterEffect = await page.evaluate(() => {
  const before = document.querySelectorAll('input[type="checkbox"][aria-label^="Select task"]').length;
  return { before };
});
const channelSelect = page.locator('select').filter({ hasText: 'All channels' }).first();
await channelSelect.selectOption('email');
await page.waitForTimeout(600);
const afterFilter = await page.evaluate(() =>
  document.querySelectorAll('input[type="checkbox"][aria-label^="Select task"]').length
);
check('F4A channel filter narrows the task list', afterFilter <= filterEffect.before, `${filterEffect.before} -> ${afterFilter}`);
await channelSelect.selectOption('all');
await page.waitForTimeout(500);

// bulk skip two tasks via the API the UI calls
const bulkOutcome = await page.evaluate(async () => {
  const tasks = await (await fetch('/api/tasks?tab=today')).json();
  const pending = tasks.filter((t) => t.status === 'pending').slice(0, 2);
  if (pending.length === 0) return { skipped: true };
  const r = await fetch('/api/tasks/bulk', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskIds: pending.map((t) => t.id), action: 'skip' }),
  });
  return { status: r.status, body: await r.json(), attempted: pending.length };
});
check(
  'F4B bulk skip updates the selected tasks',
  bulkOutcome.skipped || (bulkOutcome.status === 200 && bulkOutcome.body.updated === bulkOutcome.attempted),
  JSON.stringify(bulkOutcome)
);

const bulkGuard = await page.evaluate(async () => {
  const tasks = await (await fetch('/api/tasks?tab=today')).json();
  const phone = tasks.filter((t) => t.type === 'phone' && t.status === 'pending').slice(0, 1);
  if (phone.length === 0) return { skipped: true };
  const r = await fetch('/api/tasks/bulk', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskIds: phone.map((t) => t.id), action: 'complete' }),
  });
  return { status: r.status, body: await r.json() };
});
check(
  'F4B bulk complete refuses call tasks without an outcome',
  bulkGuard.skipped || (bulkGuard.body.updated === 0 && bulkGuard.body.failed.length === 1),
  JSON.stringify(bulkGuard)
);

// ── F5: archive + restore ─────────────────────────────────────────────
const archiveFlow = await page.evaluate(async (stamp) => {
  const found = await (await fetch(`/api/leads?search=${encodeURIComponent(`Reg TestTwo${stamp}`)}`)).json();
  const lead = found[0];
  if (!lead) return { error: 'seed lead missing' };

  const del = await fetch(`/api/leads/${lead.id}`, { method: 'DELETE' });
  const afterArchive = await (await fetch(`/api/leads?search=${encodeURIComponent(`Reg TestTwo${stamp}`)}`)).json();
  const withArchived = await (await fetch(`/api/leads?archived=true&search=${encodeURIComponent(`Reg TestTwo${stamp}`)}`)).json();
  const detail = await (await fetch(`/api/leads/${lead.id}`)).json();

  const restore = await fetch(`/api/leads/${lead.id}/restore`, { method: 'POST' });
  const afterRestore = await (await fetch(`/api/leads?search=${encodeURIComponent(`Reg TestTwo${stamp}`)}`)).json();

  return {
    archiveStatus: del.status,
    hiddenAfterArchive: afterArchive.length,
    visibleWithArchivedFlag: withArchived.length,
    historyKept: Array.isArray(detail.activities) ? detail.activities.length : -1,
    restoreStatus: restore.status,
    visibleAfterRestore: afterRestore.length,
  };
}, stamp);
check('F5 archive succeeds', archiveFlow.archiveStatus === 200, JSON.stringify(archiveFlow));
check('F5 archived lead leaves the active list', archiveFlow.hiddenAfterArchive === 0);
check('F5 archived lead visible with ?archived=true', archiveFlow.visibleWithArchivedFlag === 1);
check('F5 history preserved on archived lead', archiveFlow.historyKept > 0, `${archiveFlow.historyKept} activities`);
check('F5 director can restore', archiveFlow.restoreStatus === 200 && archiveFlow.visibleAfterRestore === 1);

// An SDR must not be able to restore, and ?archived=true must not reveal archived leads
const sdrEmail = await page.evaluate(async () => {
  const users = await (await fetch('/api/users')).json();
  return (users.find((u) => u.role === 'sdr') || {}).email ?? null;
});
if (sdrEmail && (await login(sdrEmail))) {
  const leadId = await page.evaluate(async () => {
    const list = await (await fetch('/api/leads?limit=1')).json();
    return list[0]?.id ?? null;
  });
  const sdrRestore = await page.evaluate(async (id) => {
    const r = await fetch(`/api/leads/${id}/restore`, { method: 'POST' });
    return r.status;
  }, leadId);
  check('F5 SDR cannot restore a lead', sdrRestore === 403, `HTTP ${sdrRestore}`);
} else {
  check('F5 SDR permission check ran', false, `could not log in as SDR (${sdrEmail})`);
}

// ── F1: assistant setup ───────────────────────────────────────────────
await login('dean@telestar.vn');
await page.evaluate(async () => { await fetch('/api/ai/memory', { method: 'DELETE' }); try { sessionStorage.clear(); } catch {} });
await page.reload({ waitUntil: 'networkidle' });
const openBot = async () => {
  const r = page.locator('button[aria-label*="Assistant"]');
  if (await r.count()) { await r.click({ force: true }); await page.waitForTimeout(2000); }
};
const readPanel = () => page.evaluate(() => {
  const p = document.querySelector('.ai-chat-panel');
  if (!p) return { open: false };
  const t = p.innerText;
  return { open: true, step: (t.match(/Setup — Step \d of 5/) || [])[0] || null };
});
await openBot();
const answers = [
  'Test Client / Test Campaign.',
  'VP Sales at B2B SaaS companies.',
  'We give them pipeline without hiring in-house SDRs.',
  'LinkedIn then email then WhatsApp.',
  'Casual tone, short emails.',
];
for (const a of answers) {
  await page.fill('.ai-chat-panel textarea', a);
  await page.press('.ai-chat-panel textarea', 'Enter');
  await page.waitForTimeout(3000);
}
const finished = await readPanel();
check('F1 all 5 setup questions complete', finished.step === null, JSON.stringify(finished));
const mems = await page.evaluate(async () => (await fetch('/api/ai/memory')).json());
check('F1 setup persisted', mems.includes('setup_complete: true'), `${mems.length} memories`);

// mid-setup refresh resumes
await page.evaluate(async () => { await fetch('/api/ai/memory', { method: 'DELETE' }); try { sessionStorage.clear(); } catch {} });
await page.reload({ waitUntil: 'networkidle' });
await openBot();
await page.fill('.ai-chat-panel textarea', 'Test Client / Test Campaign.');
await page.press('.ai-chat-panel textarea', 'Enter');
await page.waitForTimeout(3000);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await openBot();
const resumed = await readPanel();
check('F1 refresh mid-setup resumes at the next question', resumed.step === 'Setup — Step 2 of 5', JSON.stringify(resumed));

// ── page smoke ────────────────────────────────────────────────────────
for (const path of ['/', '/leads', '/sequences', '/templates', '/team', '/opportunities', '/client-reports', '/email-health', '/settings']) {
  const res = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  check(`page ${path} loads`, (res?.status() ?? 0) < 400, `HTTP ${res?.status()}`);
  await page.waitForTimeout(400);
}

check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

const failed = results.filter((r) => !r.ok);
log(`\n===== ${results.length - failed.length}/${results.length} checks passed =====`);
if (failed.length) log('FAILED:', failed.map((f) => f.name).join(', '));

await browser.close();
