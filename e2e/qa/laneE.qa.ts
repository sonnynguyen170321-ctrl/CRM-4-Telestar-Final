/**
 * Lane E — Meetings → Opportunities → Client Reports.
 *
 * Throwaway QA scaffolding. Report-only: this spec never mutates app source.
 * Owns: Meeting, Opportunity, ClientReport, BookingLink, and david.miller's leads.
 */
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { attachRecorders, gotoTimed, login, logout, shot, laneDir, note } from './_helpers';
import { PERSONAS } from './personas';

const LANE = 'E';
const DIRECTOR = PERSONAS.director; // dean@telestar.vn
const SDR = PERSONAS.sdrLaneE; // david.miller@telestar.vn

const CLIENT_NAME = 'Telestar Demo Client';
const CAMPAIGN_NAME = 'Telestar Demo SDR Campaign';
const BOOKING_LINK_NAME = 'Telestar Demo — Discovery Call';
const BOOKING_LINK_URL = 'https://calendly.com/telestar-demo/discovery';
const LEAD_COMPANY = 'Nordwind Logistics QA';
const LEAD_FIRST = 'Marta';
const LEAD_LAST = 'Kovacs';
const LEAD_EMAIL = 'marta.kovacs@nordwind-qa.example.com';

/** Serial: every test builds on the record the previous one created. */
test.describe.configure({ mode: 'serial' });

/** Cross-test state. workers=1 + serial ⇒ one worker process, module state survives. */
const S: Record<string, any> = {};

