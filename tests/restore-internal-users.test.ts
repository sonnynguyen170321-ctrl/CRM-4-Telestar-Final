import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  OFFICIAL_USERS,
  TENANT_ID,
  assertLocalTarget,
  assertRosterMatchesApproved,
  generatePassword,
  isLocalFingerprint,
  resolveCredentialSink,
} from '../scripts/restore-internal-users';
import approvedRoster from '../scripts/cutover/approved-roster.json';

/**
 * `scripts/restore-internal-users.ts` was, until TEL-P0-009 and TEL-P0-010, the most
 * destructive file in this repository. It could:
 *
 *   - delete every user of every tenant on the instance, because its candidate query
 *     carried no `tenantId` predicate and ran on the RLS-bypass client;
 *   - do so after silently discarding the foreign-key reassignments that were supposed
 *     to protect their rows, because each ran inside `try { … } catch {}`;
 *   - assign one password — defaulting to a literal committed to a **public** repository
 *     — to all 44 accounts, and print it to stdout on completion.
 *
 * Each test below fails against that version. They are the proof the behaviour is gone,
 * not a description of the behaviour that replaced it.
 */

const REPO_ROOT = process.cwd();
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'restore-internal-users.ts');
const rawSource = readFileSync(SCRIPT, 'utf8');

/**
 * Comments removed. The file documents the defects it replaced — it names `notIn`, and it
 * quotes `try { … } catch {}` — and a description of a removed behaviour must not read as
 * the behaviour. What these assertions are about is what the file *executes*.
 */
