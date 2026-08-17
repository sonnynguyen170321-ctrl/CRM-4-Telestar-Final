import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'https://crm.telestar.cloud';
const SCREENSHOT_DIR = path.join(process.cwd(), 'screenshots', 'impeccable_deep_audit');

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

interface PersonaAudit {
  name: string;
  email: string;
  pages: { path: string; name: string }[];
}

const AUDITS: PersonaAudit[] = [
  {
    name: 'director',
    email: 'dean@telestar.vn',
    pages: [
      { path: '/director', name: 'director_overview' },
      { path: '/leads', name: 'leads_pipeline' },
      { path: '/inbox', name: 'inbox_hub' },
      { path: '/team', name: 'team_view' },
      { path: '/campaigns', name: 'campaigns_view' },
      { path: '/sequences', name: 'sequences_view' },
      { path: '/admin/users', name: 'admin_users' },
      { path: '/email-health', name: 'email_health' },
    ],
  },
  {
    name: 'sdr',
    email: 'lan.pham@itelestar.com',
    pages: [
      { path: '/leads', name: 'sdr_leads' },
      { path: '/inbox', name: 'sdr_inbox' },
      { path: '/sequences', name: 'sdr_sequences' },
      { path: '/tasks', name: 'sdr_tasks' },
    ],
  },
];

async function runAudit() {
  console.log('🔍 Launching Impeccable Playwright UI Audit on ' + BASE_URL);
  const browser = await chromium.launch({ headless: true });

  for (const persona of AUDITS) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      baseURL: BASE_URL,
    });
    const page = await context.newPage();

    console.log(`\n👤 Authenticating persona: ${persona.name} (${persona.email})`);
    await page.goto('/login', { waitUntil: 'networkidle' });
    await page.fill('input[type="email"], input[name="email"]', persona.email);
    await page.fill('input[type="password"], input[name="password"]', 'Telestar2026');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);

    for (const p of persona.pages) {
      console.log(`  📸 Navigating to ${p.path}...`);
      await page.goto(p.path, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1000); // allow hydration & micro-transitions

      const shotPath = path.join(SCREENSHOT_DIR, `${persona.name}_${p.name}.png`);
      await page.screenshot({ path: shotPath, fullPage: false });
      console.log(`     Saved: ${shotPath}`);
    }

    await context.close();
  }

  await browser.close();
  console.log('\n✅ Impeccable Deep Scan complete! All screenshots captured.');
}

runAudit().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
