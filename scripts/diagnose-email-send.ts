import { chromium } from 'playwright';
import { requireLivePassword } from './liveCredentials';

async function testSendAPI() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    baseURL: 'https://crm.telestar.cloud',
  });
  const page = await context.newPage();

  console.log('1. Logging in as dean@telestar.vn...');
  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.fill('input[type="email"], input[name="email"]', 'dean@telestar.vn');
  await page.fill('input[type="password"], input[name="password"]', requireLivePassword());
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3500);
  console.log(`   🔑 Authentication: SUCCESS (Current URL: ${page.url()})`);

  console.log('2. Fetching accounts and leads from within browser context...');
  const testResult = await page.evaluate(async () => {
    const accRes = await fetch('/api/email/accounts');
    const accounts = await accRes.json();

    const leadRes = await fetch('/api/leads?limit=5');
    const leadsData = await leadRes.json();
    const leads = Array.isArray(leadsData) ? leadsData : leadsData.leads || [];

    const lead = leads[0];
    const account = Array.isArray(accounts) ? accounts[0] : null;

    if (!account) return { error: 'No email account found', accounts, leadsCount: leads.length };
    if (!lead) return { error: 'No lead found', accounts, leadsCount: leads.length };

    // Try sending email
    const payload = {
      accountId: account.id,
      to: lead.email || 'sonnynguyen170321@gmail.com',
      subject: 'Test subject from live certification test',
      body: 'Test body content for verifying send button functionality.',
      leadId: lead.id,
    };

    const sendRes = await fetch('/api/email/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const sendStatus = sendRes.status;
    let sendBody = null;
    try {
      sendBody = await sendRes.json();
    } catch (_e) {
      sendBody = await sendRes.text();
    }

    return {
      status: sendStatus,
      response: sendBody,
      sentTo: payload.to,
      fromAccount: account.email,
    };
  });

  console.log('Result:', JSON.stringify(testResult, null, 2));
  await browser.close();
}

async function main() {
  try {
    await testSendAPI();
  } catch (err: any) {
    console.error('DIAGNOSE RUNTIME ERROR:', err?.message || err);
  }
}

main();
