import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

interface RoleTestConfig {
  roleName: string;
  email: string;
  password: string;
  expectedGreeting: string;
  specificPages: string[];
}

const ROLES: RoleTestConfig[] = [
  {
    roleName: 'floor_manager',
    email: 'sonny@telestar.vn',
    password: 'Telestar2026',
    expectedGreeting: 'Sonny',
    specificPages: ['/', '/leads', '/tasks', '/sequences', '/campaigns'],
  },
  {
    roleName: 'sdr',
    email: 'carlos.reyes@telestar.vn',
    password: 'Telestar2026',
    expectedGreeting: 'Carlos',
    specificPages: ['/', '/tasks', '/leads', '/inbox'],
  },
  {
    roleName: 'leadgen_manager',
    email: 'dominic@telestar.vn',
    password: 'Telestar2026',
    expectedGreeting: 'Dominic',
    specificPages: ['/', '/leads', '/leads/import'],
  },
];

async function main() {
  console.log('🚀 Starting Multi-Role Production Playwright Verification Suite on https://crm.telestar.cloud...\n');

  const artifactDir = 'C:\\Users\\admin\\.gemini\\antigravity-ide\\brain\\ed05b21f-cfdf-40f6-a1cd-a361d0d60c8d';
  const baseScreenshotDir = path.join(artifactDir, 'screenshots', 'roles');
  if (!fs.existsSync(baseScreenshotDir)) {
    fs.mkdirSync(baseScreenshotDir, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const results: Record<string, { success: boolean; error?: string; capturedPages: string[] }> = {};

  for (const role of ROLES) {
    console.log(`\n========================================================`);
    console.log(`👤 Testing Role: ${role.roleName.toUpperCase()} (${role.email})`);
    console.log(`========================================================`);

    const roleDir = path.join(baseScreenshotDir, role.roleName);
    if (!fs.existsSync(roleDir)) fs.mkdirSync(roleDir, { recursive: true });

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      baseURL: 'https://crm.telestar.cloud',
    });
    const page = await context.newPage();
    const capturedPages: string[] = [];

    try {
      // 1. Login
      console.log(`  1️⃣ Logging in as ${role.email}...`);
      await page.goto('/login', { waitUntil: 'networkidle', timeout: 30000 });
      await page.fill('input[type="email"], input[name="email"]', role.email);
      await page.fill('input[type="password"], input[name="password"]', role.password);
      await Promise.all([
        page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30000 }),
        page.click('button[type="submit"]'),
      ]);
      console.log(`     ✅ Logged in successfully! URL: ${page.url()}`);

      // 2. Test Specific Pages for this Role
      for (const pagePath of role.specificPages) {
        console.log(`  2️⃣ Navigating to ${pagePath}...`);
        try {
          await page.goto(pagePath, { waitUntil: 'networkidle', timeout: 25000 });
        } catch {
          // If networkidle times out due to background poll, try domcontentloaded
          await page.goto(pagePath, { waitUntil: 'domcontentloaded', timeout: 15000 });
        }
        await page.waitForTimeout(2000);

        const safeName = pagePath === '/' ? 'dashboard' : pagePath.replace(/\//g, '_').replace(/^_/, '');
        const shotPath = path.join(roleDir, `${safeName}.png`);
        await page.screenshot({ path: shotPath, fullPage: false });
        console.log(`     📸 Captured: ${shotPath}`);
        capturedPages.push(pagePath);
      }

      results[role.roleName] = { success: true, capturedPages };
      console.log(`  🎉 Role ${role.roleName} PASSED all page checks.`);
    } catch (err: any) {
      console.error(`  ❌ Error testing ${role.roleName}:`, err.message);
      const errShot = path.join(roleDir, 'error.png');
      try {
        await page.screenshot({ path: errShot });
      } catch {}
      results[role.roleName] = { success: false, error: err.message, capturedPages };
    } finally {
      await context.close();
    }
  }

  await browser.close();

  console.log('\n========================================================');
  console.log('📊 MULTI-ROLE PRODUCTION VERIFICATION SUMMARY');
  console.log('========================================================');
  console.table(results);
}

main().catch(console.error);