/** Persist evidence artefacts (raw API payloads) for the findings write-up. */
function dump(name: string, data: unknown): string {
  const file = path.join(laneDir(LANE, 'data'), `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return path.relative(process.cwd(), file);
}

async function getJson(page: Page, url: string): Promise<any> {
  const res = await page.request.get(url);
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { __raw: text.slice(0, 4000) };
  }
  return { status: res.status(), headers: res.headers(), body, text };
}

async function postJson(page: Page, url: string, data: unknown): Promise<any> {
  const res = await page.request.post(url, { data: data as any });
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { __raw: text.slice(0, 4000) };
  }
  return { status: res.status(), body, text };
}

/**
 * Viewport-only screenshot. `shot()` takes a fullPage capture, which in this app
 * resizes the page and trips `DesktopOnlyGate` → every open modal/form unmounts
 * and loses its state. Use this whenever a form or modal is open.
 */
async function shotView(page: Page, name: string): Promise<string> {
  const file = path.join(laneDir(LANE, 'screenshots'), `${name}.png`);
  await page.screenshot({ path: file });
  return path.relative(process.cwd(), file);
}

/**
 * The Booking Links panel is remounted when `currentRole` resolves on
 * /settings, which silently closes any form opened too early. Wait for it to
 * finish its own fetch before touching it.
 */
async function waitForBookingPanel(page: Page): Promise<void> {
  await page.getByRole('heading', { name: 'Booking Links', exact: true }).waitFor({ timeout: 30000 });
  await expect(
    page.getByText('No booking links yet').or(page.getByRole('columnheader', { name: 'Provider' }))
  ).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(1500);
}

/** Re-hydrate ids when only a subset of the lane is re-run. */
async function ensureIds(page: Page): Promise<void> {
  if (!S.campaignId) {
    const camps = await getJson(page, '/api/campaigns');
    const camp = (camps.body as any[]).find?.((c: any) => c.name === CAMPAIGN_NAME);
    if (camp) {
      S.campaignId = camp.id;
      S.clientId = camp.clientId ?? camp.client?.id;
    }
  }
  if (!S.sdrId) {
    const users = await getJson(page, '/api/users');
    const list = Array.isArray(users.body) ? users.body : (users.body?.users ?? []);
    S.sdrId = list.find((u: any) => u.email === SDR)?.id;
  }
  if (!S.leadId && S.campaignId) {
    const leads = await getJson(page, `/api/leads?campaignId=${S.campaignId}&limit=50`);
    S.leadId = (leads.body as any[]).find?.((l: any) => l.email === LEAD_EMAIL)?.id;
  }
  if (!S.meetingId && S.leadId) {
    const ms = await getJson(page, `/api/meetings?leadId=${S.leadId}`);
    const m = (ms.body as any[]).find?.((x: any) => x.status === 'scheduled' && !x.outcome)
      ?? (ms.body as any[]).find?.((x: any) => x.outcome === 'qualified_opportunity');
    S.meetingId = m?.id;
  }
  if (!S.opportunityId && S.meetingId) {
    const os = await getJson(page, '/api/opportunities?limit=500');
    S.opportunityId = (os.body.opportunities ?? []).find((o: any) => o.meetingId === S.meetingId)?.id;
  }
}

/** Period that brackets every write this lane makes. */
function period() {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(start.getDate() - 7);
  start.setHours(0, 0, 0, 0);
  return { periodStart: start.toISOString(), periodEnd: end.toISOString() };
}

// ───────────────────────────────────────────────────────────────────────────
// SETUP — director
// ───────────────────────────────────────────────────────────────────────────

test('E-01 director creates the demo client + campaign from Settings', async ({ page }) => {
  test.setTimeout(420_000);
  const rec = attachRecorders(page, LANE);
  await login(page, DIRECTOR);
  await gotoTimed(page, '/settings', rec);

  // Idempotency across re-runs: reuse if it already exists.
  const before = await getJson(page, '/api/campaigns');
  const existing = (before.body as any[]).find?.((c: any) => c.name === CAMPAIGN_NAME);

  if (!existing) {
    await page.getByRole('button', { name: /Add Campaign/i }).click();
    await page.locator('input[placeholder="Campaign name"]').fill(CAMPAIGN_NAME);
    await page.locator('input[placeholder="New client name"]').fill(CLIENT_NAME);
    await page.locator('input[placeholder="Vertical (optional)"]').fill('Logistics / Freight');
    await page.locator('input[placeholder="Geo (optional)"]').fill('Vietnam / APAC');
    await shot(page, LANE, 'e01-campaign-form-filled');
    await page.getByRole('button', { name: /Create Campaign/i }).click();
    await page.waitForTimeout(1500);
    await shot(page, LANE, 'e01-campaign-created');
  }

  const after = await getJson(page, '/api/campaigns');
  const camp = (after.body as any[]).find((c: any) => c.name === CAMPAIGN_NAME);
  expect(camp, 'demo campaign should exist after creation').toBeTruthy();
  S.campaignId = camp.id;
  S.clientId = camp.clientId ?? camp.client?.id;
  dump('e01-campaign', camp);

  // Client linkage
  expect(camp.client?.name, 'campaign must be linked to the demo client').toBe(CLIENT_NAME);

  // FINDING PROBE: is there any channel selection on a campaign?
  const campaignKeys = Object.keys(camp);
  const hasChannels = campaignKeys.some((k) => /channel/i.test(k));
  note(
    LANE,
    `E-01 campaign fields = [${campaignKeys.join(', ')}]; channel field present = ${hasChannels}`
  );
  const channelInputs = await page
    .locator('form input, form select')
    .filter({ hasText: /channel/i })
    .count()
    .catch(() => 0);
  note(LANE, `E-01 channel inputs in campaign form = ${channelInputs}`);

  rec.flush('E-01-create-client-campaign');
});

test('E-02 campaign appears in filter dropdowns and SDRs can be assigned', async ({ page }) => {
  test.setTimeout(420_000);
  const rec = attachRecorders(page, LANE);
  await login(page, DIRECTOR);

  // Resolve david.miller's user id (needed for the lead + assignment checks).
  const users = await getJson(page, '/api/users');
  const list = Array.isArray(users.body) ? users.body : (users.body?.users ?? []);
  const david = list.find((u: any) => u.email === SDR);
  expect(david, 'david.miller must exist in /api/users').toBeTruthy();
  S.sdrId = david.id;
  S.sdrName = `${david.firstName} ${david.lastName}`.trim();

  // (a) /leads — does a campaign filter exist at all?
  await gotoTimed(page, '/leads', rec);
  const leadsSelects = await page.locator('select').allInnerTexts();
  const leadsHasCampaignFilter = leadsSelects.some((t) => t.includes(CAMPAIGN_NAME));
  note(LANE, `E-02 /leads selects = ${JSON.stringify(leadsSelects)}`);
  note(LANE, `E-02 /leads campaign filter contains demo campaign = ${leadsHasCampaignFilter}`);
  await shot(page, LANE, 'e02-leads-filters');

  // (b) Booking-link settings panel — client/campaign dropdowns are the ones that matter.
  await gotoTimed(page, '/settings', rec);
  await page.getByRole('button', { name: /Add Link/i }).click();
  await page.waitForTimeout(800);
  const bookingSelects = await page.locator('select').allInnerTexts();
  const bookingHasClient = bookingSelects.some((t) => t.includes(CLIENT_NAME));
  const bookingHasCampaign = bookingSelects.some((t) => t.includes(CAMPAIGN_NAME));
  note(
    LANE,
    `E-02 booking-link panel: client dropdown has demo client = ${bookingHasClient}, campaign dropdown has demo campaign = ${bookingHasCampaign}`
  );
  expect(bookingHasClient, 'demo client must be selectable in the booking-link panel').toBeTruthy();

  // (c) Client-report modal dropdowns — the documented "filter dropdown" for reports.
  const clientsApi = await getJson(page, '/api/clients');
  note(LANE, `E-02 GET /api/clients → ${clientsApi.status}`);
  dump('e02-api-clients', { status: clientsApi.status, body: clientsApi.body });

  await gotoTimed(page, '/client-reports', rec);
  await page.getByRole('button', { name: /Generate New Report/i }).first().click();
  await page.waitForTimeout(2500);
  // Scope to the modal overlay itself: the innermost div holding the heading is
  // only the header block, which would silently exclude the footer buttons.
  const modal = page.locator('div.fixed.inset-0').last();
  const clientOptions = await modal.locator('select').nth(0).locator('option').allInnerTexts();
  const campaignOptions = await modal.locator('select').nth(1).locator('option').allInnerTexts();
  note(LANE, `E-02 client-report modal client options = ${JSON.stringify(clientOptions)}`);
  note(LANE, `E-02 client-report modal campaign options = ${JSON.stringify(campaignOptions)}`);
  await shotView(page, 'e02-client-report-modal-dropdowns');
  S.reportModalClientOptions = clientOptions;

  // (d) SDR assignment to the campaign.
  const assign = await postJson(page, '/api/admin/assignments', {
    mode: 'campaign',
    campaignId: S.campaignId,
    userId: S.sdrId,
    action: 'assign',
  });
  note(LANE, `E-02 assign SDR→campaign POST /api/admin/assignments → ${assign.status} ${assign.text.slice(0, 300)}`);
  dump('e02-assignment', assign);

  rec.flush('E-02-filters-and-assignment');
});

test('E-03 director adds a booking link for the demo client/campaign and it persists', async ({ page }) => {
  test.setTimeout(420_000);
  const rec = attachRecorders(page, LANE);
  await login(page, DIRECTOR);
  await gotoTimed(page, '/settings', rec);

  const pre = await getJson(page, '/api/booking-links?activeOnly=false');
  const already = (pre.body as any[]).find?.((l: any) => l.name === BOOKING_LINK_NAME);

  if (!already) {
    await waitForBookingPanel(page);
    await page.getByRole('button', { name: /Add Link/i }).click();
    await page.waitForTimeout(1000);

    // Scope everything to the booking-link form so unrelated Settings controls
    // (there are ~20 selects on this page) cannot be hit by accident.
    const form = page
      .locator('div')
      .filter({ has: page.locator('h4', { hasText: 'New Booking Link' }) })
      .last();
    await expect(form).toBeVisible({ timeout: 15000 });
    await expect(form.locator('button').last(), 'booking-link form must stay mounted').toBeVisible({
      timeout: 10000,
    });

    const selects = form.locator('select');
    const probe = async (label: string) =>
      note(LANE, `E-03 form-alive after "${label}" = ${await form.count()}`);

    await selects.nth(0).selectOption({ label: CLIENT_NAME }); // Client
    await probe('select client');
    await page.waitForTimeout(500);
    await selects.nth(1).selectOption({ label: CAMPAIGN_NAME }); // Campaign
    await probe('select campaign');
    await form.locator('input[placeholder="e.g. John\'s Calendly"]').fill(BOOKING_LINK_NAME);
    await probe('fill name');
    await selects.nth(2).selectOption('calendly'); // Provider
    await probe('select provider');
    await form.locator('input[placeholder="https://calendly.com/..."]').fill(BOOKING_LINK_URL);
    await probe('fill url');
    await form.locator('textarea').nth(0).fill('Send this link after a positive reply. 30 min discovery.');
    await probe('fill instructions');
    await form.locator('textarea').nth(1).fill('Must be a decision maker with an active freight budget.');
    await probe('fill qualification notes');
    await form.locator('input[type="checkbox"]').check();
    await probe('check default');
    await shotView(page, 'e03-booking-link-form');
    await probe('viewport screenshot');

    const createBtn = form.getByRole('button', { name: 'Create', exact: true });
    await createBtn.click();
    await page.waitForTimeout(2500);
    await shot(page, LANE, 'e03-booking-link-saved');
  }

  // Reopen the record (full page reload → re-fetch) and confirm persistence.
  await gotoTimed(page, '/settings', rec);
  await waitForBookingPanel(page);
  await expect(page.getByText(BOOKING_LINK_NAME).first()).toBeVisible({ timeout: 20000 });

  const post = await getJson(page, '/api/booking-links?activeOnly=false');
  const link = (post.body as any[]).find((l: any) => l.name === BOOKING_LINK_NAME);
  expect(link, 'booking link must persist').toBeTruthy();
  S.bookingLinkId = link.id;
  dump('e03-booking-link', link);

  expect(link.url).toBe(BOOKING_LINK_URL);
  expect(link.client?.name).toBe(CLIENT_NAME);
  expect(link.campaign?.name, 'campaign scope must persist').toBe(CAMPAIGN_NAME);
  expect(link.isDefault, 'default flag must persist').toBe(true);
  expect(link.instructions, 'instructions must persist').toBeTruthy();
  expect(link.qualificationNotes, 'qualification notes must persist').toBeTruthy();

  // Reopen the edit form and check the round-trip of every field.
  await page.locator('tr', { hasText: BOOKING_LINK_NAME }).getByRole('button').nth(0).click();
  await page.waitForTimeout(800);
  await shot(page, LANE, 'e03-booking-link-edit-reopened');
  const nameVal = await page.locator('input[placeholder="e.g. John\'s Calendly"]').inputValue();
  const urlVal = await page.locator('input[placeholder="https://calendly.com/..."]').inputValue();
  expect(nameVal).toBe(BOOKING_LINK_NAME);
  expect(urlVal).toBe(BOOKING_LINK_URL);
  // Client select is hidden on edit — record whether the field is still reachable.
  const clientLabelVisible = await page.getByText('Client *').isVisible().catch(() => false);
  note(LANE, `E-03 edit form exposes Client field = ${clientLabelVisible}`);

  rec.flush('E-03-booking-link');
});

test('E-04 booking-link lookup used by the SDR modal vs. the documented waterfall', async ({ page }) => {
  test.setTimeout(420_000);
  const rec = attachRecorders(page, LANE);
  await login(page, DIRECTOR);

  // Create a CLIENT-LEVEL link (campaignId null) alongside the campaign-level one.
  const clientLevelName = 'Telestar Demo — Client Level Fallback';
  const pre = await getJson(page, '/api/booking-links?activeOnly=false');
  if (!(pre.body as any[]).some?.((l: any) => l.name === clientLevelName)) {
    const created = await postJson(page, '/api/booking-links', {
      clientId: S.clientId,
      campaignId: null,
      name: clientLevelName,
      url: 'https://calendly.com/telestar-demo/client-level',
      provider: 'calendly',
      durationMins: 30,
    });
    note(LANE, `E-04 create client-level link → ${created.status}`);
  }

  // Exactly the query MeetingBookingModal.tsx:54 fires.
  const modalQuery = await getJson(
    page,
    `/api/booking-links?clientId=${S.clientId}&campaignId=${S.campaignId}`
  );
  const names = (modalQuery.body as any[]).map((l: any) => l.name);
  dump('e04-modal-booking-link-query', { status: modalQuery.status, names, body: modalQuery.body });
  note(LANE, `E-04 modal query returned = ${JSON.stringify(names)}`);
  S.modalLinkNames = names;

  rec.flush('E-04-booking-link-waterfall');
});

test('E-05 SDR books a meeting from the lead slide-over', async ({ page }) => {
  test.setTimeout(420_000);
  const rec = attachRecorders(page, LANE);

  // Seed a lead inside the demo campaign, assigned to david.miller, as the director.
  await login(page, DIRECTOR);
  const existingLeads = await getJson(page, `/api/leads?campaignId=${S.campaignId}&limit=50`);
  let lead = (existingLeads.body as any[]).find?.((l: any) => l.email === LEAD_EMAIL);
  if (!lead) {
    const created = await postJson(page, '/api/leads', {
      firstName: LEAD_FIRST,
      lastName: LEAD_LAST,
      company: LEAD_COMPANY,
      title: 'VP Operations',
      email: LEAD_EMAIL,
      phone: '+84 90 123 4567',
      campaignId: S.campaignId,
      assignedToId: S.sdrId,
      priority: 'hot',
      source: 'QA Lane E',
    });
    note(LANE, `E-05 create demo lead → ${created.status}`);
    expect(created.status, `lead creation failed: ${created.text.slice(0, 300)}`).toBeLessThan(300);
    lead = created.body;
  }
  S.leadId = lead.id;
  dump('e05-lead', lead);
  await logout(page);

  // Now act as the SDR from the real UI.
  await login(page, SDR);
  await gotoTimed(page, '/leads', rec);

  const search = page.locator('input[placeholder*="Search" i]').first();
  await search.fill(LEAD_COMPANY);
  await page.waitForTimeout(1500);
  await shotView(page, 'e05-leads-search');

  const card = page.getByText(LEAD_COMPANY).first();
  const cardVisible = await card.isVisible().catch(() => false);
  note(LANE, `E-05 demo lead visible to the SDR on /leads = ${cardVisible}`);
  if (cardVisible) {
    await card.click();
  } else {
    // Fallback: the app exposes a documented event to open the slide-over.
    await page.evaluate(
      (id) => window.dispatchEvent(new CustomEvent('crm:open-lead', { detail: { leadId: id } })),
      S.leadId
    );
  }
  await page.waitForTimeout(2000);
  await shotView(page, 'e05-lead-slideover');

  // Meeting quick action lives in the Info tab action grid.
  await page.getByRole('button', { name: /^Meeting$/ }).first().click();
  await page.waitForTimeout(2000);
  await shotView(page, 'e05-booking-modal');

  const noLinksMsg = await page
    .getByText(/No booking links configured/i)
    .isVisible()
    .catch(() => false);
  note(LANE, `E-05 booking modal shows "no booking links" = ${noLinksMsg}`);
  expect(noLinksMsg, 'booking link created in E-03 must be offered to the SDR').toBeFalsy();

  const pre = await getJson(page, `/api/meetings?leadId=${S.leadId}`);
  const preList = pre.body as any[];

  // 1) Record "booking link sent".
  if (!preList.some((m: any) => m.status === 'link_sent')) {
    await page.getByRole('button', { name: /Mark Link Sent/i }).click();
    await page.getByRole('button', { name: /Record Link Sent/i }).click();
    await page.waitForTimeout(2500);
    await shot(page, LANE, 'e05-link-sent-recorded');
  } else {
    // UX probe: does Escape dismiss the Book Meeting modal at all?
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    const stillOpen = await page.getByRole('heading', { name: 'Book Meeting' }).isVisible().catch(() => false);
    note(LANE, `E-05 Book Meeting modal still open after Escape = ${stillOpen}`);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.waitForTimeout(600);
  }

  const afterLinkSent = await getJson(page, `/api/meetings?leadId=${S.leadId}`);
  const linkSent = (afterLinkSent.body as any[]).find((m: any) => m.bookingLinkId && m.sourceChannel !== null)
    ?? (afterLinkSent.body as any[]).find((m: any) => m.status === 'link_sent');
  dump('e05-meetings-after-link-sent', afterLinkSent.body);
  expect(linkSent, 'a booking-link-sent meeting record must exist').toBeTruthy();
  S.linkSentMeetingId = linkSent.id;
  expect(linkSent.bookingLinkId, 'link_sent must reference the booking link').toBeTruthy();

  // 2) Schedule a real meeting (skip if one is already awaiting an outcome).
  let scheduled = (afterLinkSent.body as any[]).find((m: any) => m.status === 'scheduled' && !m.outcome);
  if (!scheduled) {
    await page.getByRole('button', { name: /^Meeting$/ }).first().click();
    await page.waitForTimeout(1800);
    await page.getByRole('button', { name: /Schedule Meeting/i }).first().click();
    const when = new Date();
    when.setDate(when.getDate() + 1);
    when.setHours(10, 0, 0, 0);
    const local = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}T10:00`;
    await page.locator('input[type="datetime-local"]').fill(local);
    await page.locator('input[type="url"]').fill('https://meet.google.com/qa-lane-e-demo');
    await shotView(page, 'e05-schedule-form');
    await page.getByRole('button', { name: /^Schedule Meeting$/ }).last().click();
    await page.waitForTimeout(2500);
    await shot(page, LANE, 'e05-meeting-scheduled');
  }

  const meetings = await getJson(page, `/api/meetings?leadId=${S.leadId}`);
  dump('e05-meetings', meetings.body);
  note(
    LANE,
    `E-05 /api/meetings order (scheduledAt desc) = ${JSON.stringify(
      (meetings.body as any[]).map((m: any) => ({ status: m.status, scheduledAt: m.scheduledAt }))
    )}`
  );
  scheduled = (meetings.body as any[]).find((m: any) => m.status === 'scheduled' && !m.outcome);
  expect(scheduled, 'a scheduled meeting must exist').toBeTruthy();
  S.meetingId = scheduled.id;
  S.meetingTitle = scheduled.title;
  expect(scheduled.clientId, 'meeting must inherit the campaign client').toBe(S.clientId);
  expect(scheduled.campaignId).toBe(S.campaignId);

  // 3) It must show up on /meetings.
  await gotoTimed(page, '/meetings', rec);
  await page.waitForTimeout(1500);
  await shot(page, LANE, 'e05-meetings-page');
  await expect(page.getByText(LEAD_COMPANY).first()).toBeVisible({ timeout: 15000 });

  rec.flush('E-05-book-meeting');
});

