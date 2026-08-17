import { chromium } from 'playwright';

async function testEmailSend() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('1. Logging in as sonny@itelestar.com...');
  await page.goto('https://crm.telestar.cloud/login', { waitUntil: 'networkidle' });
  await page.fill('input[type="email"], input[name="email"]', 'sonny@itelestar.com');
  await page.fill('input[type="password"], input[name="password"]', 'Telestar2026');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);

  // Monitor all console logs and network requests/responses
  page.on('console', msg => console.log('BROWSER LOG:', msg.type(), msg.text()));
  page.on('requestfailed', req => console.log('REQ FAILED:', req.url(), req.failure()?.errorText));
  page.on('response', async res => {
    if (res.url().includes('/api/email/send')) {
      console.log('EMAIL SEND STATUS:', res.status());
      try {
        const text = await res.text();
        console.log('EMAIL SEND RESPONSE:', text);
      } catch (_e) {}
    }
  });

  console.log('2. Navigating to /leads...');
  await page.goto('https://crm.telestar.cloud/leads', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Find and click the first lead row or email action button
  console.log('3. Opening lead detail...');
  // Click on a lead name
  const leadRow = page.locator('table tbody tr').first();
  await leadRow.click();
  await page.waitForTimeout(1000);

  // Look for Send Email or Compose button
  console.log('4. Looking for Send Email / Compose button...');
  const sendEmailBtn = page.locator('button:has-text("Send Email"), button:has-text("Email"), button[aria-label*="Compose email"]').first();
  if (await sendEmailBtn.isVisible()) {
    await sendEmailBtn.click();
    await page.waitForTimeout(1000);

    console.log('5. Clicking Send button inside Modal...');
    const modalSendBtn = page.locator('form button[type="submit"]:has-text("Send Email")');
    if (await modalSendBtn.isVisible()) {
      console.log('Modal Send button is visible! Disabled?', await modalSendBtn.isDisabled());
      await modalSendBtn.click();
      await page.waitForTimeout(3000);
    } else {
      console.log('Modal Send button not found!');
    }
  } else {
    console.log('Send Email button not found on lead detail!');
  }

  await browser.close();
}

testEmailSend().catch(console.error);
