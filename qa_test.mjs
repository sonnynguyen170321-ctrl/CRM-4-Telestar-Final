import { chromium } from 'playwright';
import fs from 'fs';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const paths = [
    '/v2/research',
    '/v2/leads',
    '/v2/uploads',
    '/v2/outreach/campaigns',
    '/v2/outreach/senders',
    '/v2/jobs',
    '/v2/companies',
    '/v2/contacts'
  ];

  const results = [];
  const errors = [];

  page.on('pageerror', error => {
    errors.push(`[PAGE ERROR]: ${error.message}`);
  });

  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(`[CONSOLE ERROR]: ${msg.text()}`);
    }
  });

  console.log('Starting V2 UI Audit...');

  for (const path of paths) {
    const url = `http://localhost:3000${path}`;
    console.log(`Testing ${url}...`);
    try {
      const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 10000 });
      
      const title = await page.title();
      results.push({
        path,
        status: response ? response.status() : 'Unknown',
        title,
        errorCount: errors.length
      });

      // take a screenshot for proof
      await page.screenshot({ path: `screenshot_${path.replace(/\//g, '_')}.png` });
      
    } catch (err) {
      console.log(`Failed to load ${url}: ${err.message}`);
      results.push({
        path,
        status: 'Failed',
        error: err.message
      });
    }
    
    // clear errors for next page
    errors.length = 0;
  }

  await browser.close();

  console.log('\nAudit Results:');
  console.table(results);
  
  fs.writeFileSync('qa_audit_results.json', JSON.stringify(results, null, 2));
  console.log('Done.');
})();
