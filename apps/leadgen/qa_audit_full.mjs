import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Load sample IDs
  let sampleIds = { leadAssignmentIds: [], contactIds: [], companyIds: [] };
  try {
    const raw = fs.readFileSync('sample_ids.json', 'utf8');
    sampleIds = JSON.parse(raw);
  } catch (err) {
    console.warn('Could not read sample_ids.json, proceeding with default paths only.');
  }

  const sampleLead = sampleIds.leadAssignmentIds[0] || 'v2_demo_smoke_lead_company_70ec10c7fd4a';
  const sampleContact = sampleIds.contactIds[0] || 'v2_demo_smoke_contact_qualified';
  const sampleCompany = sampleIds.companyIds[0] || 'comp_mqe0sdgw_1pb93gd5';

  console.log('Authenticating as v2.smoke.owner@example.test...');
  try {
    await page.goto('http://localhost:3000/v2/login', { waitUntil: 'networkidle', timeout: 10000 });
    await page.fill('#email', 'v2.smoke.owner@example.test');
    await page.fill('#password', 'testpassword123!');
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForURL('**/v2/workspace/leads', { timeout: 15000 })
    ]);
    console.log('Authentication successful! Proceeding to audit pages...');
  } catch (err) {
    console.error('Authentication failed! Cannot proceed with audit.', err.message);
    await browser.close();
    process.exit(1);
  }

  const paths = [
    { name: 'Home Dashboard', path: '/v2/home' },
    { name: 'Leads Command Center', path: '/v2/workspace/leads' },
    { name: 'Leads Command Center - Lead Drawer Open', path: `/v2/workspace/leads?selectedLeadId=${sampleLead}` },
    { name: 'Leads Queue', path: '/v2/workspace/leads/queue' },
    { name: 'Leads Rescore View', path: '/v2/workspace/leads/rescore-view' },
    { name: 'Leads Score Run', path: '/v2/workspace/leads/score-run' },
    { name: 'Accounts Workspace', path: '/v2/workspace/accounts' },
    { name: 'Projects Workspace', path: '/v2/workspace/projects' },
    { name: 'ICP Library', path: '/v2/icp-library' },
    { name: 'Companies Directory', path: '/v2/crm/companies' },
    { name: 'Companies Directory - Company Drawer Open', path: `/v2/crm/companies?companyId=${sampleCompany}` },
    { name: 'Contacts Directory', path: '/v2/crm/contacts' },
    { name: 'Contacts Directory - Contact Drawer Open', path: `/v2/crm/contacts?contactId=${sampleContact}` },
    { name: 'New Contact Form', path: `/v2/crm/contacts/new?companyId=${sampleCompany}` },
    { name: 'Intelligence Research', path: '/v2/research' },
    { name: 'Ingestion Uploads', path: '/v2/ingestion/uploads' },
    { name: 'Ingestion Jobs', path: '/v2/ingestion/jobs' },
    { name: 'Activity Recaps', path: '/v2/activity-recaps' },
    { name: 'Review Queue', path: '/v2/reviews' },
    { name: 'Outreach Campaigns', path: '/v2/outreach/campaigns' },
    { name: 'Outreach New Campaign', path: '/v2/outreach/campaigns/new' },
    { name: 'Outreach Compose', path: `/v2/outreach/compose?leadAssignmentId=${sampleLead}` },
    { name: 'Outreach Inbox', path: '/v2/outreach/inbox' },
    { name: 'Outreach Performance', path: '/v2/outreach/performance' },
    { name: 'Outreach Senders', path: '/v2/outreach/senders' },
    { name: 'Outreach Suppression', path: '/v2/outreach/suppression' },
    { name: 'Outreach Templates', path: '/v2/outreach/templates' },
    { name: 'AI Engine Configuration', path: '/v2/ai' },
    { name: 'Settings Panel', path: '/v2/settings' },
    { name: 'Admin Control Panel', path: '/v2/admin' },
    { name: 'Offers Directory', path: '/v2/offers' },
    { name: 'Feedback Center', path: '/v2/feedback' }
  ];

  const results = [];
  const screenshotDir = './public/audit_screenshots';
  
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  for (const item of paths) {
    const url = `http://localhost:3000${item.path}`;
    console.log(`Auditing [${item.name}] at ${url}...`);

    const pageErrors = [];
    const consoleErrors = [];
    const failedNetworkRequests = [];
    
    // Wire listeners
    page.on('pageerror', error => {
      pageErrors.push(error.stack || error.message);
    });

    page.on('console', msg => {
      const text = msg.text();
      if (msg.type() === 'error') {
        if (!text.includes('hydration-mismatch') && !text.includes('attributes of the server rendered HTML')) {
          consoleErrors.push(`[${msg.type().toUpperCase()}]: ${text}`);
        }
      }
    });

    page.on('requestfailed', request => {
      failedNetworkRequests.push(`${request.method()} ${request.url()} - ${request.failure()?.errorText || 'Unknown error'}`);
    });

    page.on('response', response => {
      if (response.status() >= 400) {
        failedNetworkRequests.push(`${response.request().method()} ${response.url()} - HTTP ${response.status()}`);
      }
    });

    try {
      const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
      
      // Wait for any skeletons/react hydrate to settle
      await page.waitForTimeout(1500);

      const title = await page.title();
      const content = await page.content();

      // Check for stubs or placeholders
      const stubKeywords = [
        'TODO', 
        'Coming Soon', 
        'Under Construction', 
        'Not Implemented', 
        'Work In Progress', 
        'Placeholder'
      ];
      const detectedStubs = stubKeywords.filter(keyword => {
        const regex = new RegExp(`\\b${keyword}\\b`, 'i');
        return regex.test(content);
      });

      // Capture screenshot
      const filename = `${item.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.png`;
      const screenshotPath = path.join(screenshotDir, filename);
      await page.screenshot({ path: screenshotPath, fullPage: false });

      // Determine page status code
      const status = response ? response.status() : 'No response';
      const redirectedUrl = page.url();
      const isRedirect = redirectedUrl !== url && !redirectedUrl.includes(url.split('?')[0]); // ignore search param differences

      results.push({
        name: item.name,
        requestedPath: item.path,
        actualUrl: redirectedUrl,
        isRedirect,
        status,
        title,
        pageErrors,
        consoleErrors,
        failedNetworkRequests,
        detectedStubs,
        screenshot: `/audit_screenshots/${filename}`
      });

    } catch (err) {
      console.error(`Audit failed for ${item.name}: ${err.message}`);
      results.push({
        name: item.name,
        requestedPath: item.path,
        status: 'Navigation Timeout / Exception',
        error: err.message,
        pageErrors,
        consoleErrors,
        failedNetworkRequests,
        detectedStubs: [],
        screenshot: null
      });
    }

    // Clean listeners for next page
    page.removeAllListeners('pageerror');
    page.removeAllListeners('console');
    page.removeAllListeners('requestfailed');
    page.removeAllListeners('response');
  }

  await browser.close();

  fs.writeFileSync('full_project_audit_report.json', JSON.stringify(results, null, 2));
  console.log('\nAudit complete. Detailed report saved to full_project_audit_report.json');

  // Print high-level summary
  const summary = results.map(r => ({
    Page: r.name,
    Status: r.status,
    Redirect: r.isRedirect ? 'Yes' : 'No',
    PageErrors: r.pageErrors?.length || 0,
    ConsoleErrors: r.consoleErrors?.length || 0,
    NetFailed: r.failedNetworkRequests?.length || 0,
    Stubs: r.detectedStubs?.join(', ') || 'None'
  }));
  console.table(summary);
})();