test('E-06 SDR logs completed + qualified_opportunity and E-07 the opportunity is auto-created', async ({ page }) => {
  test.setTimeout(420_000);
  const rec = attachRecorders(page, LANE);
  await login(page, SDR);
  await ensureIds(page);
  await gotoTimed(page, '/meetings', rec);
  await page.waitForTimeout(1500);

  // Narrow to the one meeting under test. The default list sorts NULL scheduledAt
  // first, so the top "Log Outcome" button belongs to the link_sent placeholder,
  // not to the meeting the SDR actually ran — filter explicitly.
  await page.locator('input[placeholder*="Search by prospect" i]').fill(LEAD_COMPANY);
  await page.locator('select').first().selectOption('scheduled');
  await page.waitForTimeout(1500);
  await shotView(page, 'e06-meetings-filtered');

  const logBtn = page.getByRole('button', { name: /Log Outcome/i }).first();
  const hasLogBtn = await logBtn.isVisible().catch(() => false);
  note(LANE, `E-06 "Log Outcome" reachable from /meetings = ${hasLogBtn}`);
  expect(hasLogBtn, '"Log Outcome" must be reachable for a scheduled meeting').toBeTruthy();
  await logBtn.click();
  await page.waitForTimeout(1500);
  await shotView(page, 'e06-outcome-modal');

  await page.getByRole('button', { name: /^Completed$/ }).click();
  await page.waitForTimeout(500);
  await page
    .locator('select')
    .filter({ hasText: 'Qualified Opportunity' })
    .first()
    .selectOption('qualified_opportunity');
  await page.waitForTimeout(500);

  await page.locator('input[type="number"]').fill('48000');
  await page
    .locator('textarea')
    .first()
    .fill('Budget confirmed for Q4, VP Ops is the economic buyer, needs a freight visibility rollout by January.');
  // Outcome notes + next step
  const textareas = page.locator('textarea');
  const taCount = await textareas.count();
  await textareas.nth(taCount - 1).fill('Client AE to run a technical deep-dive next Tuesday.');
  await textareas.nth(1).fill('Manual tracking across 3 systems; 2 missed SLA penalties last quarter.');
  await shotView(page, 'e06-outcome-filled');

  await page.getByRole('button', { name: /Log Outcome/i }).last().click();
  await page.waitForTimeout(3500);
  await shot(page, LANE, 'e06-after-outcome');

  // ── E-07 verification ────────────────────────────────────────────────────
  const meeting = await getJson(page, `/api/meetings/${S.meetingId}`);
  dump('e07-meeting-after-outcome', meeting.body);
  expect(meeting.body.status, 'meeting status must be completed').toBe('completed');
  expect(meeting.body.outcome, 'outcome must be qualified_opportunity').toBe('qualified_opportunity');

  const opps = await getJson(page, '/api/opportunities?limit=500');
  dump('e07-opportunities', opps.body);
  const forLead = (opps.body.opportunities ?? []).filter((o: any) => o.leadId === S.leadId);
  note(
    LANE,
    `E-07 opportunities on this single lead = ${forLead.length} → ${JSON.stringify(
      forLead.map((o: any) => ({ id: o.id, meetingId: o.meetingId, stage: o.stage, status: o.status }))
    )}`
  );
  const opp = forLead.find((o: any) => o.meetingId === S.meetingId);
  expect(opp, 'an opportunity must be auto-created from the qualified meeting').toBeTruthy();
  S.opportunityId = opp.id;

  expect(opp.stage, 'initial stage must be pending_client_review').toBe('pending_client_review');
  expect(opp.status).toBe('open');
  expect(opp.handoffStatus).toBe('pending');
  expect(opp.meetingId, 'the meeting link must be preserved on the opportunity').toBe(S.meetingId);
  expect(opp.leadId).toBe(S.leadId);
  expect(opp.company, 'company must be copied from the lead').toBe(LEAD_COMPANY);
  expect(opp.contactEmail).toBe(LEAD_EMAIL);
  expect(opp.contactName).toBe(`${LEAD_FIRST} ${LEAD_LAST}`);
  expect(opp.contactTitle).toBe('VP Operations');
  expect(opp.clientId).toBe(S.clientId);
  expect(opp.campaignId).toBe(S.campaignId);
  note(LANE, `E-07 opportunity value carried from the outcome modal = ${JSON.stringify(opp.value)}`);
  note(LANE, `E-07 opportunity qualificationSummary present = ${Boolean(opp.qualificationSummary)}`);
  note(LANE, `E-07 opportunity nextStep = ${JSON.stringify(opp.nextStep)}`);

  await gotoTimed(page, '/opportunities', rec);
  await page.waitForTimeout(1500);
  await shot(page, LANE, 'e07-opportunities-board');

  rec.flush('E-06-07-outcome-and-opportunity');
});

