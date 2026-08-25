import { chromium } from 'playwright';
import * as path from 'path';
import { requireLivePassword } from './liveCredentials';

const ARTIFACT_DIR = 'C:\\Users\\admin\\.gemini\\antigravity-ide\\brain\\ed05b21f-cfdf-40f6-a1cd-a361d0d60c8d';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  console.log("Navigating to https://crm.telestar.cloud/login...");
  await page.goto('https://crm.telestar.cloud/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.fill('input[type="email"]', 'sonny@telestar.vn');
  await page.fill('input[type="password"]', requireLivePassword());
  await page.click('button[type="submit"]');

  await page.waitForURL('https://crm.telestar.cloud/', { timeout: 30000 });
  await page.waitForTimeout(3000);

  // Click AI Assistant Robot / Widget
  console.log("Opening AI Assistant chat widget...");
  const aiButton = await page.$('button.fixed, [aria-label*="AI"], button:has-text("AI")');
  if (aiButton) {
    await aiButton.click();
    await page.waitForTimeout(2000);
  }

  const shotPath = path.join(ARTIFACT_DIR, 'screenshots', 'live_ai_chat_new_greeting.png');
  await page.screenshot({ path: shotPath });
  console.log(`📸 Screenshot captured: ${shotPath}`);

  await browser.close();
}

main().catch(console.error);
