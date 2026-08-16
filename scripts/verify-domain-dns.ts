import dns from 'node:dns/promises';

interface CheckResult {
  status: 'PASS' | 'WARN' | 'FAIL';
  type: string;
  name: string;
  detail: string;
}

const targetDomain = process.argv[2] || process.env.CRM_DOMAIN || 'telestar.cloud';

async function checkDns(domain: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // 1. MX Records
  try {
    const mxRecords = await dns.resolveMx(domain);
    if (mxRecords && mxRecords.length > 0) {
      const sorted = mxRecords.sort((a, b) => a.priority - b.priority);
      results.push({
        status: 'PASS',
        type: 'MX',
        name: domain,
        detail: `Found ${mxRecords.length} MX records: ${sorted.map((m) => `${m.exchange} (${m.priority})`).join(', ')}`,
      });
    } else {
      results.push({
        status: 'WARN',
        type: 'MX',
        name: domain,
        detail: 'No MX records found for domain',
      });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({
      status: 'WARN',
      type: 'MX',
      name: domain,
      detail: `MX lookup failed: ${msg}`,
    });
  }

  // 2. SPF Record (TXT on apex domain)
  try {
    const txtRecords = await dns.resolveTxt(domain);
    const flatTxt = txtRecords.map((chunk) => chunk.join(''));
    const spf = flatTxt.find((t) => t.toLowerCase().startsWith('v=spf1'));
    if (spf) {
      results.push({
        status: 'PASS',
        type: 'SPF',
        name: domain,
        detail: `SPF Record found: "${spf}"`,
      });
    } else {
      results.push({
        status: 'WARN',
        type: 'SPF',
        name: domain,
        detail: 'No v=spf1 TXT record found on root domain',
      });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({
      status: 'WARN',
      type: 'SPF',
      name: domain,
      detail: `TXT lookup failed: ${msg}`,
    });
  }

  // 3. DMARC Record (_dmarc.<domain>)
  const dmarcHost = `_dmarc.${domain}`;
  try {
    const dmarcTxt = await dns.resolveTxt(dmarcHost);
    const flatDmarc = dmarcTxt.map((chunk) => chunk.join(''));
    const dmarc = flatDmarc.find((t) => t.toLowerCase().startsWith('v=dmarc1'));
    if (dmarc) {
      results.push({
        status: 'PASS',
        type: 'DMARC',
        name: dmarcHost,
        detail: `DMARC Record found: "${dmarc}"`,
      });
    } else {
      results.push({
        status: 'WARN',
        type: 'DMARC',
        name: dmarcHost,
        detail: `No v=DMARC1 record found at ${dmarcHost}`,
      });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({
      status: 'WARN',
      type: 'DMARC',
      name: dmarcHost,
      detail: `DMARC lookup failed: ${msg}`,
    });
  }

  // 4. Common DKIM Selectors (google._domainkey, selector1._domainkey, default._domainkey)
  const commonSelectors = ['google', 'selector1', 'default', 'k1', 's1'];
  let dkimFound = false;

  for (const sel of commonSelectors) {
    const dkimHost = `${sel}._domainkey.${domain}`;
    try {
      const dkimTxt = await dns.resolveTxt(dkimHost);
      const flatDkim = dkimTxt.map((chunk) => chunk.join(''));
      const dkim = flatDkim.find((t) => t.toLowerCase().includes('v=dkim1') || t.includes('p='));
      if (dkim) {
        dkimFound = true;
        results.push({
          status: 'PASS',
          type: 'DKIM',
          name: dkimHost,
          detail: `DKIM Record found for selector "${sel}": "${dkim.substring(0, 50)}..."`,
        });
        break;
      }
    } catch {
      // Ignore individual selector lookup errors
    }
  }

  if (!dkimFound) {
    results.push({
      status: 'WARN',
      type: 'DKIM',
      name: `[selector]._domainkey.${domain}`,
      detail: `Checked common selectors (${commonSelectors.join(', ')}). In Google Workspace/M365, ensure custom DKIM selector is active.`,
    });
  }

  return results;
}

async function main() {
  console.log(`\n========================================================`);
  console.log(` DNS Deliverability & Authentication Audit for: ${targetDomain}`);
  console.log(`========================================================\n`);

  const results = await checkDns(targetDomain);

  for (const r of results) {
    const badge = r.status === 'PASS' ? '✅ PASS' : r.status === 'WARN' ? '⚠️  WARN' : '❌ FAIL';
    console.log(`[${badge}] ${r.type.padEnd(6)} | ${r.name}`);
    console.log(`        Detail: ${r.detail}\n`);
  }

  console.log(`========================================================\n`);
}

main().catch((err) => {
  console.error('DNS check fatal error:', err);
  process.exit(1);
});