test('E-08 SDR is refused an opportunity stage change', async ({ page }) => {
  test.setTimeout(420_000);
  const rec = attachRecorders(page, LANE);
  await login(page, SDR);
  await ensureIds(page);

  const res = await postJson(page, `/api/opportunities/${S.opportunityId}/stage`, {
    stage: 'accepted_by_client',
    note: 'QA Lane E — SDR privilege probe',
  });
  dump('e08-sdr-stage-attempt', res);
  note(LANE, `E-08 SDR stage change → ${res.status} ${res.text.slice(0, 200)}`);
  expect(res.status, 'an SDR must not be able to move opportunity stages').toBe(403);

  // Confirm nothing moved.
  const after = await getJson(page, `/api/opportunities/${S.opportunityId}`);
  const stage = after.body?.opportunity?.stage ?? after.body?.stage;
  expect(stage).toBe('pending_client_review');

  // Also probe the generic PATCH — a common bypass.
  const patch = await page.request.patch(`/api/opportunities/${S.opportunityId}`, {
    data: { stage: 'won' },
  });
  const patchText = await patch.text();
  note(LANE, `E-08 SDR PATCH stage bypass → ${patch.status()} ${patchText.slice(0, 250)}`);
  dump('e08-sdr-patch-attempt', { status: patch.status(), body: patchText.slice(0, 2000) });

  const afterPatch = await getJson(page, `/api/opportunities/${S.opportunityId}`);
  const stage2 = afterPatch.body?.opportunity?.stage ?? afterPatch.body?.stage;
  note(LANE, `E-08 stage after PATCH attempt = ${stage2}`);

  rec.flush('E-08-sdr-stage-guard');
});

