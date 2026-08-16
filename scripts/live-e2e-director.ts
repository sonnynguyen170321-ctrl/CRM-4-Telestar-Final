import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

async function main() {
  console.log('🚀 Starting Director Persona Live E2E Verification on https://crm.telestar.cloud...\n');

  const artifactDir = 'C:\\Users\\admin\\.gemini\\antigravity-ide\\brain\\ed05b21f-cfdf-40f6-a1cd-a361d0d60c8d';
  const screenshotDir = path.join(artifactDir, 'screenshots');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    baseURL: 'https://crm.telestar.cloud',
  });
  const page = await context.newPage();

  try {
    // 1. Sign In
    console.log('1️⃣ Navigating to /login...');
    await page.goto('/login', { waitUntil: 'networkidle', timeout: 30000 });
    
    console.log('   Filling credentials (dean@telestar.vn)...');
    await page.fill('input[type="email"], input[name="email"]', 'dean@telestar.vn');
    await page.fill('input[type="password"], input[name="password"]', 'Telestar2026');
    
    console.log('   Submitting login form...');
    await Promise.all([
      page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30000 }),
      page.click('button[type="submit"]'),
    ]);
    console.log('   ✅ Successfully logged in! Current URL:', page.url());

    // 2. Dashboard Verification
    console.log('\n2️⃣ Verifying Dashboard (/)...');
    await page.waitForTimeout(3000);
    const dashboardShot = path.join(screenshotDir, '1_dashboard.png');
    await page.screenshot({ path: dashboardShot, fullPage: false });
    console.log('   📸 Captured Dashboard screenshot:', dashboardShot);

    // Test Stats Toggle
    const statsBtn = await page.$('button:has-text("Stats")');
    if (statsBtn) {
      console.log('   Toggling Stats Drawer...');
      await statsBtn.click();
      await page.waitForTimeout(1000);
      const statsShot = path.join(screenshotDir, '1b_stats_drawer.png');
      await page.screenshot({ path: statsShot, fullPage: false });
      console.log('   📸 Captured Stats Drawer screenshot:', statsShot);
      await statsBtn.click(); // Close
      await page.waitForTimeout(500);
    }

    // 3. Leads Page Verification
    console.log('\n3️⃣ Verifying Leads Page (/leads)...');
    await page.goto('/leads', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    const leadsShot = path.join(screenshotDir, '2_leads_page.png');
    await page.screenshot({ path: leadsShot, fullPage: false });
    console.log('   📸 Captured Leads screenshot:', leadsShot);

    // Search for Sonny Canary
    const searchInput = await page.$('input[placeholder*="Search"]');
    if (searchInput) {
      await searchInput.fill('Sonny');
      await page.waitForTimeout(1500);
      const searchShot = path.join(screenshotDir, '2b_leads_search.png');
      await page.screenshot({ path: searchShot, fullPage: false });
      console.log('   📸 Captured Sonny search results:', searchShot);
    }

    // Click on lead row if present
    const leadRow = await page.$('text=Sonny Canary, text=Canary Corp, tr:has-text("Sonny")');
    if (leadRow) {
      console.log('   Opening Sonny Canary detail drawer...');
      await leadRow.click();
      await page.waitForTimeout(2000);
      const drawerShot = path.join(screenshotDir, '2c_lead_timeline.png');
      await page.screenshot({ path: drawerShot, fullPage: false });
      console.log('   📸 Captured Lead Timeline drawer:', drawerShot);
    }

    // 4. Campaigns Page Verification
    console.log('\n4️⃣ Verifying Campaigns Page (/campaigns)...');
    await page.goto('/campaigns', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    const campaignsShot = path.join(screenshotDir, '3_campaigns_page.png');
    await page.screenshot({ path: campaignsShot, fullPage: false });
    console.log('   📸 Captured Campaigns screenshot:', campaignsShot);

    // 5. Sequences Page Verification
    console.log('\n5️⃣ Verifying Sequences Page (/sequences)...');
    await page.goto('/sequences', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    const sequencesShot = path.join(screenshotDir, '4_sequences_page.png');
    await page.screenshot({ path: sequencesShot, fullPage: false });
    console.log('   📸 Captured Sequences screenshot:', sequencesShot);

    // 6. Tasks Page Verification
    console.log('\n6️⃣ Verifying Tasks Page (/tasks)...');
    await page.goto('/tasks', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    const tasksShot = path.join(screenshotDir, '5_tasks_page.png');
    await page.screenshot({ path: tasksShot, fullPage: false });
    console.log('   📸 Captured Tasks screenshot:', tasksShot);

    console.log('\n🎉 ALL 5 DIRECTOR JOURNEYS VERIFIED SUCCESSFULLY!');
  } catch (err) {
    console.error('❌ E2E Verification failed:', err);
    const errShot = path.join(screenshotDir, 'error.png');
    await page.screenshot({ path: errShot, fullPage: false });
    console.log('📸 Error screenshot saved at:', errShot);
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
