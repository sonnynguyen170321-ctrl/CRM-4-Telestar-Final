import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildLeadsQueryString } from '@/lib/hooks/useLeads';
import { buildLeadListWhere } from '@/lib/leads/listQuery';

/**
 * Filter the pipeline by campaign (owner, 2026-10-06: a rep uploaded a campaign's leads and could
 * not tell where they went — the board shows the first 200 of everything).
 *
 * GET /api/leads already honoured `campaignId`; the page never sent it. Source-level assertions for
 * the page, as in tests/ui-reads-what-api-sends.test.ts: there is no DOM harness for it here.
 */

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');

describe('the leads query string', () => {
  it('carries the chosen campaign', () => {
    expect(new URLSearchParams(buildLeadsQueryString({ campaignId: 'camp-1' })).get('campaignId')).toBe('camp-1');
  });

  it('leaves it out for "all campaigns"', () => {
    expect(new URLSearchParams(buildLeadsQueryString({ campaignId: 'all' })).has('campaignId')).toBe(false);
    expect(new URLSearchParams(buildLeadsQueryString({})).has('campaignId')).toBe(false);
  });
});

describe('the list query', () => {
  it('narrows to that campaign, inside the caller’s scope rather than instead of it', () => {
    const where = buildLeadListWhere({ assignedToId: 'u-1' }, { campaignId: 'camp-1' });

    expect(JSON.stringify(where)).toContain('"campaignId":"camp-1"');
    expect(JSON.stringify(where)).toContain('"assignedToId":"u-1"');
  });
});

describe('the pipeline page', () => {
  const page = read('app', 'leads', 'page.tsx');

  it('loads the campaigns the viewer can see and sends the chosen one', () => {
    expect(page).toContain("fetch('/api/campaigns')");
    expect(page).toMatch(/campaignId:\s*campaignFilter/);
  });

  it('opens on a campaign from the URL, so a campaign can link straight to its leads', () => {
    expect(page).toMatch(/params\.get\('campaignId'\)/);
  });

  it('counts and clears it with the other filters', () => {
    expect(page).toMatch(/campaignFilter !== 'all'/);
    expect(page).toMatch(/setCampaignFilter\('all'\)/);
  });
});