test('E-09 director walks the opportunity through the real stages to won', async ({ page }) => {
  test.setTimeout(420_000);
  const rec = attachRecorders(page, LANE);
  await login(page, DIRECTOR);
  await ensureIds(page);

  const before = await getJson(page, '/api/opportunities?limit=500');
  S.summaryBefore = before.body?.summary;
  dump('e09-summary-before', before.body?.summary);

  // Drive the first hop through the UI so the manager control is genuinely exercised.
  await gotoTimed(page, '/opportunities', rec);
  await page.waitForTimeout(2000);
  await page.getByText(LEAD_COMPANY).first().click();
  await page.waitForTimeout(1500);
  await shotView(page, 'e09-opportunity-panel');

  const stageSelect = page.locator('select').filter({ hasText: 'Pending Client Review' }).first();
  const stageSelectVisible = await stageSelect.isVisible().catch(() => false);
  note(LANE, `E-09 manager stage select visible in detail panel = ${stageSelectVisible}`);
  if (stageSelectVisible) {
    await stageSelect.selectOption('accepted_by_client');
    await page.waitForTimeout(2500);
    await shot(page, LANE, 'e09-stage-accepted');
  }

  const stagesLeft = ['discovery', 'proposal', 'negotiation', 'won'];
  const stageTrace: any[] = [];
  for (const stage of stagesLeft) {
    const body: Record<string, unknown> = { stage, note: `QA Lane E — moved to ${stage}` };
    if (stage === 'proposal') {
      body.value = 52000;
      body.probability = 60;
      body.expectedCloseDate = new Date(Date.now() + 20 * 86400000).toISOString();
    }
    if (stage === 'negotiation') body.probability = 80;
    const res = await postJson(page, `/api/opportunities/${S.opportunityId}/stage`, body);
    stageTrace.push({ stage, status: res.status, body: res.body });
    expect(res.status, `stage move to ${stage} failed: ${res.text.slice(0, 300)}`).toBeLessThan(300);
  }
  dump('e09-stage-trace', stageTrace);

  // Add an activity note through the API surface the UI uses.
  const act = await postJson(page, `/api/opportunities/${S.opportunityId}/activity`, {
    note: 'QA Lane E — pricing agreed with the client AE; contract sent for signature.',
  });
  note(LANE, `E-09 add activity note → ${act.status}`);

  const final = await getJson(page, `/api/opportunities/${S.opportunityId}`);
  const o = final.body?.opportunity ?? final.body;
  dump('e09-opportunity-final', o);
  expect(o.stage).toBe('won');
  expect(o.status).toBe('won');
  note(LANE, `E-09 won opportunity handoffStatus = ${o.handoffStatus} (never set by the stage API)`);
  note(LANE, `E-09 won opportunity value = ${JSON.stringify(o.value)} probability = ${o.probability}`);

  // Did the lead stage follow?
  const lead = await getJson(page, `/api/leads/${S.leadId}`);
  note(LANE, `E-09 lead stage after won = ${lead.body?.stage}`);

  // Forecast + summary numbers
  const after = await getJson(page, '/api/opportunities?limit=500');
  dump('e09-summary-after', after.body?.summary);
  S.summaryAfter = after.body?.summary;
  note(LANE, `E-09 summary before = ${JSON.stringify(S.summaryBefore)}`);
  note(LANE, `E-09 summary after  = ${JSON.stringify(S.summaryAfter)}`);

  const metrics = await getJson(page, '/api/opportunities/metrics?groupBy=client');
  dump('e09-metrics-by-client', metrics.body);

  await gotoTimed(page, '/opportunities', rec);
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /^Forecast$/ }).click();
  await page.waitForTimeout(1200);
  await shot(page, LANE, 'e09-forecast');

  rec.flush('E-09-opportunity-pipeline');
});

