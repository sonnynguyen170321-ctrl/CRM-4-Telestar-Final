import { chromium, Browser, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

interface AuditResult {
  role: string;
  name: string;
  route: string;
  status: 'PASS' | 'FAIL';
  httpStatus?: number;
  error?: string;
  loadTimeMs?: number;
}

const BASE_URL = 'https://crm.telestar.cloud';
const ARTIFACT_DIR = 'C:\\Users\\admin\\.gemini\\antigravity-ide\\brain\\ed05b21f-cfdf-40f6-a1cd-a361d0d60c8d';
const SHOT_DIR = path.join(ARTIFACT_DIR, 'screenshots', 'deep_audit_v2');

if (!fs.existsSync(SHOT_DIR)) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
}

const PERSONAS = [
  {
    role: 'director',
    name: 'Dean (Director)',
    email: 'dean@telestar.vn',
    password: 'Telestar2026',
    items: [
      { name: 'Dashboard', route: '/' },
      { name: 'AI Command Center', route: '/ai' },
      { name: 'Leads Pool', route: '/leads' },
      { name: 'Opportunities', route: '/opportunities' },
      { name: 'Meetings', route: '/meetings' },
      { name: 'Sequences', route: '/sequences' },
      { name: 'Inbox', route: '/inbox' },
      { name: 'Templates', route: '/templates' },
      { name: 'Automation Engine', route: '/automation' },
      { name: 'Sequence Performance', route: '/sequences/performance' },
      { name: 'Client Reports', route: '/client-reports' },
      { name: 'Team View', route: '/team' },
      { name: 'Director Suite', route: '/director' },
      { name: 'Admin Console', route: '/admin' },
      { name: 'Email Health & Deliverability', route: '/email-health' },
      { name: 'Settings', route: '/settings' },
    ],
  },
  {
    role: 'floor_manager',
    name: 'Sonny (Floor Manager)',
    email: 'sonny@telestar.vn',
    password: 'Telestar2026',
    items: [
      { name: 'Dashboard', route: '/' },
      { name: 'AI Command Center', route: '/ai' },
      { name: 'Leads Pool', route: '/leads' },
      { name: 'Opportunities', route: '/opportunities' },
      { name: 'Meetings', route: '/meetings' },
      { name: 'Sequences', route: '/sequences' },
      { name: 'Inbox', route: '/inbox' },
      { name: 'Templates', route: '/templates' },
      { name: 'Automation Engine', route: '/automation' },
      { name: 'Sequence Performance', route: '/sequences/performance' },
      { name: 'Client Reports', route: '/client-reports' },
      { name: 'Team View', route: '/team' },
      { name: 'Admin Console', route: '/admin' },
      { name: 'Email Health & Deliverability', route: '/email-health' },
      { name: 'Settings', route: '/settings' },
    ],
  },
  {
    role: 'sdr',
    name: 'Carlos Reyes (SDR)',
    email: 'carlos.reyes@telestar.vn',
    password: 'Telestar2026',
    items: [
      { name: 'Dashboard', route: '/' },
      { name: 'AI Command Center', route: '/ai' },
      { name: 'Leads Pool', route: '/leads' },
      { name: 'Opportunities', route: '/opportunities' },
      { name: 'Meetings', route: '/meetings' },
      { name: 'Sequences', route: '/sequences' },
      { name: 'Inbox', route: '/inbox' },
      { name: 'Templates', route: '/templates' },
      { name: 'Automation Engine', route: '/automation' },
      { name: 'Sequence Performance', route: '/sequences/performance' },
      { name: 'Client Reports', route: '/client-reports' },
      { name: 'Email Health', route: '/email-health' },
      { name: 'Settings', route: '/settings' },
    ],
  },
  {
    role: 'leadgen_manager',
    name: 'Dominic (Leadgen Manager)',
    email: 'dominic@telestar.vn',
    password: 'Telestar2026',
    items: [
      { name: 'Leadgen Workspace', route: '/leadgen' },
      { name: 'Internal Database Pool', route: '/leadgen-manager?tab=pool' },
      { name: 'Import Center', route: '/leadgen-manager?tab=import' },
      { name: 'Qualification Queue', route: '/leadgen-manager?tab=qualify' },
      { name: 'Campaign Routing', route: '/leadgen-manager?tab=routing' },
      { name: 'Export Center', route: '/leadgen-manager?tab=export' },
      { name: 'Team Performance', route: '/leadgen-manager?tab=team' },
      { name: 'Source Performance', route: '/leadgen-manager?tab=sources' },
      { name: 'Client Reports', route: '/client-reports' },
      { name: 'Settings', route: '/settings' },
    ],
  },
];

