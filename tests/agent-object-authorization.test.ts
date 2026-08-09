import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { decideCapability } from '@/lib/agent/authorization';
import { assertSendWindowPermission, canConfigureSendWindow } from '@/lib/sequences/permissions';
import type { AutonomyMode } from '@/lib/agent/capabilities';

/**
 * Capability authorization is **not** object authorization (Revenue AI Phase 2).
 *
 * `tasks = auto` means an agent may create tasks in general. It says nothing about whether
 * this user may create a task on *that* lead, in *that* campaign, for *that* tenant. Those
 * questions belong to the CRM domain services that already answer them — `canAccessLead`,
 * `canAccessUser`, pod scoping, tenant injection — and the agent layer must call them rather
 * than reimplement them.
 *
 * The danger this file guards against is subtle: a reasonable-looking refactor that "helpfully"
 * adds a lead check inside the agent layer. That check would be a second, weaker copy of the
 * real rule, and it would drift. The tests below assert both halves — the agent layer holds no
 * object rules, and the domain layer still holds them all.
 */

const ROOT = process.cwd();
const ALL_MODES: AutonomyMode[] = ['auto', 'approval', 'manager_approval', 'human_only'];

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '.git']);

/** Remove block and line comments so prose about a helper is not mistaken for a call to it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function walk(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, acc);
    else if (/\.ts$/.test(entry)) acc.push(full);
  }
  return acc;
}

describe('the capability decision carries no object claim', () => {
  it('an allow decision names only the capability, never a record', () => {
    const decision = decideCapability({ role: 'sdr' }, 'tasks', 'auto');
    expect(decision.outcome).toBe('ALLOW');

    // If a leadId, campaignId, accountId or tenantId ever appears on this object, a caller
    // will read it as "and the object is authorized too". The shape is the safeguard.
    expect(Object.keys(decision).sort()).toEqual(['capability', 'mode', 'outcome', 'reason']);
  });

  it('decideCapability takes no record argument at all', () => {
    // Three parameters: user, capability, storedMode. There is nowhere to pass a lead, which
    // is what makes "capability authorization is not object authorization" structural rather
    // than a convention.
    expect(decideCapability.length).toBe(3);
  });
});

describe('the agent layer reproduces no object authorization', () => {
  const agentFiles = [
    ...walk(path.join(ROOT, 'lib', 'agent')),
    ...walk(path.join(ROOT, 'lib', 'ai')),
  ].map((f) => path.relative(ROOT, f));

  it('finds the agent layer (guards against a broken walker)', () => {
    expect(agentFiles.length).toBeGreaterThan(4);
  });

  it('never calls the CRM object-access helpers itself', () => {
    // Calling them here would look safe and be wrong: it puts a copy of the rule in a second
    // place. The agent calls the domain service, and the domain service calls these.
    //
    // Comments are stripped first and a call paren is required — the modules *document* that
    // they delegate to these helpers, and naming them in prose must not read as using them.
    const OBJECT_HELPER_CALL =
      /\b(canAccessLead|canAccessUser|canAccessCampaign|scopeToPod|assertTenant)\s*\(/;
    const offenders = agentFiles.filter((rel) =>
      OBJECT_HELPER_CALL.test(stripComments(readFileSync(path.join(ROOT, rel), 'utf8')))
    );
    expect(offenders).toEqual([]);
  });

  it('imports no CRM authorization helper', () => {
    // The import is the earlier signal: a module that has not imported them cannot call them.
    const offenders = agentFiles.filter((rel) => {
      const source = stripComments(readFileSync(path.join(ROOT, rel), 'utf8'));
      return /import\s*\{[^}]*\b(canAccessLead|canAccessUser|canAccessCampaign)\b/.test(source)
        || /from\s+['"]@\/lib\/podScoping['"]/.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it('touches no CRM table directly — the only Prisma model it may read is its own policy', () => {
    const offenders: string[] = [];

    for (const rel of agentFiles) {
      const source = readFileSync(path.join(ROOT, rel), 'utf8');
      for (const match of source.matchAll(/prisma\.(\w+)\./g)) {
        const model = match[1];
        // autonomyPolicy is the agent's own configuration; aiCall is its own accounting.
        // Anything else means the agent has started reaching around the domain services.
        if (model !== 'autonomyPolicy' && model !== 'aiCall') {
          offenders.push(`${rel} reads prisma.${model}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('agent tools call domain services, not our own HTTP API', () => {
  /**
   * ARCHITECTURE §12. An internal HTTP hop adds a second authentication surface for the same
   * operation and invites the worst possible fix — a bypass header, a forwarded token, a
   * service account.
   *
   * `create_task` and `get_my_tasks` predate the rule and are listed here on purpose. They
   * fetch `/api/tasks` with no session cookie and therefore 401 today: fail-closed, so a
   * functional defect rather than a security one. The exception list keeps that debt visible
   * and makes any *new* violation fail immediately, instead of the existing two becoming
   * precedent for a third.
   *
   * Removing these entries is the acceptance criterion for the repair — a domain-service
   * extraction where the route and the tool both call `lib/tasks/*`.
   */
  const KNOWN_INTERNAL_HTTP_TOOLS = ['createTask', 'getMyTasks'];

  /** Provider hosts are external services; the rule is about calling ourselves. */
  const EXTERNAL_HOSTS = /api\.tavily\.com|r\.jina\.ai|api\.groq\.com|googleapis\.com/;

  function scanInternalApiCalls(exceptions: string[]): string[] {
    const files = [
      ...walk(path.join(ROOT, 'lib', 'agent')),
      ...walk(path.join(ROOT, 'lib', 'ai')),
    ].map((f) => path.relative(ROOT, f));

    const offenders: string[] = [];

    for (const rel of files) {
      const source = stripComments(readFileSync(path.join(ROOT, rel), 'utf8'));
      // Split on function boundaries so an exception covers one tool, not a whole file.
      for (const match of source.matchAll(
        /(?:async\s+)?function\s+(\w+)[\s\S]*?(?=\n(?:async\s+)?function\s|\n*$)/g
      )) {
        const [body, fnName] = [match[0], match[1]];
        if (exceptions.includes(fnName)) continue;
        if (!/fetch\s*\(/.test(body)) continue;
        if (EXTERNAL_HOSTS.test(body)) continue;
        if (/\/api\//.test(body)) offenders.push(`${rel}:${fnName}`);
      }
    }

    return offenders;
  }

  it('the scanner actually detects internal API calls (guards against a vacuous pass)', () => {
    // With the exceptions removed, the two known offenders must appear. Without this, a
    // regex that silently matches nothing would make the rule below look enforced when it
    // is not — the failure mode of every structural test.
    const withoutExceptions = scanInternalApiCalls([]);
    expect(withoutExceptions).toEqual(
      expect.arrayContaining([expect.stringContaining('createTask'), expect.stringContaining('getMyTasks')])
    );
  });

  it('no agent module fetches an internal /api/ route outside the known exceptions', () => {
    expect(scanInternalApiCalls(KNOWN_INTERNAL_HTTP_TOOLS)).toEqual([]);
  });

  it('the known exceptions are still exactly the two documented tools', () => {
    // If this fails because an entry is gone, the repair landed — delete the entry and this
    // assertion together. If it fails because one was added, the rule was worked around.
    expect(KNOWN_INTERNAL_HTTP_TOOLS).toEqual(['createTask', 'getMyTasks']);
  });

  it('no agent module forwards auth headers or uses a bypass header', () => {
    // The tempting fix for the 401 is a forwarded cookie, a bearer token, or an internal
    // bypass header. All three are forbidden — the repair is to stop making the HTTP call.
    const files = [
      ...walk(path.join(ROOT, 'lib', 'agent')),
      ...walk(path.join(ROOT, 'lib', 'ai')),
    ].map((f) => path.relative(ROOT, f));

    const offenders: string[] = [];
    for (const rel of files) {
      const source = stripComments(readFileSync(path.join(ROOT, rel), 'utf8'));
      if (/['"]cookie['"]\s*:/i.test(source)) offenders.push(`${rel} forwards a cookie`);
      if (/authorization['"]?\s*:\s*[`'"]Bearer/i.test(source)) offenders.push(`${rel} forwards a bearer token`);
      if (/CRON_SECRET|INTERNAL_API_SECRET|SERVICE_ACCOUNT/i.test(source)) offenders.push(`${rel} uses a service secret`);
    }

    expect(offenders).toEqual([]);
  });
});

describe('the domain layer still owns object authorization', () => {
  it('the task route authenticates, scopes the assignee, and scopes the lead', () => {
    // create_task routes here. If any of these three disappears, an `auto` capability starts
    // meaning "may act on any record", which is exactly the conflation this phase forbids.
    const source = readFileSync(path.join(ROOT, 'app', 'api', 'tasks', 'route.ts'), 'utf8');
    const post = source.slice(source.indexOf('export async function POST'));

    expect(post).toMatch(/requireAuth\(\)/);
    expect(post).toMatch(/canAccessUser\(/);
    expect(post).toMatch(/canAccessLead\(/);
  });

  it('the lead route scopes reads and writes to the caller', () => {
    const source = readFileSync(path.join(ROOT, 'app', 'api', 'leads', '[id]', 'route.ts'), 'utf8');
    expect(source).toMatch(/canAccessLead\(/);
    expect(source).toMatch(/requireAuth\(\)/);
  });

  it('tenant scoping is enforced by the Prisma layer, not per call site', () => {
    // Tenancy is an extension on the client. An agent tool cannot opt out of it, because it
    // never holds a client of its own.
    const source = readFileSync(path.join(ROOT, 'lib', 'prisma.ts'), 'utf8');
    expect(source).toMatch(/\$extends/);
    expect(source).toMatch(/tenantStorage/);
  });
});

describe('an auto capability cannot widen send-window authority', () => {
  it.each(ALL_MODES)('capability mode %s still leaves the SDR denied', (mode) => {
    // Two independent gates, and the test asserts both. The capability layer denies on role,
    // and lib/sequences/permissions.ts denies again at the domain boundary — so even a bug in
    // one does not open the other.
    expect(decideCapability({ role: 'sdr' }, 'send_window_change', mode).outcome).toBe('DENY');
    expect(canConfigureSendWindow('sdr')).toBe(false);

    const violations = assertSendWindowPermission(
      'sdr',
      [{ order: 1, sendWindowStartMinutes: 540, sendWindowEndMinutes: 1020 }],
      [{ order: 1, sendWindowStartMinutes: null, sendWindowEndMinutes: null }]
    );
    expect(violations).toEqual([{ order: 1, reason: 'forbidden_role' }]);
  });

  it('a manager passes the capability gate and still faces the domain check', () => {
    expect(decideCapability({ role: 'floor_manager' }, 'send_window_change', 'auto').outcome).toBe(
      'REQUIRE_MANAGER_APPROVAL'
    );
    expect(canConfigureSendWindow('floor_manager')).toBe(true);
  });
});

describe('an allowed tool still delegates to the domain service', () => {
  const mockFindUnique = vi.fn();
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    mockFindUnique.mockReset().mockResolvedValue({ mode: 'auto' });
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
    );
  });

  it('create_task with tasks=auto still calls the CRM API, and surfaces its refusal', async () => {
    vi.doMock('@/lib/prisma', () => ({
      prisma: {
        autonomyPolicy: { findUnique: (...a: unknown[]) => mockFindUnique(...a) },
        aiCall: { create: vi.fn().mockResolvedValue({}) },
      },
    }));
    const { executeTool } = await import('@/lib/ai/tools');

    const result = await executeTool(
      'create_task',
      { title: 'Call', channel: 'phone', dueDate: '2026-08-11T09:00:00.000Z', leadId: 'someone-elses-lead' },
      { userId: 'u1', today: '2026-08-10', role: 'sdr', tenantId: 't1' }
    );

    // The capability said yes. The domain service said no. The agent reports the refusal
    // rather than inventing success — a blocked action must never read as a completed one.
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(String(fetchSpy.mock.calls[0][0])).toMatch(/\/api\/tasks$/);
    expect(result).toMatch(/failed/i);
    expect(result).not.toMatch(/task created/i);
  });
});
