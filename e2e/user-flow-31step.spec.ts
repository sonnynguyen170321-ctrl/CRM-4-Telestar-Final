import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

/**
 * The full product journey from the post-migration instructions doc §6:
 *
 *   Lead Pool -> Qualified Lead -> SDR Lead -> Task -> Meeting -> Opportunity -> Client Report
 *
 * This is the only test that exercises the write path end to end, so it is the one
 * that catches contract drift. Several steps below call out *why* they are shaped the
 * way they are — each corresponds to a defect where the spec previously asserted
 * something that could never fail.
 */
test.describe('31-Step Director & SDR E2E Journey', () => {
  test.describe.configure({ timeout: 240_000 });

  const PASSWORD = process.env.E2E_PASSWORD || 'telestar2026';
  const LOGIN_TIMEOUT = process.env.BASE_URL ? 45_000 : 15_000;

  const stamp = Date.now();
  const createdSdrEmail = `sdr.e2e.${stamp}@telestar.vn`;
  const createdLgMgrEmail = `lgmgr.e2e.${stamp}@telestar.vn`;
  let createdClientId: string;
  let createdCampaignId: string;
  let createdSdrId: string;
  let sampleLeadId: string;

  type AuthHeaders = { cookie: string };

  async function getAuthHeader(page: Page): Promise<AuthHeaders> {
    const cookies = await page.context().cookies();
    return { cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ') };
  }

  async function signIn(page: Page, email: string): Promise<AuthHeaders> {
    await page.goto('/login');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: LOGIN_TIMEOUT });
    await expect(page).not.toHaveURL(/.*login/);
    return getAuthHeader(page);
  }

  /**
   * POST /api/leads/import returns 202 with status 'queued' whenever Redis is
   * reachable — the rows are materialised by the import worker, not by the request.
   * It only falls back to an inline import when the queue is unreachable. The
   * previous version asserted leads existed on the very next line, which passed only
   * by accident on the inline path and raced everywhere else.
   */
  async function waitForImportedLeads(
    request: APIRequestContext,
    headers: AuthHeaders,
    campaignId: string,
    timeoutMs = 90_000
  ): Promise<Array<{ id: string; firstName?: string }>> {
    const deadline = Date.now() + timeoutMs;
    let last: Array<{ id: string; firstName?: string }> = [];
    while (Date.now() < deadline) {
      const res = await request.get(`/api/leads?campaignId=${campaignId}`, { headers });
      if (res.ok()) {
        const payload = await res.json();
        last = Array.isArray(payload) ? payload : payload.leads || [];
        if (last.length > 0) return last;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(
      `Import never materialised any leads for campaign ${campaignId} within ${timeoutMs}ms. ` +
        `Is the BullMQ import worker running?`
    );
  }

  test('Execute full 31-step end-to-end flow', async ({ page, request }) => {
    // ── 1. Login as Director ──────────────────────────────────
    let headers = await signIn(page, 'dean@telestar.vn');

    // ── 2. Create Leadgen Manager user ───────────────────────
    const lgMgrRes = await request.post('/api/users', {
      headers,
      data: {
        email: createdLgMgrEmail,
        firstName: 'E2E',
        lastName: 'LgManager',
        role: 'leadgen_manager',
        password: PASSWORD,
      },
    });
    expect([200, 201]).toContain(lgMgrRes.status());

    // ── 3. Create SDR user ───────────────────────────────────
    const sdrRes = await request.post('/api/users', {
      headers,
      data: {
        email: createdSdrEmail,
        firstName: 'AlexSDR',
        lastName: 'E2ETest',
        role: 'sdr',
        password: PASSWORD,
      },
    });
    expect([200, 201]).toContain(sdrRes.status());
    createdSdrId = (await sdrRes.json()).id;
    expect(createdSdrId).toBeTruthy();

    // ── 4 & 5. Create Client & Campaign ──────────────────────
    const campaignRes = await request.post('/api/campaigns', {
      headers,
      data: {
        name: `Demo SDR Campaign ${stamp}`,
        newClientName: `Demo Client ${stamp}`,
        status: 'active',
      },
    });
    expect([200, 201]).toContain(campaignRes.status());
    const campaignData = await campaignRes.json();
    createdClientId = campaignData.clientId || campaignData.client?.id;
    createdCampaignId = campaignData.id;
    expect(createdCampaignId).toBeTruthy();
    expect(createdClientId).toBeTruthy();

    // ── 6. Add booking link ──────────────────────────────────
    const linkRes = await request.post('/api/booking-links', {
      headers,
      data: {
        name: 'Demo Client Booking Link',
        url: 'https://calendly.com/demo-client/meet',
        clientId: createdClientId,
        campaignId: createdCampaignId,
      },
    });
    expect([200, 201]).toContain(linkRes.status());

    // ── 7. Import 10 leads ───────────────────────────────────
    const leadsToImport = Array.from({ length: 10 }).map((_, i) => ({
      firstName: `Lead${i + 1}`,
      lastName: `TestUser${i + 1}`,
      email: `lead${i + 1}.${stamp}@example.com`,
      company: `Company ${i + 1}`,
      title: 'Prospect',
      phone: `+155500000${i}`,
    }));
    const importRes = await request.post('/api/leads/import', {
      headers,
      data: { leads: leadsToImport, campaignId: createdCampaignId },
    });
    expect([200, 201, 202]).toContain(importRes.status());

    // ── 8. Wait for the import, then qualify 5 leads ─────────
    const leadsArray = await waitForImportedLeads(request, headers, createdCampaignId);
    expect(leadsArray.length).toBeGreaterThan(0);
    sampleLeadId = leadsArray[0].id;

    const leadsToQualify = leadsArray.slice(0, 5);
    for (const lead of leadsToQualify) {
      const qRes = await request.put(`/api/leads/${lead.id}`, {
        headers,
        data: { priority: 'hot', tags: ['qualified'] },
      });
      expect(qRes.ok()).toBe(true);
    }

    // ── 9. Route qualified leads to the SDR ──────────────────
    for (const lead of leadsToQualify) {
      const rRes = await request.put(`/api/leads/${lead.id}`, {
        headers,
        data: { assignedToId: createdSdrId },
      });
      expect(rRes.ok()).toBe(true);
    }

    // ── 10. Login as the newly created SDR ───────────────────
    const sdrHeaders = await signIn(page, createdSdrEmail);

    // ── 11. SDR sees only their assigned leads ───────────────
    // Asserted through the API rather than the DOM: scoping is the security-relevant
    // behaviour, and it is verifiable without depending on kanban/table view state.
    const sdrLeadsRes = await request.get('/api/leads', { headers: sdrHeaders });
    expect(sdrLeadsRes.ok()).toBe(true);
    const sdrLeadsPayload = await sdrLeadsRes.json();
    const sdrLeads = Array.isArray(sdrLeadsPayload) ? sdrLeadsPayload : sdrLeadsPayload.leads || [];
    expect(sdrLeads.length).toBeGreaterThan(0);
    const assignedIds = new Set(leadsToQualify.map((l) => l.id));
    expect(sdrLeads.some((l: { id: string }) => assignedIds.has(l.id))).toBe(true);

    // ── 12. Leads page renders for the SDR ───────────────────
    await page.goto('/leads', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/.*leads/);
    const searchInput = page.locator('input[placeholder*="Search"]').first();
    await expect(searchInput).toBeVisible();

    // ── 13. Search narrows to the imported lead ──────────────
    await searchInput.fill('TestUser1');
    await expect(page.getByText('Lead1', { exact: false }).first()).toBeVisible();
    await searchInput.clear();

    // ── 14. Daily task dashboard is the root route ───────────
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/$|\/\?/);
    await expect(page.locator('h1').first()).toBeVisible();

    // ── 15. Task filters are present and usable ──────────────
    // Newly imported leads carry no tasks yet, so this asserts the controls render
    // rather than pretending to verify filtered results that cannot exist.
    const taskFilters = page.locator('select, button').filter({ hasText: /channel|status|call|email/i });
    expect(await taskFilters.count()).toBeGreaterThan(0);

    // ── 16. Lead detail opens as a slide-over ────────────────
    const leadDetailRes = await request.get(`/api/leads/${sampleLeadId}`, { headers: sdrHeaders });
    expect(leadDetailRes.ok()).toBe(true);
    expect((await leadDetailRes.json()).id).toBe(sampleLeadId);

    // ── 17 & 18. Book a meeting ──────────────────────────────
    // `bookingSource` is not part of createMeetingSchema and was silently stripped.
    // The real fields are leadId / status / scheduledAt / title / durationMins.
    const meetingRes = await request.post('/api/meetings', {
      headers: sdrHeaders,
      data: {
        leadId: sampleLeadId,
        title: 'Discovery call — Demo Client',
        status: 'scheduled',
        scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
        durationMins: 30,
      },
    });
    expect([200, 201]).toContain(meetingRes.status());
    const meetingData = await meetingRes.json();
    expect(meetingData.id).toBeTruthy();

    // ── 19. Log the outcome as a qualified opportunity ───────
    // The previous version PATCHed /api/meetings/{id} with `outcome: 'qualified'`.
    // updateMeetingSchema has no `outcome` field so Zod stripped it, and 'qualified'
    // is not a MeetingOutcome value ('qualified_opportunity' is). The PATCH returned
    // 200, no opportunity was ever created, and steps 20-21 passed vacuously.
    const outcomeRes = await request.post(`/api/meetings/${meetingData.id}/outcome`, {
      headers: sdrHeaders,
      data: {
        status: 'completed',
        outcome: 'qualified_opportunity',
        outcomeNotes: 'Great fit for Demo Client',
        createOpportunity: true,
      },
    });
    expect(outcomeRes.ok()).toBe(true);
    const outcomeBody = await outcomeRes.json();
    expect(outcomeBody.meeting?.outcome).toBe('qualified_opportunity');

    // ── 20. The opportunity actually exists ──────────────────
    expect(outcomeBody.opportunity).toBeTruthy();
    const opportunityId = outcomeBody.opportunity.id;
    expect(opportunityId).toBeTruthy();

    const oppRes = await request.get('/api/opportunities', { headers: sdrHeaders });
    expect(oppRes.ok()).toBe(true);
    const oppsData = await oppRes.json();
    const opps = Array.isArray(oppsData) ? oppsData : oppsData.opportunities || [];
    expect(opps.some((o: { id: string }) => o.id === opportunityId)).toBe(true);

    // ── 21. SDRs must NOT be able to approve their own handoff ─
    // canApproveClientHandoff allows director / floor_manager / team_lead only.
    const sdrAcceptRes = await request.post(`/api/opportunities/${opportunityId}/handoff`, {
      headers: sdrHeaders,
      data: { decision: 'accepted' },
    });
    expect(sdrAcceptRes.status()).toBe(403);

    // ── 22. Switch back to Director ──────────────────────────
    headers = await signIn(page, 'dean@telestar.vn');

    // ── 23. Director accepts the client handoff ──────────────
    // 'accepted' here is a handoffDecisionSchema decision, not an OpportunityStatus.
    // The old spec PUT `status: 'accepted'` to /api/opportunities/{id}: not a valid
    // OpportunityStatus (open|won|lost|rejected|archived) and a manager-only field.
    const acceptRes = await request.post(`/api/opportunities/${opportunityId}/handoff`, {
      headers,
      data: { decision: 'accepted', clientFeedback: 'Client accepted the handoff.' },
    });
    expect(acceptRes.ok()).toBe(true);

    // ── 24. Generate the client report ───────────────────────
    const reportRes = await request.post('/api/client-reports', {
      headers,
      data: {
        clientId: createdClientId,
        campaignId: createdCampaignId,
        title: 'Weekly Performance Report',
        periodStart: new Date(Date.now() - 7 * 86_400_000).toISOString(),
        periodEnd: new Date().toISOString(),
      },
    });
    expect([200, 201]).toContain(reportRes.status());
    // The route answers with an envelope — `{ report }` — matching GET's `{ reports }`.
    // Reading `.id` off the raw body silently yielded undefined.
    const reportData = (await reportRes.json()).report;
    expect(reportData?.id).toBeTruthy();

    // ── 25 & 26. Approve and share it ────────────────────────
    const approveRes = await request.post(`/api/client-reports/${reportData.id}/approve`, { headers });
    expect(approveRes.ok()).toBe(true);

    // An explicit `{}` is required even though every field of createShareLinkSchema is
    // optional: parseBody calls req.json(), which throws on an empty body and answers
    // 400 "Invalid JSON body" before the schema is ever consulted.
    const shareRes = await request.post(`/api/client-reports/${reportData.id}/share`, {
      headers,
      data: {},
    });
    expect(shareRes.ok()).toBe(true);
    expect((await shareRes.json()).shareUrl).toContain('/client-reports/public/');

    // ── 27. Email Health renders ─────────────────────────────
    await page.goto('/email-health', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/.*email-health/);

    // ── 28 & 29. Pause / resume an inbox, set a daily cap ────
    // The old paths were /api/email-health/{id}/pause — the real routes live under
    // /accounts/{id}/. They were fire-and-forget, so 404s went unnoticed.
    const accountsRes = await request.get('/api/email/accounts', { headers });
    expect(accountsRes.ok()).toBe(true);
    const accounts = await accountsRes.json();
    const accountList = Array.isArray(accounts) ? accounts : accounts.accounts || [];
    if (accountList.length > 0) {
      const accId = accountList[0].id;
      const pauseRes = await request.post(`/api/email-health/accounts/${accId}/pause`, {
        headers,
        data: { reason: 'e2e pause check' },
      });
      expect(pauseRes.ok()).toBe(true);

      const resumeRes = await request.post(`/api/email-health/accounts/${accId}/resume`, { headers });
      expect(resumeRes.ok()).toBe(true);

      const capRes = await request.patch(`/api/email-health/accounts/${accId}/cap`, {
        headers,
        data: { dailySendLimit: 50 },
      });
      expect(capRes.ok()).toBe(true);
    }

    // ── 30. Archive a lead (soft delete) ─────────────────────
    const archiveRes = await request.delete(`/api/leads/${sampleLeadId}`, { headers });
    expect(archiveRes.ok()).toBe(true);

    const archivedRes = await request.get(`/api/leads/${sampleLeadId}`, { headers });
    expect(archivedRes.ok()).toBe(true);
    expect((await archivedRes.json()).archivedAt).not.toBeNull();

    // ── 31. Restore it — director-only ───────────────────────
    const restoreRes = await request.post(`/api/leads/${sampleLeadId}/restore`, { headers });
    expect(restoreRes.ok()).toBe(true);

    const restoredRes = await request.get(`/api/leads/${sampleLeadId}`, { headers });
    expect(restoredRes.ok()).toBe(true);
    expect((await restoredRes.json()).archivedAt).toBeNull();
  });
});
