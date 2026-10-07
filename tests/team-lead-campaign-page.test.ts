import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { canOpenAdminPath } from '@/lib/admin/teamLeadAdminPaths';

/**
 * Owner, 2026-10-07: "team lead has no Campaign page — why not use the existing one". A team lead
 * now opens /admin/campaigns and a campaign's members page, and nothing else under /admin.
 */
describe('canOpenAdminPath', () => {
  it('lets a team lead open the campaign list and a campaign’s members', () => {
    expect(canOpenAdminPath('team_lead', '/admin/campaigns')).toBe(true);
    expect(canOpenAdminPath('team_lead', '/admin/campaigns/')).toBe(true);
    expect(canOpenAdminPath('team_lead', '/admin/campaigns/camp-1/members')).toBe(true);
  });

  it('keeps the rest of the admin console from a team lead', () => {
    for (const path of ['/admin', '/admin/users', '/admin/teams', '/admin/clients', '/admin/audit', '/admin/jobs',
      '/admin/campaigns/camp-1', '/admin/campaigns/camp-1/members/extra', '/admin/campaignsx']) {
      expect(canOpenAdminPath('team_lead', path)).toBe(false);
    }
  });

  it('keeps every admin page from an SDR and from no role', () => {
    expect(canOpenAdminPath('sdr', '/admin/campaigns')).toBe(false);
    expect(canOpenAdminPath(undefined, '/admin/campaigns')).toBe(false);
  });

  it('leaves director and floor manager with the whole console', () => {
    expect(canOpenAdminPath('director', '/admin/users')).toBe(true);
    expect(canOpenAdminPath('floor_manager', '/admin/jobs')).toBe(true);
  });
});

describe('the edge proxy, the admin layout and the campaign list agree', () => {
  const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');

  it('fence /admin with the shared predicate', () => {
    expect(read('proxy.ts')).toContain('canOpenAdminPath(role, pathname)');
    expect(read('app', 'admin', 'layout.tsx')).toContain('canOpenAdminPath(currentRole, pathname)');
  });

  // /api/admin/assignments refuses a team lead, so counts from it read "No SDR" on every row.
  it('reads member counts from /api/campaigns, not the admin assignments endpoint', () => {
    const page = read('app', 'admin', 'campaigns', 'page.tsx');
    expect(page).not.toMatch(/fetch\(\s*['"`]\/api\/admin\/assignments/);
    expect(page).toContain('_count?.campaignSdrs');
    expect(read('app', 'api', 'campaigns', 'route.ts')).toMatch(/_count:\s*\{\s*select:\s*\{\s*leads:\s*true,\s*campaignSdrs:\s*true/);
  });
});