test('E-10 a second opportunity marked lost leaves the active pipeline', async ({ page }) => {
  test.setTimeout(420_000);
  const rec = attachRecorders(page, LANE);
  await login(page, DIRECTOR);
  await ensureIds(page);

  const created = await postJson(page, '/api/opportunities', {
    clientId: S.clientId,
    campaignId: S.campaignId,
    title: 'Nordwind Logistics QA — Secondary Site Rollout',
    company: LEAD_COMPANY,
    contactName: `${LEAD_FIRST} ${LEAD_LAST}`,
    contactEmail: LEAD_EMAIL,
    ownerId: S.sdrId,
    value: 15000,
    currency: 'USD',
  });
  dump('e10-second-opp-create', created);
  expect(created.status, `second opportunity create failed: ${created.text.slice(0, 400)}`).toBeLessThan(300);
  const second = created.body?.opportunity ?? created.body;
  S.lostOpportunityId = second.id;

  const summaryBefore = (await getJson(page, '/api/opportunities?limit=500')).body?.summary;

  // Lost without a reason must be rejected.
  const noReason = await postJson(page, `/api/opportunities/${S.lostOpportunityId}/stage`, { stage: 'lost' });
  note(LANE, `E-10 lost without lostReason → ${noReason.status} ${noReason.text.slice(0, 200)}`);
  expect(noReason.status, 'lost must require a LostReason').toBeGreaterThanOrEqual(400);

  const lost = await postJson(page, `/api/opportunities/${S.lostOpportunityId}/stage`, {
    stage: 'lost',
    lostReason: 'no_budget',
    lostReasonDetails: 'QA Lane E — budget deferred to next fiscal year.',
  });
  expect(lost.status, `lost transition failed: ${lost.text.slice(0, 300)}`).toBeLessThan(300);

  const detail = await getJson(page, `/api/opportunities/${S.lostOpportunityId}`);
  const lo = detail.body?.opportunity ?? detail.body;
  dump('e10-lost-opportunity', lo);
  expect(lo.stage).toBe('lost');
  expect(lo.status).toBe('lost');
  expect(lo.lostReason).toBe('no_budget');

  const summaryAfter = (await getJson(page, '/api/opportunities?limit=500')).body?.summary;
  dump('e10-summary', { summaryBefore, summaryAfter });
  note(LANE, `E-10 summary before = ${JSON.stringify(summaryBefore)}`);
  note(LANE, `E-10 summary after  = ${JSON.stringify(summaryAfter)}`);
  expect(summaryAfter.lost, 'lost count must increase').toBeGreaterThan(summaryBefore.lost);
  expect(summaryAfter.acceptedByClient, 'a lost deal must not count as accepted').toBe(
    summaryBefore.acceptedByClient
  );

  // The lost deal must not sit in the open board or the client-review queue.
  await gotoTimed(page, '/opportunities', rec);
  await page.waitForTimeout(1800);
  await page.getByRole('button', { name: 'Client Review', exact: true }).click();
  await page.waitForTimeout(1200);
  const inReviewQueue = await page
    .getByText('Secondary Site Rollout')
    .isVisible()
    .catch(() => false);
  note(LANE, `E-10 lost deal still shown in Client Review queue = ${inReviewQueue}`);
  await shotView(page, 'e10-client-review-queue');
  expect(inReviewQueue, 'a lost opportunity must not sit in the client review queue').toBeFalsy();

  rec.flush('E-10-lost-opportunity');
});

// ───────────────────────────────────────────────────────────────────────────
// CLIENT REPORT
// ───────────────────────────────────────────────────────────────────────────

test('E-11 director generates a client report preview', async ({ page }) => {
  test.setTimeout(420_000);
  const rec = attachRecorders(page, LANE);
  await login(page, DIRECTOR);
  await ensureIds(page);
  await gotoTimed(page, '/client-reports', rec);

  await page.getByRole('button', { name: /Generate New Report/i }).first().click();
  await page.waitForTimeout(2500);
  await shotView(page, 'e11-create-modal');

  // Scope to the modal overlay itself: the innermost div holding the heading is
  // only the header block, which would silently exclude the footer buttons.
  const modal = page.locator('div.fixed.inset-0').last();
  const clientSelect = modal.locator('select').nth(0);
  const options = await clientSelect.locator('option').allInnerTexts();
  note(LANE, `E-11 client dropdown options = ${JSON.stringify(options)}`);
  S.uiClientOptions = options;

  const canPickDemoClientInUi = options.some((o) => o.includes(CLIENT_NAME));
  note(LANE, `E-11 demo client selectable in the UI = ${canPickDemoClientInUi}`);

  const previewBtn = modal.getByRole('button', { name: /Preview Live Metrics/i });
  note(LANE, `E-11 "Preview Live Metrics" disabled = ${await previewBtn.isDisabled()}`);
  note(
    LANE,
    `E-11 "Create Report Draft" disabled = ${await modal.getByRole('button', { name: /Create Report Draft/i }).isDisabled()}`
  );

  if (canPickDemoClientInUi) {
    await clientSelect.selectOption({ label: CLIENT_NAME });
    await page.waitForTimeout(600);
    await modal.locator('select').nth(1).selectOption({ label: CAMPAIGN_NAME }).catch(() => {});
    const p = period();
    await modal.locator('input[type="date"]').first().fill(p.periodStart.slice(0, 10));
    await modal.locator('input[type="date"]').nth(1).fill(p.periodEnd.slice(0, 10));
    await previewBtn.click();
    await page.waitForTimeout(3500);
    await shotView(page, 'e11-preview-rendered');
  } else {
    await shotView(page, 'e11-client-dropdown-empty');
  }

  // Preview via the API regardless, so the audit has a snapshot to work with.
  const p = period();
  const preview = await postJson(page, '/api/client-reports/preview', {
    clientId: S.clientId,
    campaignId: S.campaignId,
    ...p,
    periodType: 'weekly',
    audience: 'client',
    sdrDisplayMode: 'first_last_initial',
  });
  dump('e11-preview-snapshot', preview.body);
  note(LANE, `E-11 POST /api/client-reports/preview → ${preview.status}`);
  expect(preview.status, `preview failed: ${preview.text.slice(0, 600)}`).toBe(200);
  S.snapshot = preview.body.snapshot;

  // Prisma / server errors surfaced on the wire?
  const failed = rec.failedRequests.filter((r) => r.url.includes('/api/'));
  note(LANE, `E-11 failed API requests during preview = ${JSON.stringify(failed)}`);

  rec.flush('E-11-report-preview');
});