const source = rawSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('users:restore — the destructive legacy path is gone (TEL-P0-010)', () => {
  it('contains no user deletion of any kind', () => {
    // The old step 4 ended in `prisma.user.deleteMany({ where: { id: { in: extraIds } } })`.
    // Retiring an account is the cutover manifest's decision; this utility only provisions.
    expect(source).not.toMatch(/user\s*\.\s*deleteMany/);
    expect(source).not.toMatch(/user\s*\.\s*delete\b/);
  });

  it('selects nothing by "not in the roster", the predicate that made the purge cross-tenant', () => {
    // `{ email: { notIn: allowedEmails } }` matched every user of every OTHER tenant.
    expect(source).not.toMatch(/notIn\s*:/);
  });

  it('swallows no error around a mutation', () => {
    // `safeUpdate`/`safeDelete` were `try { … } catch {}`: a failed reassignment was
    // discarded and the delete proceeded anyway.
    expect(source).not.toMatch(/catch\s*\{\s*\}/);
    expect(source).not.toMatch(/catch\s*\(\s*\w*\s*\)\s*\{\s*\}/);
  });

  it('scopes every write it still performs to the approved tenant', () => {
    const updateManyCalls = source.match(/updateMany\(\{[\s\S]*?\}\)/g) ?? [];
    expect(updateManyCalls.length).toBeGreaterThan(0);
    for (const call of updateManyCalls) {
      expect(call).toMatch(/tenantId/);
    }
  });

  it('runs its writes in one transaction, so a mid-run failure cannot half-provision', () => {
    expect(source).toMatch(/\$transaction\(/);
  });

  it('points the operator at the manifest-driven tool for anything destructive', () => {
    expect(source).toMatch(/safe-cutover-tool/);
  });
});

describe('users:restore — refuses any non-local target (TEL-P0-010)', () => {
  it('accepts the local hosts a developer or a rehearsal clone actually uses', () => {
    expect(isLocalFingerprint('localhost:5432/telestar_crm')).toBe(true);
    expect(isLocalFingerprint('127.0.0.1:5432/telestar_crm')).toBe(true);
    expect(isLocalFingerprint('host.docker.internal:5432/telestar_crm')).toBe(true);
    expect(() => assertLocalTarget('localhost:5432/telestar_crm')).not.toThrow();
  });

  it('refuses the production Cloud SQL instance by name', () => {
    expect(() => assertLocalTarget('136.110.29.201:5432/telestar_crm')).toThrow(/REFUSED/);
    expect(() => assertLocalTarget('136.110.29.201:5432/telestar_crm')).toThrow(/not a local database/);
  });

  it('refuses an unrecognised remote host rather than requiring it to be listed first', () => {
    // The guarantee is an allowlist, not a denylist: a host nobody thought of is refused.
    expect(() => assertLocalTarget('some-replica.internal:5432/telestar_crm')).toThrow(/REFUSED/);
    expect(() => assertLocalTarget('10.20.30.40:5432/anything')).toThrow(/REFUSED/);
    expect(isLocalFingerprint('localhost.evil.example.com:5432/db')).toBe(false);
  });

  it('refuses when it cannot tell what it is connected to', () => {
    // Fail closed: an unparseable DATABASE_URL must not be read as "probably local".
    expect(() => assertLocalTarget('unknown-database')).toThrow(/REFUSED/);
  });

  it('names the refusal before any client is constructed', () => {
    const mainBody = source.slice(source.indexOf('async function main()'));
    const guardAt = mainBody.indexOf('assertLocalTarget(');
    const clientAt = mainBody.indexOf('createAdminClient()');
    expect(guardAt).toBeGreaterThan(-1);
    expect(clientAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(clientAt);
  });
});

describe('users:restore — no shared, known or committed password (TEL-P0-009)', () => {
  it('carries no fallback password literal', () => {
    // `const DEFAULT_PASSWORD = process.env.USER_RESTORE_PASSWORD || 'Telestar2026'`
    expect(source).not.toMatch(/Telestar2026/);
    expect(source).not.toMatch(/DEFAULT_PASSWORD/);
    expect(source).not.toMatch(/\|\|\s*['"][^'"]{6,}['"]/);
  });

  it('gives every account a different secret', () => {
    const generated = new Set(Array.from({ length: 200 }, () => generatePassword()));
    expect(generated.size).toBe(200);
  });

  it('generates secrets long enough to be worth generating', () => {
    // 32 random bytes, base64url — the old value was 12 printable characters, shared.
    expect(generatePassword().length).toBeGreaterThanOrEqual(40);
  });

  it('prints no password: the only credential line names the sink, not a secret', () => {
    const logged = source.match(/console\.(log|table|info|warn|error)\([\s\S]*?\);/g) ?? [];
    for (const line of logged) {
      expect(line).not.toMatch(/\bpassword\b(?!\s*change)/i);
      expect(line).not.toMatch(/credentials\.get|hashes\.get|\$\{password\}/);
    }
  });

  it('requires the operator to nominate where credentials go, and fails closed without it', () => {
    expect(() => resolveCredentialSink(undefined, REPO_ROOT, REPO_ROOT)).toThrow(/REFUSED/);
    expect(() => resolveCredentialSink('', REPO_ROOT, REPO_ROOT)).toThrow(/required/);
    expect(() => resolveCredentialSink('   ', REPO_ROOT, REPO_ROOT)).toThrow(/REFUSED/);
  });

  it('refuses to write credentials anywhere inside the repository', () => {
    expect(() => resolveCredentialSink('creds.json', REPO_ROOT, REPO_ROOT)).toThrow(/inside the repository/);
    expect(() => resolveCredentialSink('./scripts/creds.json', REPO_ROOT, REPO_ROOT)).toThrow(/inside the repository/);
    expect(() => resolveCredentialSink(path.join(REPO_ROOT, 'x', 'y.json'), REPO_ROOT, REPO_ROOT)).toThrow(
      /inside the repository/
    );
  });

  it('accepts a path outside the working tree', () => {
    const outside = path.resolve(REPO_ROOT, '..', 'telestar-credentials.json');
    expect(resolveCredentialSink(outside, REPO_ROOT, REPO_ROOT)).toBe(outside);
    expect(resolveCredentialSink('../telestar-credentials.json', REPO_ROOT, REPO_ROOT)).toBe(outside);
  });

  it('writes the credentials file with an owner-only mode', () => {
    expect(source).toMatch(/mode:\s*0o600/);
  });
});

describe('users:restore — the roster cannot drift from the approved one', () => {
  it('provisions exactly the approved roster', () => {
    expect(() => assertRosterMatchesApproved(OFFICIAL_USERS, approvedRoster.approvedUsers)).not.toThrow();
    expect(OFFICIAL_USERS.length).toBe(approvedRoster.approvedUsers.length);
  });

  it('refuses an account this script would provision that the roster does not approve', () => {
    const withStranger = [...OFFICIAL_USERS, { email: 'stranger@elsewhere.com', role: 'director' }];
    expect(() => assertRosterMatchesApproved(withStranger, approvedRoster.approvedUsers)).toThrow(
      /stranger@elsewhere\.com is provisioned here but is not on the approved roster/
    );
  });

  it('refuses an approved account this script would silently skip', () => {
    const missingOne = OFFICIAL_USERS.slice(1);
    expect(() => assertRosterMatchesApproved(missingOne, approvedRoster.approvedUsers)).toThrow(
      /is on the approved roster but is not provisioned here/
    );
  });

  it('refuses a role that disagrees with the approved roster', () => {
    const promoted = OFFICIAL_USERS.map((u) =>
      u.email === 'hailey@itelestar.com' ? { ...u, role: 'director' as const } : u
    );
    expect(() => assertRosterMatchesApproved(promoted, approvedRoster.approvedUsers)).toThrow(
      /hailey@itelestar\.com: this script says director, the approved roster says sdr/
    );
  });

  it('refuses a roster entry approved for a different tenant', () => {
    const foreign = approvedRoster.approvedUsers.map((u, i) =>
      i === 0 ? { ...u, tenantId: 'some-other-tenant' } : u
    );
    expect(() => assertRosterMatchesApproved(OFFICIAL_USERS, foreign)).toThrow(
      /approved for tenant some-other-tenant, but this script provisions default-tenant/
    );
  });

  it('provisions only the approved tenant', () => {
    expect(TENANT_ID).toBe('default-tenant');
    expect(approvedRoster.approvedTenants.map((t) => t.id)).toEqual([TENANT_ID]);
  });
});
