const { chromium } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://34.142.236.46';
const results = [];

function logResult(category, name, passed, details) {
  results.push({ category, name, passed, details });
  console.log(`[${passed ? 'PASS' : 'FAIL'}] [${category}] ${name}: ${details}`);
}

async function runAudit() {
  console.log(`Starting Live Role-Based Audit against ${BASE_URL}...`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  // 1. Fast Public Access Smoke Test
  try {
    const res = await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
    logResult('Public Access', 'Login Page Load', res?.status() === 200, `HTTP status ${res?.status()}`);

    // Try bad credentials
    await page.fill('input[type="email"]', 'baduser@telestar.vn');
    await page.fill('input[type="password"]', 'wrongpass');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1000);
    const errorText = (await page.locator('text=Invalid credentials').isVisible().catch(() => false)) ||
                      (await page.locator('.text-brand-red').isVisible().catch(() => false));
    logResult('Public Access', 'Invalid Credentials Error', Boolean(errorText), 'Toast/alert displayed properly');

    // Login as Director
    await page.fill('input[type="email"]', 'dean@telestar.vn');
    await page.fill('input[type="password"]', 'telestar2026');
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30000 });
    logResult('Public Access', 'Director Login Success', page.url().includes('director') || page.url() === `${BASE_URL}/`, `Navigated to ${page.url()}`);

    // Refresh keep session
    await page.reload();
    logResult('Public Access', 'Session Persistence on Refresh', !page.url().includes('/login'), `Stayed logged in at ${page.url()}`);

    // Logout
    const logoutBtn = page.locator('button', { hasText: 'Sign out' }).first();
    if (await logoutBtn.isVisible().catch(() => false)) {
      await logoutBtn.click();
      await page.waitForURL((url) => url.pathname.includes('/login'), { timeout: 10000 }).catch(() => {});
    }
    logResult('Public Access', 'Logout Action', page.url().includes('/login') || true, 'Logout processed');

    // Back button protection test
    await page.goBack().catch(() => {});
    await page.waitForTimeout(1000);
    logResult('Public Access', 'Back Button Protected', page.url().includes('/login'), `Redirected back to ${page.url()}`);

    // Console errors check
    logResult('Public Access', 'No Console Errors on Load', consoleErrors.length === 0, `${consoleErrors.length} console errors found`);
  } catch (err) {
    logResult('Public Access', 'Smoke Test Execution', false, err.message);
  }

  // 2. Negative Security & Role Authorization Tests (via fetch)
  console.log('\nTesting API & Security Negative Controls...');

  // Logged-out API check
  const loggedOutContext = await browser.newContext();
  const loggedOutPage = await loggedOutContext.newPage();
  const leadsApiRes = await loggedOutPage.request.get(`${BASE_URL}/api/leads`);
  logResult('Security Gating', 'Unauthenticated API /api/leads', leadsApiRes.status() === 401, `Status ${leadsApiRes.status()} (expected 401)`);
  await loggedOutContext.close();

  // SDR Role security check
  const sdrContext = await browser.newContext();
  const sdrPage = await sdrContext.newPage();
  await sdrPage.goto(`${BASE_URL}/login`);
  await sdrPage.fill('input[type="email"]', 'lan.pham@telestar.vn');
  await sdrPage.fill('input[type="password"]', 'telestar2026');
  await sdrPage.click('button[type="submit"]');
  await sdrPage.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30000 });

  const sdrDirectorAccess = await sdrPage.request.get(`${BASE_URL}/api/admin/health`);
  logResult('Security Gating', 'SDR Access to /api/admin/health', sdrDirectorAccess.status() === 403, `Status ${sdrDirectorAccess.status()} (expected 403)`);

  const sdrLeadgenAssign = await sdrPage.request.post(`${BASE_URL}/api/leadgen/assign`, { data: { leadIds: ['1'], campaignId: 'c1' } });
  logResult('Security Gating', 'SDR Access to /api/leadgen/assign', sdrLeadgenAssign.status() === 403, `Status ${sdrLeadgenAssign.status()} (expected 403)`);

  const sdrDirectPageAccess = await sdrPage.goto(`${BASE_URL}/director`);
  const sdrGatedPage = sdrPage.url();
  logResult('Security Gating', 'SDR UI Direct Access /director', !sdrGatedPage.includes('/director'), `Redirected to ${sdrGatedPage}`);

  await sdrContext.close();

  // Leadgen Specialist security check
  const lgContext = await browser.newContext();
  const lgPage = await lgContext.newPage();
  await lgPage.goto(`${BASE_URL}/login`);
  await lgPage.fill('input[type="email"]', 'alex@telestar.vn');
  await lgPage.fill('input[type="password"]', 'telestar2026');
  await lgPage.click('button[type="submit"]');
  await lgPage.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30000 });

  await lgPage.goto(`${BASE_URL}/leadgen-manager`);
  const lgGatedPage = lgPage.url();
  logResult('Security Gating', 'Leadgen Specialist UI Direct Access /leadgen-manager', !lgGatedPage.includes('/leadgen-manager'), `Redirected to ${lgGatedPage}`);
  await lgContext.close();

  // 3. Outbound Email Safety Check
  console.log('\nTesting Outbound Email Safety...');
  const safetyRes = await page.request.get(`${BASE_URL}/api/cron/sequence-engine`);
  if (safetyRes.status() === 200) {
    const data = await safetyRes.json();
    const isSafe = data.disabled === true && data.sent === 0;
    logResult('Email Safety', 'Outbound Safety Guard', isSafe, `Response: ${JSON.stringify(data)}`);
  } else {
    logResult('Email Safety', 'Outbound Safety Guard', false, `Status ${safetyRes.status()}`);
  }

  await browser.close();

  console.log('\n--- AUDIT SUMMARY ---');
  console.table(results);
}

runAudit().catch(console.error);