test('E-12 report content audited against what actually happened', async ({ page }) => {
  test.setTimeout(420_000);
  const rec = attachRecorders(page, LANE);
  await login(page, DIRECTOR);
  await ensureIds(page);
  const snap = S.snapshot;
  expect(snap, 'E-11 must have produced a snapshot').toBeTruthy();

  const audit = {
    kpis: snap.kpis,
    channels: snap.channels,
    leadQuality: snap.leadQuality,
    funnel: snap.funnel,
    reps: snap.reps,
    insights: snap.insights,
    emailChannelHealth: snap.emailChannelHealth,
    meetings: snap.meetings,
    opportunities: snap.opportunities,
    meta: snap.meta,
  };
  dump('e12-snapshot-audit', audit);

  // Ground truth for this campaign — one lead, two meetings, two opportunities,
  // zero emails sent (outbound disabled), zero replies logged.
  note(LANE, `E-12 kpis = ${JSON.stringify(snap.kpis)}`);
  note(LANE, `E-12 leadQuality = ${JSON.stringify(snap.leadQuality)}`);
  note(LANE, `E-12 channels = ${JSON.stringify(snap.channels)}`);
  note(LANE, `E-12 insights = ${JSON.stringify(snap.insights)}`);
  note(LANE, `E-12 reps = ${JSON.stringify(snap.reps)}`);

  // (1) positiveReplies is a hard-coded 45% of replies.
  const expectedFabricated = Math.round(snap.kpis.replies * 0.45);
  note(
    LANE,
    `E-12 positiveReplies=${snap.kpis.positiveReplies} vs replies*0.45=${expectedFabricated} (fabrication check)`
  );
  expect(snap.kpis.positiveReplies).toBe(expectedFabricated);

  // (2) per-channel meetingsBooked is a fixed 0.4/0.45/0.1/0.05 split of the total.
  const totalBooked = snap.kpis.meetingsBooked;
  const split = snap.channels.map((c: any) => c.meetingsBooked);
  const expectedSplit = [0.4, 0.45, 0.1, 0.05].map((r) => Math.round(totalBooked * r));
  note(LANE, `E-12 channel meetingsBooked = ${JSON.stringify(split)} vs formula ${JSON.stringify(expectedSplit)}`);
  expect(split).toEqual(expectedSplit);

  // (3) lead quality is 94%/88%/6% of the lead count, plus two hard-coded constants.
  const base = snap.kpis.newLeadsAdded || snap.kpis.totalLeadsAssigned;
  note(
    LANE,
    `E-12 leadQuality vs formula: validated ${snap.leadQuality.validated}/${Math.round(base * 0.94)}, ` +
      `qualified ${snap.leadQuality.qualified}/${Math.round(base * 0.88)}, ` +
      `rejected ${snap.leadQuality.rejected}/${Math.round(base * 0.06)}, ` +
      `duplicateRate ${snap.leadQuality.duplicateRate}, averageEmailScore ${snap.leadQuality.averageEmailScore}`
  );
  expect(snap.leadQuality.duplicateRate).toBe(0.03);
  expect(snap.leadQuality.averageEmailScore).toBe(92);

  // (4) "Won Deals" in the funnel is a boolean masquerading as a count.
  const wonRow = snap.funnel.find((f: any) => f.stage === 'won_deals');
  note(LANE, `E-12 funnel won_deals = ${JSON.stringify(wonRow)} against wonValue=${snap.kpis.wonValue}`);

  // (5) Narrative claims vs. reality.
  note(LANE, `E-12 summary text = ${snap.insights.summary}`);
  note(LANE, `E-12 keyWins = ${JSON.stringify(snap.insights.keyWins)}`);
  note(LANE, `E-12 blockers = ${JSON.stringify(snap.insights.blockers)}`);
  note(LANE, `E-12 recommendations = ${JSON.stringify(snap.insights.recommendations)}`);
  note(LANE, `E-12 emailChannelHealth = ${JSON.stringify(snap.emailChannelHealth)}`);

  // (6) Internal-only fields leaking into a client-facing document.
  const raw = JSON.stringify(snap);
  const leaks: string[] = [];
  if (raw.includes(S.sdrId)) leaks.push('internal SDR user id');
  if (raw.includes('@telestar.vn')) leaks.push('internal telestar.vn email');
  for (const rep of snap.reps ?? []) {
    if (rep.repId) leaks.push(`rep row exposes internal repId ${rep.repId}`);
  }
  for (const m of snap.meetings ?? []) {
    if (m.id) leaks.push(`meeting row exposes internal id ${m.id}`);
  }
  note(LANE, `E-12 client-facing leaks = ${JSON.stringify([...new Set(leaks)])}`);

  // (7) Internal jargon a client would not recognise.
  const jargon = ['ICP', 'SDR', 'cadence', 'omnichannel', 'warmup', 'touchpoint', 'handoff', 'posture'];
  const found = jargon.filter((j) => raw.toLowerCase().includes(j.toLowerCase()));
  note(LANE, `E-12 jargon present in the client-facing payload = ${JSON.stringify(found)}`);

  // (8) Internal audience mode must not anonymise; client mode must.
  const p = period();
  const internal = await postJson(page, '/api/client-reports/preview', {
    clientId: S.clientId,
    campaignId: S.campaignId,
    ...p,
    audience: 'internal',
    sdrDisplayMode: 'full_name',
  });
  dump('e12-internal-snapshot', internal.body);
  note(
    LANE,
    `E-12 client-mode rep names = ${JSON.stringify((snap.reps ?? []).map((r: any) => r.displayName))}; ` +
      `internal-mode = ${JSON.stringify((internal.body?.snapshot?.reps ?? []).map((r: any) => r.displayName))}`
  );

  rec.flush('E-12-report-integrity');
});

