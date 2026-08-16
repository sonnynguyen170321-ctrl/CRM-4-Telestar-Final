import { describe, it, expect } from 'vitest';
import {
  evaluateCutover,
  computeVerdict,
  daysUntil,
  hoursSince,
  type CutoverFacts,
  type Check,
} from '@/scripts/cutover-preflight';
import { resolveTenantId } from '@/scripts/worker-healthcheck';

/**
 * The cutover release policy, tested without a cutover.
 *
 * `evaluateCutover` is pure precisely so this is possible: the decision that gates a production
 * release should not first require a production release to exercise. Collection talks to the
 * host; nothing here does.
 *
 * The property that matters most is the one asserted in `does not treat "unknown" as "fine"`.
 * Every fact is nullable, and null means *we could not determine this*. A preflight that reads
 * an unreachable host as a pass is worse than no preflight, because it produces a GO nobody
 * checked. So a blocking check that is SKIP or FAIL is a NO-GO, and only PASS is a pass.
 */

const NOW = new Date('2026-08-17T09:00:00Z');

/** A deployment where everything the policy demands is true. */
const clean = (): CutoverFacts => ({
  baseUrl: 'https://crm.telestar.example',
  httpRedirectStatus: 308,
  httpRedirectLocation: 'https://crm.telestar.example/',
  hstsHeader: 'max-age=31536000; includeSubDomains',
  certNotAfter: new Date('2026-11-01T00:00:00Z'),
  sessionCookieSecure: true,
  accountsAcceptingDemoPassword: [],
  usersChecked: 22,
  passwordCheckUnavailable: null,
  backupId: 'backup-20260817-0830',
  backupTakenAt: new Date('2026-08-17T08:30:00Z'),
  migrationsCurrent: true,
  autosendEnabled: false,
  emailDryRun: true,
  queueRoundTripCompleted: true,
  queueRoundTripDetail: 'job abc completed',
  redisAppendOnly: 'yes',
  redisMaxMemoryPolicy: 'noeviction',
  cspEnforcing: true,
});

const find = (checks: Check[], id: string): Check => {
  const hit = checks.find((c) => c.id === id);
  if (!hit) throw new Error(`no check with id ${id}`);
  return hit;
};

const verdictOf = (facts: CutoverFacts) => computeVerdict(evaluateCutover(facts, NOW));

describe('cutover preflight — arithmetic helpers', () => {
  it('counts whole days until expiry and goes negative once expired', () => {
    expect(daysUntil(new Date('2026-08-27T09:00:00Z'), NOW)).toBe(10);
    expect(daysUntil(new Date('2026-08-16T09:00:00Z'), NOW)).toBe(-1);
  });

  it('measures backup age in hours', () => {
    expect(hoursSince(new Date('2026-08-17T06:00:00Z'), NOW)).toBe(3);
    expect(hoursSince(new Date('2026-08-16T09:00:00Z'), NOW)).toBe(24);
  });
});

describe('cutover preflight — a clean deployment', () => {
  it('returns GO when every condition holds', () => {
    expect(verdictOf(clean())).toBe('GO');
  });

  it('passes every check, blocking and non-blocking alike', () => {
    const checks = evaluateCutover(clean(), NOW);
    expect(checks.filter((c) => c.level !== 'PASS')).toEqual([]);
  });
});

describe('cutover preflight — mandatory NO-GO conditions', () => {
  const blocking: Array<[string, Partial<CutoverFacts>, string]> = [
    ['plain HTTP', { baseUrl: 'http://crm.telestar.example' }, 'https.scheme'],
    ['no HTTP→HTTPS redirect', { httpRedirectStatus: 200, httpRedirectLocation: null }, 'https.redirect'],
    ['expired certificate', { certNotAfter: new Date('2026-08-10T00:00:00Z') }, 'https.cert'],
    ['certificate expiring inside the window', { certNotAfter: new Date('2026-08-24T00:00:00Z') }, 'https.cert'],
    ['session cookie not Secure', { sessionCookieSecure: false }, 'https.cookie'],
    ['demo password still works', { accountsAcceptingDemoPassword: ['dean@telestar.vn'] }, 'creds.demo'],
    ['no backup recorded', { backupId: null, backupTakenAt: null }, 'backup.recent'],
    ['backup too old', { backupTakenAt: new Date('2026-08-15T08:30:00Z') }, 'backup.recent'],
    ['migrations pending', { migrationsCurrent: false }, 'db.migrations'],
    ['autosend armed', { autosendEnabled: true }, 'email.autosend'],
    ['dry-run off', { emailDryRun: false }, 'email.dryrun'],
    ['worker not consuming', { queueRoundTripCompleted: false, queueRoundTripDetail: 'timed out' }, 'worker.roundtrip'],
  ];

  it.each(blocking)('%s is a NO-GO', (_label, override, id) => {
    const facts = { ...clean(), ...override };
    const checks = evaluateCutover(facts, NOW);
    expect(find(checks, id).level).toBe('FAIL');
    expect(find(checks, id).blocking).toBe(true);
    expect(computeVerdict(checks)).toBe('NO-GO');
  });

  it('names a backup dated in the future as a failure rather than a fresh one', () => {
    const facts = { ...clean(), backupTakenAt: new Date('2026-08-18T00:00:00Z') };
    expect(find(evaluateCutover(facts, NOW), 'backup.recent').level).toBe('FAIL');
  });

  it('lists every account that still accepts the published password', () => {
    const facts = { ...clean(), accountsAcceptingDemoPassword: ['a@t.vn', 'b@t.vn'] };
    const detail = find(evaluateCutover(facts, NOW), 'creds.demo').detail;
    expect(detail).toContain('a@t.vn');
    expect(detail).toContain('b@t.vn');
    expect(detail).toContain('2 account(s)');
  });
});