async function main() {
  console.log(`\n======================================================================`);
  console.log(`🔍 RUNNING CANONICAL DEEP AUDIT SUITE ACROSS ALL SIDEBAR ROUTES`);
  console.log(`🌐 Production: ${BASE_URL}`);
  console.log(`======================================================================\n`);

  const browser = await chromium.launch({ headless: true });
  const allResults: AuditResult[] = [];

  for (const persona of PERSONAS) {
    console.log(`\n👤 [${persona.role.toUpperCase()}] ${persona.name} (${persona.email})`);
    console.log(`----------------------------------------------------------------------`);

    const roleDir = path.join(SHOT_DIR, persona.role);
    if (!fs.existsSync(roleDir)) fs.mkdirSync(roleDir, { recursive: true });

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      baseURL: BASE_URL,
    });
    const page = await context.newPage();

    // 1. Sign In
    try {
      await page.goto('/login', { waitUntil: 'networkidle', timeout: 30000 });
      await page.fill('input[type="email"], input[name="email"]', persona.email);
      await page.fill('input[type="password"], input[name="password"]', persona.password);
      await Promise.all([
        page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30000 }),
        page.click('button[type="submit"]'),
      ]);
      console.log(`  🔑 Authentication: SUCCESS`);
    } catch (err: any) {
      console.error(`  ❌ Login failed:`, err.message);
      await context.close();
      continue;
    }

    // 2. Test Every Route in Persona Sidebar
    for (const item of persona.items) {
      const start = Date.now();
      try {
        const res = await page.goto(item.route, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await page.waitForTimeout(2000);
        const loadTimeMs = Date.now() - start;
        const httpStatus = res?.status() ?? 200;

        const is404 = await page.$('text=404, text="This page doesn\'t exist"');
        const is500 = await page.$('text=500, text="Internal Server Error"');

        let status: 'PASS' | 'FAIL' = 'PASS';
        let error: string | undefined = undefined;

        if (httpStatus >= 400 || is404 || is500) {
          status = 'FAIL';
          error = is404 ? '404 Page Not Found' : is500 ? '500 Server Error' : `HTTP ${httpStatus}`;
        }

        const safeFilename = item.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
        const shotPath = path.join(roleDir, `${safeFilename}.png`);
        await page.screenshot({ path: shotPath, fullPage: false });

        console.log(`  ${status === 'PASS' ? '🟢' : '🔴'} ${item.name.padEnd(28)} -> ${item.route.padEnd(26)} (${loadTimeMs}ms)`);

        allResults.push({
          role: persona.role,
          name: item.name,
          route: item.route,
          status,
          httpStatus,
          error,
          loadTimeMs,
        });
      } catch (err: any) {
        console.error(`  🔴 ${item.name.padEnd(28)} -> ${item.route.padEnd(26)} ERROR: ${err.message}`);
        allResults.push({
          role: persona.role,
          name: item.name,
          route: item.route,
          status: 'FAIL',
          error: err.message,
          loadTimeMs: Date.now() - start,
        });
      }
    }

    // 3. Test Live AI Assistant Stream for SDR and Director
    if (persona.role === 'director' || persona.role === 'sdr') {
      console.log(`  🤖 Testing Live AI Assistant widget streaming for ${persona.role}...`);
      try {
        await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 25000 });
        await page.waitForTimeout(2000);
        const aiBotBtn = await page.$('button.fixed, [aria-label*="AI"], button:has-text("AI")');
        if (aiBotBtn) {
          await aiBotBtn.click();
          await page.waitForTimeout(1000);
          const aiInput = await page.$('textarea, input[placeholder*="Ask AI"], input[placeholder*="message"]');
          if (aiInput) {
            await aiInput.fill('Give a 1-sentence sales tip.');
            await page.keyboard.press('Enter');
            await page.waitForTimeout(4000);
            const aiShot = path.join(roleDir, 'ai_assistant_stream.png');
            await page.screenshot({ path: aiShot });
            console.log(`     📸 Captured live AI Assistant response stream.`);
          }
        }
      } catch (err: any) {
        console.log(`     AI Widget test note:`, err.message);
      }
    }

    await context.close();
  }

  await browser.close();

  // Final Summary Matrix
  console.log(`\n======================================================================`);
  console.log(`📊 CANONICAL MULTI-ROLE DEEP AUDIT MATRIX`);
  console.log(`======================================================================`);

  const total = allResults.length;
  const passed = allResults.filter((r) => r.status === 'PASS').length;
  const failed = allResults.filter((r) => r.status === 'FAIL').length;

  console.log(`Total Views Tested: ${total} | 🟢 PASS: ${passed} | 🔴 FAIL: ${failed}\n`);

  console.table(
    allResults.map((r) => ({
      Role: r.role,
      Feature: r.name,
      Route: r.route,
      Status: r.status,
      HTTP: r.httpStatus,
      'Load (ms)': r.loadTimeMs,
      Notes: r.error ?? 'Clean',
    }))
  );

  if (failed > 0) {
    console.log(`\n🔴 FAILED FEATURES:`);
    allResults
      .filter((r) => r.status === 'FAIL')
      .forEach((r) => console.log(`  - [${r.role}] ${r.name} (${r.route}): ${r.error}`));
  } else {
    console.log(`\n🎉 100% OF ALL PRODUCTION FEATURES & ROUTES PASSED DEEP AUDIT!`);
  }
}

main().catch(console.error);
