import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * TEL-P1-029 — `/api/demo/diagnostics` was readable against a live tenant, by anyone.
 *
 * It is described in its own docstring as "a debugging tool, not a customer surface", and its
 * siblings under `app/api/demo/` restrict themselves to the demo tenant — `inbound-reply` says
 * so explicitly, "so it cannot be used to inject mail into a real one". Diagnostics carried no
 * such restriction, and gated only on `requireAuth()` plus a tenant comparison.
 *
 * Two separate problems, and the tests below keep them separate:
 *
 *   1. it ran against real client tenants at all
 *   2. within a tenant it applied no object authorization, so one SDR could read another
 *      SDR's prospect — the agent actions, approvals and reply classification included
 *
 * AGENTS.md states the rule this broke: "Capability authorization is not object authorization."
 */

const ROUTE = join(process.cwd(), 'app', 'api', 'demo', 'diagnostics', 'route.ts');
const source = readFileSync(ROUTE, 'utf8');

describe('demo diagnostics is confined to the demo tenant', () => {
  it('refuses any tenant that is not the demo tenant', () => {
    expect(source).toContain('DEMO_TENANT_ID');
    expect(source).toMatch(/user\.tenantId !== DEMO_TENANT_ID/);
  });

  it('refuses with 403 rather than silently returning nothing', () => {
    const guard = source.slice(source.indexOf('user.tenantId !== DEMO_TENANT_ID'));
    expect(guard.slice(0, 200)).toContain('403');
  });

  it('applies the restriction before reading any prospect data', () => {
    const guard = source.indexOf('user.tenantId !== DEMO_TENANT_ID');
    const firstRead = source.indexOf('prisma.lead.findUnique');
    expect(guard).toBeGreaterThan(-1);
    expect(firstRead).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(firstRead);
  });
});

describe('demo diagnostics applies object authorization, not just tenancy', () => {
  it('resolves what the caller may see', () => {
    expect(source).toContain('getVisibleUserIds');
  });

  it('checks the lead against that set', () => {
    expect(source).toMatch(/visibleUserIds !== null && !visibleUserIds\.includes\(lead\.assignedToId\)/);
  });

  it('selects assignedToId, which the check needs', () => {
    // Without it the authorization cannot be evaluated at all.
    // Anchored on `if (!lead ||`, not `if (!lead` — the latter also matches the `if (!leadId)`
    // guard further up, which would slice backwards and silently assert nothing.
    const select = source.slice(
      source.indexOf('prisma.lead.findUnique'),
      source.indexOf('if (!lead ||'),
    );
    expect(select.length).toBeGreaterThan(0);
    expect(select).toContain('assignedToId');
  });

  it('treats an unauthorized lead exactly like a missing one', () => {
    // A distinct 403 here would confirm the lead exists, turning the endpoint into an oracle
    // for valid lead ids.
    const check = source.slice(source.indexOf('visibleUserIds !== null'));
    expect(check.slice(0, 220)).toContain('404');
    expect(check.slice(0, 220)).toContain('Prospect not found');
  });

  it('keeps the tenant check as well, so neither guard is load-bearing alone', () => {
    expect(source).toMatch(/lead\.tenantId !== tenantId/);
  });
});

describe('every route under app/api/demo is confined to the demo tenant', () => {
  // The defect was that one route in this directory had drifted from the convention the
  // others follow. Assert the convention across the directory so a new one cannot drift too.
  const demoDir = join(process.cwd(), 'app', 'api', 'demo');

  function routeFiles(dir: string): string[] {
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...routeFiles(full));
      else if (entry.name === 'route.ts') out.push(full);
    }
    return out;
  }

  const files = routeFiles(demoDir);

  it('finds the demo routes', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [f.slice(process.cwd().length + 1).replace(/\\/g, '/'), f]))(
    '%s names the demo tenant',
    (_label, file) => {
      const body = readFileSync(file as string, 'utf8');
      expect(body).toContain('DEMO_TENANT_ID');
    },
  );
});