describe('cutover preflight — declared exceptions do not block', () => {
  const exceptions: Array<[string, Partial<CutoverFacts>, string]> = [
    ['report-only CSP', { cspEnforcing: false }, 'csp.mode'],
    ['no Redis persistence', { redisAppendOnly: 'no' }, 'redis.persistence'],
    ['evicting Redis policy', { redisMaxMemoryPolicy: 'allkeys-lru' }, 'redis.eviction'],
    ['missing HSTS', { hstsHeader: null }, 'https.hsts'],
  ];

  it.each(exceptions)('%s downgrades to GO_WITH_DECLARED_EXCEPTIONS, not NO-GO', (_label, override, id) => {
    const facts = { ...clean(), ...override };
    const checks = evaluateCutover(facts, NOW);
    expect(find(checks, id).blocking).toBe(false);
    expect(find(checks, id).level).not.toBe('PASS');
    expect(computeVerdict(checks)).toBe('GO_WITH_DECLARED_EXCEPTIONS');
  });

  it('never reports a clean GO while an exception is open', () => {
    const facts = { ...clean(), cspEnforcing: false, redisAppendOnly: 'no' };
    expect(verdictOf(facts)).not.toBe('GO');
  });

  it('still returns NO-GO when a blocking failure accompanies an exception', () => {
    const facts = { ...clean(), cspEnforcing: false, emailDryRun: false };
    expect(verdictOf(facts)).toBe('NO-GO');
  });
});

describe('worker healthcheck — tenant resolution', () => {
  const prismaWith = (ids: string[]) =>
    ({ tenant: { findMany: async () => ids.slice(0, 2).map((id) => ({ id })) } }) as never;

  it('uses an explicit tenant id without touching the database', async () => {
    const exploding = { tenant: { findMany: async () => { throw new Error('should not be called'); } } } as never;
    await expect(resolveTenantId(exploding, 'tenant-a')).resolves.toEqual({ tenantId: 'tenant-a' });
  });

  it('uses the only tenant when there is exactly one', async () => {
    await expect(resolveTenantId(prismaWith(['solo']), undefined)).resolves.toEqual({ tenantId: 'solo' });
  });

  it('refuses to guess between several tenants', async () => {
    const result = await resolveTenantId(prismaWith(['a', 'b']), undefined);
    expect(result).toHaveProperty('error');
    expect('error' in result && result.error).toContain('CUTOVER_TENANT_ID');
  });

  it('reports an empty database rather than enqueueing into nothing', async () => {
    const result = await resolveTenantId(prismaWith([]), undefined);
    expect(result).toHaveProperty('error');
    expect('error' in result && result.error).toContain('no tenants');
  });
});

describe('cutover preflight — does not treat "unknown" as "fine"', () => {
  it('refuses every blocking check that could not be determined', () => {
    const unknown: CutoverFacts = {
      baseUrl: null,
      httpRedirectStatus: null,
      httpRedirectLocation: null,
      hstsHeader: null,
      certNotAfter: null,
      sessionCookieSecure: null,
      accountsAcceptingDemoPassword: null,
      usersChecked: 0,
      passwordCheckUnavailable: null,
      backupId: null,
      backupTakenAt: null,
      migrationsCurrent: null,
      autosendEnabled: null,
      emailDryRun: null,
      queueRoundTripCompleted: null,
      queueRoundTripDetail: 'not attempted',
      redisAppendOnly: null,
      redisMaxMemoryPolicy: null,
      cspEnforcing: null,
    };
    const checks = evaluateCutover(unknown, NOW);

    expect(computeVerdict(checks)).toBe('NO-GO');
    // Not one blocking check may read as a pass on an environment nobody reached.
    expect(checks.filter((c) => c.blocking && c.level === 'PASS')).toEqual([]);
  });

  it('treats an unreachable host exactly like a failing one for the verdict', () => {
    const unreachable = { ...clean(), baseUrl: null, certNotAfter: null, httpRedirectStatus: null };
    expect(verdictOf(unreachable)).toBe('NO-GO');
  });

  it('counts a blocking SKIP as NO-GO, never as a pass', () => {
    const checks: Check[] = [
      { id: 'x', title: 'x', level: 'SKIP', detail: '', blocking: true },
      { id: 'y', title: 'y', level: 'PASS', detail: '', blocking: true },
    ];
    expect(computeVerdict(checks)).toBe('NO-GO');
  });
});