test('E-13 draft → approve/freeze → share link, viewed while authenticated', async ({ page }) => {
  test.setTimeout(420_000);
  const rec = attachRecorders(page, LANE);
  await login(page, DIRECTOR);
  await ensureIds(page);
  const p = period();

  const created = await postJson(page, '/api/client-reports', {
    clientId: S.clientId,
    campaignId: S.campaignId,
    title: `${CLIENT_NAME} — ${CAMPAIGN_NAME} (Weekly Performance Report)`,
    periodType: 'weekly',
    ...p,
    audience: 'client',
    sdrDisplayMode: 'first_last_initial',
  });
  dump('e13-report-create', created);
  expect(created.status, `report create failed: ${created.text.slice(0, 500)}`).toBeLessThan(300);
  S.reportId = created.body.report.id;
  expect(created.body.report.status, 'a fresh report must be a draft').toBe('draft');

  await gotoTimed(page, `/client-reports/${S.reportId}`, rec);
  await page.waitForTimeout(2500);
  await shot(page, LANE, 'e13-report-detail-draft');

  // Draft badge must be honest.
  await expect(page.getByText(/Draft Preview/i).first()).toBeVisible({ timeout: 15000 });

  // Approve + freeze via the UI.
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /Approve & Freeze/i }).click();
  await page.waitForTimeout(3000);
  await shot(page, LANE, 'e13-report-approved');
  const approved = await getJson(page, `/api/client-reports/${S.reportId}`);
  dump('e13-report-after-approve', approved.body);
  const rep = approved.body?.report ?? approved.body;
  note(LANE, `E-13 status after approve = ${rep.status}, approvedAt = ${rep.approvedAt}`);
  expect(rep.status).toBe('approved');

  // Editing must now be blocked.
  const editAttempt = await page.request.patch(`/api/client-reports/${S.reportId}`, {
    data: { summary: 'QA Lane E — frozen-report edit probe' },
  });
  note(LANE, `E-13 PATCH on a frozen report → ${editAttempt.status()}`);

  // Share link.
  const share = await postJson(page, `/api/client-reports/${S.reportId}/share`, {});
  dump('e13-share', share);
  expect(share.status, `share failed: ${share.text.slice(0, 300)}`).toBeLessThan(300);
  S.shareToken = share.body.token;
  S.shareUrl = share.body.shareUrl;
  note(LANE, `E-13 share url = ${S.shareUrl}`);

  // Open the share link while logged in.
  await gotoTimed(page, `/client-reports/public/${S.shareToken}`, rec);
  await page.waitForTimeout(3000);
  await shot(page, LANE, 'e13-share-link-authenticated');
  note(LANE, `E-13 share page final url (authenticated) = ${page.url()}`);
  const bodyText = (await page.locator('body').innerText()).slice(0, 6000);
  fs.writeFileSync(path.join(laneDir(LANE, 'data'), 'e13-share-page-text.txt'), bodyText);

  // What does the public API hand back?
  const publicApi = await getJson(page, `/api/client-reports/public/${S.shareToken}`);
  dump('e13-public-api', publicApi.body);
  note(LANE, `E-13 public API status = ${publicApi.status}`);
  const publicRaw = JSON.stringify(publicApi.body);
  note(LANE, `E-13 public payload leaks internal ids = ${publicRaw.includes(S.sdrId)}`);
  note(LANE, `E-13 public payload contains telestar.vn = ${publicRaw.includes('@telestar.vn')}`);
  note(LANE, `E-13 public payload contains generatedById = ${publicRaw.includes('generatedById')}`);

  // Does the share status flip to "shared"?
  const afterShare = await getJson(page, `/api/client-reports/${S.reportId}`);
  const rep2 = afterShare.body?.report ?? afterShare.body;
  note(LANE, `E-13 report status after creating a share link = ${rep2.status}, sharedAt = ${rep2.sharedAt}`);

  rec.flush('E-13-approve-and-share');
});

test('E-14 CSV and "PDF" exports', async ({ page }) => {
  test.setTimeout(420_000);
  const rec = attachRecorders(page, LANE);
  await login(page, DIRECTOR);
  await ensureIds(page);

  const csv = await page.request.get(`/api/client-reports/${S.reportId}/export/csv`);
  const csvText = await csv.text();
  fs.writeFileSync(path.join(laneDir(LANE, 'data'), 'e14-export.csv'), csvText);
  note(LANE, `E-14 CSV → ${csv.status()} content-type=${csv.headers()['content-type']} disposition=${csv.headers()['content-disposition']}`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()['content-type']).toContain('text/csv');

  const pdf = await page.request.get(`/api/client-reports/${S.reportId}/export/pdf`);
  const pdfBody = await pdf.text();
  fs.writeFileSync(path.join(laneDir(LANE, 'data'), 'e14-export-pdf-response.html'), pdfBody);
  note(LANE, `E-14 "PDF" → ${pdf.status()} content-type=${pdf.headers()['content-type']} disposition=${pdf.headers()['content-disposition'] ?? '(none)'}`);
  note(LANE, `E-14 "PDF" body starts with = ${JSON.stringify(pdfBody.slice(0, 40))}`);
  note(LANE, `E-14 "PDF" claims status text = ${/Status:\s*Approved/.test(pdfBody) ? 'Status: Approved (hardcoded)' : 'not found'}`);
  expect(pdf.status()).toBe(200);

  // Ownership check: a plain SDR who owns none of this should not be able to export.
  await logout(page);
  await login(page, SDR);
  const sdrCsv = await page.request.get(`/api/client-reports/${S.reportId}/export/csv`);
  const sdrPdf = await page.request.get(`/api/client-reports/${S.reportId}/export/pdf`);
  const sdrDetail = await getJson(page, `/api/client-reports/${S.reportId}`);
  note(LANE, `E-14 SDR CSV export → ${sdrCsv.status()}`);
  note(LANE, `E-14 SDR PDF export → ${sdrPdf.status()}`);
  note(LANE, `E-14 SDR report detail → ${sdrDetail.status}`);
  dump('e14-sdr-export-access', {
    csv: sdrCsv.status(),
    pdf: sdrPdf.status(),
    detail: sdrDetail.status,
    csvSample: (await sdrCsv.text()).slice(0, 400),
  });

  rec.flush('E-14-exports');
});

test('E-15 a DRAFT report exports as "Status: Approved"', async ({ page }) => {
  test.setTimeout(420_000);
  const rec = attachRecorders(page, LANE);
  await login(page, DIRECTOR);
  await ensureIds(page);
  const p = period();

  const draft = await postJson(page, '/api/client-reports', {
    clientId: S.clientId,
    campaignId: S.campaignId,
    title: 'QA Lane E — DRAFT export honesty probe',
    periodType: 'weekly',
    ...p,
    audience: 'client',
    sdrDisplayMode: 'first_last_initial',
  });
  expect(draft.status).toBeLessThan(300);
  const draftId = draft.body.report.id;
  note(LANE, `E-15 draft report status = ${draft.body.report.status}`);

  const pdf = await page.request.get(`/api/client-reports/${draftId}/export/pdf`);
  const html = await pdf.text();
  fs.writeFileSync(path.join(laneDir(LANE, 'data'), 'e15-draft-export.html'), html);
  const claimsApproved = /Status:\s*Approved/.test(html);
  note(LANE, `E-15 DRAFT export claims "Status: Approved" = ${claimsApproved}`);
  note(LANE, `E-15 DRAFT export content-type = ${pdf.headers()['content-type']}`);
  dump('e15-draft-export', { reportId: draftId, status: draft.body.report.status, claimsApproved });
  // CONFIRMED DEFECT (CRM-E-006): exporters.ts:272 hardcodes the status line, so an
  // unapproved draft exports to the client as "Status: Approved". Asserted as-is so
  // this spec fails the day it is fixed and the finding can be closed.
  expect(draft.body.report.status).toBe('draft');
  expect(claimsApproved, 'BUG: draft exports claim approved status').toBe(true);

  rec.flush('E-15-draft-export-honesty');
});
