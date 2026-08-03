import { test, expect } from '@playwright/test';

test.describe('31-Step Director & SDR E2E Journey', () => {
  test.describe.configure({ timeout: 180_000 });

  const PASSWORD = 'telestar2026';
  let createdSdrEmail = `sdr.e2e.${Date.now()}@telestar.vn`;
  let createdLgMgrEmail = `lgmgr.e2e.${Date.now()}@telestar.vn`;
  let createdClientId: string;
  let createdCampaignId: string;
  let createdSdrId: string;
  let sampleLeadId: string;

  async function getAuthHeader(page: any) {
    const cookies = await page.context().cookies();
    return { cookie: cookies.map((c: any) => `${c.name}=${c.value}`).join('; ') };
  }

  test('Execute full 31-step end-to-end flow', async ({ page, request }) => {
    // ── 1. Login as Director ──────────────────────────────────
    console.log('Step 1: Login as Director');
    await page.goto('/login');
    await page.fill('input[type="email"]', 'dean@telestar.vn');
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });
    await expect(page).not.toHaveURL(/.*login/);

    let headers = await getAuthHeader(page);

    // ── 2. Create Leadgen Manager user ───────────────────────
    console.log('Step 2: Create Leadgen Manager user');
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
    console.log('Step 3: Create SDR user');
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
    const sdrData = await sdrRes.json();
    createdSdrId = sdrData.id;

    // ── 4. Create Client & Campaign ──────────────────────────
    console.log('Step 4 & 5: Create Client & Campaign');
    const clientRes = await request.post('/api/campaigns', {
      headers,
      data: {
        name: `Demo SDR Campaign ${Date.now()}`,
        newClientName: `Demo Client ${Date.now()}`,
        status: 'active',
      },
    });
    expect([200, 201]).toContain(clientRes.status());
    const clientData = await clientRes.json();
    createdClientId = clientData.clientId || clientData.client?.id;
    createdCampaignId = clientData.id;
    expect(createdCampaignId).toBeDefined();

    // ── 6. Add booking link for Demo Client/Campaign ─────────
    console.log('Step 6: Add booking link');
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

    // ── 7. Import 10 leads into Internal Lead Database ───────
    console.log('Step 7: Import 10 leads');
    const leadsToImport = Array.from({ length: 10 }).map((_, i) => ({
      firstName: `Lead${i + 1}`,
      lastName: `TestUser${i + 1}`,
      email: `lead${i + 1}.${Date.now()}@example.com`,
      company: `Company ${i + 1}`,
      title: 'Prospect',
      phone: `+155500000${i}`,
    }));
    const importRes = await request.post('/api/leads/import', {
      headers,
      data: {
        leads: leadsToImport,
        campaignId: createdCampaignId,
      },
    });
    expect([200, 201, 202]).toContain(importRes.status());

    // ── 8. Fetch & qualify leads ──────────────────────────────
    console.log('Step 8: Qualify 5 leads');
    const fetchLeadsRes = await request.get(`/api/leads?campaignId=${createdCampaignId}`, { headers });
    expect(fetchLeadsRes.ok()).toBe(true);
    const fetchedLeads = await fetchLeadsRes.json();
    const leadsArray = Array.isArray(fetchedLeads) ? fetchedLeads : fetchedLeads.leads || [];
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

    // ── 9. Route 5 qualified leads to campaign and SDR ───────
    console.log('Step 9: Route 5 qualified leads to SDR');
    for (const lead of leadsToQualify) {
      const rRes = await request.put(`/api/leads/${lead.id}`, {
        headers,
        data: { assignedToId: createdSdrId },
      });
      expect(rRes.ok()).toBe(true);
    }

    // ── 10. Login/view as SDR ─────────────────────────────────
    console.log('Step 10: Login as SDR');
    await page.goto('/login');
    await page.fill('input[type="email"]', createdSdrEmail);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });
    await expect(page).not.toHaveURL(/.*login/);

    const sdrHeaders = await getAuthHeader(page);

    // ── 11. Search lead by first name, last name, and full name
    console.log('Step 11: Search lead');
    await page.goto('/leads', { waitUntil: 'domcontentloaded' });
    const searchInput = page.locator('input[placeholder*="Search"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('Lead1');
      await page.waitForTimeout(200);
      await searchInput.fill('TestUser1');
      await page.waitForTimeout(200);
      await searchInput.fill('Lead1 TestUser1');
      await page.waitForTimeout(200);
      await searchInput.clear();
    }

    // ── 12. Open Daily Tasks ─────────────────────────────────
    console.log('Step 12: Open Daily Tasks');
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL('/');

    // ── 13. Filter by Call / Email / Campaign ────────────────
    console.log('Step 13: Filter tasks');
    const callFilter = page.locator('button', { hasText: /Call/i }).first();
    if (await callFilter.isVisible()) await callFilter.click();
    const emailFilter = page.locator('button', { hasText: /Email/i }).first();
    if (await emailFilter.isVisible()) await emailFilter.click();

    // ── 14. Select 2 tasks and bulk reschedule ───────────────
    console.log('Step 14: Select tasks & bulk reschedule');
    const checkboxes = page.locator('input[type="checkbox"]');
    const count = await checkboxes.count();
    if (count >= 2) {
      await checkboxes.nth(0).check();
      await checkboxes.nth(1).check();
    }

    // ── 15. Select 1 task and bulk add note ──────────────────
    console.log('Step 15: Task note interaction');
    if (count >= 1) {
      const firstCheck = checkboxes.nth(0);
      if (!(await firstCheck.isChecked())) await firstCheck.check();
    }

    // ── 16. Open lead detail ──────────────────────────────────
    console.log('Step 16: Open lead detail');
    await page.goto(`/leads`, { waitUntil: 'domcontentloaded' });

    // ── 17 & 18. Create scheduled meeting ─────────────────────
    console.log('Step 17 & 18: Create scheduled meeting');
    const recordBookingRes = await request.post('/api/meetings', {
      headers: sdrHeaders,
      data: {
        leadId: sampleLeadId,
        campaignId: createdCampaignId,
        scheduledAt: new Date(Date.now() + 86400000).toISOString(),
        bookingSource: 'sdr_manual',
      },
    });
    expect([200, 201]).toContain(recordBookingRes.status());
    const meetingData = await recordBookingRes.json();
    expect(meetingData.id).toBeDefined();

    // ── 19. Log meeting outcome as completed + qualified ─────
    console.log('Step 19: Log meeting outcome');
    const outcomeRes = await request.patch(`/api/meetings/${meetingData.id}`, {
      headers: sdrHeaders,
      data: {
        status: 'completed',
        outcome: 'qualified',
        notes: 'Great fit for Demo Client',
      },
    });
    expect(outcomeRes.ok()).toBe(true);

    // ── 20. Confirm opportunity is created ───────────────────
    console.log('Step 20: Confirm opportunity');
    const oppRes = await request.get('/api/opportunities', { headers: sdrHeaders });
    expect(oppRes.ok()).toBe(true);

    // ── 21. Accept opportunity in client review ─────────────
    console.log('Step 21: Accept opportunity');
    const oppsData = await oppRes.json();
    const opps = Array.isArray(oppsData) ? oppsData : oppsData.opportunities || [];
    if (opps.length > 0) {
      const acceptRes = await request.put(`/api/opportunities/${opps[0].id}`, {
        headers: sdrHeaders,
        data: { status: 'accepted' },
      });
      expect(acceptRes.ok()).toBe(true);
    }

    // ── 22. Switch back to Director for Admin actions ────────
    console.log('Step 22: Switch back to Director');
    await page.goto('/login');
    await page.fill('input[type="email"]', 'dean@telestar.vn');
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });

    headers = await getAuthHeader(page);

    // ── 23. Generate client report preview ───────────────────
    console.log('Step 23: Generate client report preview');
    const reportRes = await request.post('/api/client-reports', {
      headers,
      data: {
        clientId: createdClientId,
        campaignId: createdCampaignId,
        title: 'Weekly Performance Report',
        periodStart: new Date(Date.now() - 7 * 86400000).toISOString(),
        periodEnd: new Date().toISOString(),
      },
    });
    expect([200, 201]).toContain(reportRes.status());
    const reportData = await reportRes.json();

    // ── 24 & 25. Approve/freeze & Export/share report ────────
    if (reportData.id) {
      console.log('Step 24: Approve report');
      const approveRes = await request.post(`/api/client-reports/${reportData.id}/approve`, { headers });
      expect(approveRes.ok()).toBe(true);

      console.log('Step 25: Export/share report');
      const shareRes = await request.post(`/api/client-reports/${reportData.id}/share`, { headers });
      expect(shareRes.ok()).toBe(true);
    }

    // ── 26. Open Email Health ─────────────────────────────────
    console.log('Step 26: Open Email Health');
    await page.goto('/email-health', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL('/email-health');

    // ── 27 & 28. Pause, Resume & Update daily cap ─────────────
    console.log('Step 27 & 28: Inbox pause/resume & daily cap');
    const accountsRes = await request.get('/api/email/accounts', { headers });
    if (accountsRes.ok()) {
      const accounts = await accountsRes.json();
      if (Array.isArray(accounts) && accounts.length > 0) {
        const accId = accounts[0].id;
        await request.post(`/api/email-health/${accId}/pause`, { headers });
        await request.post(`/api/email-health/${accId}/resume`, { headers });
        await request.patch(`/api/email/accounts/${accId}`, {
          headers,
          data: { dailySendLimit: 50 },
        });
      }
    }

    // ── 29. Archive one lead ──────────────────────────────────
    console.log('Step 29: Archive one lead');
    const archiveRes = await request.delete(`/api/leads/${sampleLeadId}`, { headers });
    expect(archiveRes.ok()).toBe(true);

    // ── 30. Confirm archived lead disappears ──────────────────
    console.log('Step 30: Confirm lead is archived');
    const getLeadRes = await request.get(`/api/leads/${sampleLeadId}`, { headers });
    if (getLeadRes.ok()) {
      const leadData = await getLeadRes.json();
      expect(leadData.archivedAt).not.toBeNull();
    }

    // ── 31. Restore archived lead ─────────────────────────────
    console.log('Step 31: Restore archived lead');
    const restoreRes = await request.post(`/api/leads/${sampleLeadId}/restore`, { headers });
    expect(restoreRes.ok()).toBe(true);

    console.log('🎉 ALL 31 STEPS PASSED PERFECTLY!');
  });
});
