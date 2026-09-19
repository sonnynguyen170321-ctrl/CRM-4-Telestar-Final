/**
 * A field the UI renders is a field the API sends, and a link the UI offers goes somewhere.
 *
 * Three defects from the 2026-09-19 six-role role-play, one shape: a producer and a consumer
 * that each looked correct alone and had quietly stopped agreeing.
 *
 *  - `GET /api/campaigns` had its select narrowed for privacy (rightly: it was leaking buyer
 *    contacts). The admin console kept reading `_count.leads` and `client.status`, so every
 *    campaign showed **0 leads** and every client rendered as "Acme Corp ()" — `undefined !==
 *    'active'` — which also implied the client was inactive.
 *  - The attention banner's "Assign Leads" pointed at `/leads?tab=pool`. The leads page reads
 *    no URL parameter at all, so a manager landed on the ordinary pipeline with no way to see
 *    the leads the banner had just counted.
 *  - The SDR sidebar listed Automation; the page bounces non-managers home.
 *
 * Source-level assertions, because the alternative — a DOM harness for a 1,000-line page — is
 * not in this repo, and what is being pinned is the agreement between two files, not
 * rendering. `tests/leads-list-query.test.ts`-style behaviour for the new filter is below.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildLeadListWhere } from '@/lib/leads/listQuery';

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');

describe('admin campaigns reads what /api/campaigns sends', () => {
  const api = read('app', 'api', 'campaigns', 'route.ts');
  const page = read('app', 'admin', 'campaigns', 'page.tsx');
  // The campaign-list select is the one that names `targetVertical`; the clients branch above
  // it does not.
  const select = api.slice(api.indexOf('targetVertical: true'), api.indexOf('orderBy: { startDate'));

  it('sends the lead count the Leads column renders', () => {
    expect(page).toMatch(/_count\?\.leads/);
    expect(select).toMatch(/_count:\s*\{\s*select:\s*\{\s*leads:\s*true/);
  });

  it('sends the client status the row compares against "active"', () => {
    expect(page).toMatch(/client\.status\s*!==\s*'active'/);
    expect(select).toMatch(/client:\s*\{\s*select:\s*\{[^}]*status:\s*true/);
  });

  it('still does not send buyer contact details — the reason the select is explicit', () => {
    expect(select).not.toMatch(/contactName|contactEmail/);
  });

  it('busts the list cache for the new shape', () => {
    // A 60s TTL of the old shape after deploy is 60s of "0 leads" again.
    expect(api).toMatch(/'list-v2'/);
  });
});

describe('the attention banner links to a filter the leads list honours', () => {
  const engine = read('lib', 'ai', 'engine', 'attention-engine.ts');
  const leadsApi = read('app', 'api', 'leads', 'route.ts');
  const leadsPage = read('app', 'leads', 'page.tsx');
  const hook = read('lib', 'hooks', 'useLeads.ts');

  it('points at ?operatingState=unassigned, not the tab that never existed', () => {
    expect(engine).toContain('/leads?operatingState=unassigned');
    expect(engine).not.toMatch(/targetUrl:\s*`\/leads\?tab=pool`/);
  });

  it('the API reads and validates that parameter', () => {
    expect(leadsApi).toMatch(/searchParams\.get\('operatingState'\)/);
    expect(leadsApi).toMatch(/Invalid operatingState filter/);
  });

  it('the page reads it from the URL and the hook forwards it', () => {
    expect(leadsPage).toMatch(/URLSearchParams\(window\.location\.search\)\.get\('operatingState'\)/);
    expect(hook).toMatch(/params\.set\('operatingState'/);
  });

  it('the query builder applies it', () => {
    const where = buildLeadListWhere({ tenantId: 't1' }, { operatingState: 'unassigned' });
    expect(JSON.stringify(where)).toContain('"operatingState":"unassigned"');
    const without = buildLeadListWhere({ tenantId: 't1' }, {});
    expect(JSON.stringify(without)).not.toContain('operatingState');
  });
});

describe('the sidebar offers Automation only to roles the page admits', () => {
  const sidebar = read('components', 'Sidebar.tsx');
  const automation = read('app', 'automation', 'page.tsx');

  it('gates the entry on the same predicate the page uses', () => {
    expect(automation).toMatch(/if \(!isSessionLoading && !isManager\)/);
    expect(sidebar).toMatch(/isManager \? \[\{ name: 'Automation', href: '\/automation'/);
    expect(sidebar).not.toMatch(/^\s*\{ name: 'Automation', href: '\/automation', icon: Cpu \},/m);
  });
});
