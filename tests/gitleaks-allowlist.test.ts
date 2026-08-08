import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

/**
 * The secret-scan allowlist is the one piece of security configuration whose failure mode
 * is silence: widen a regex slightly and real credentials stop failing the build, with no
 * error anywhere. These tests pin the boundary.
 *
 * They parse `.gitleaks.toml` rather than duplicating its patterns, so editing the config
 * is what the assertions actually check.
 */

const toml = readFileSync('.gitleaks.toml', 'utf8');

function allowlistRegexes(): RegExp[] {
  const start = toml.indexOf('regexes = [');
  const end = toml.indexOf('paths = [');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const block = toml.slice(start, end);
  const sources = [...block.matchAll(/'''([\s\S]*?)'''/g)].map((m) => m[1]);
  expect(sources.length).toBeGreaterThan(0);
  return sources.map((s) => new RegExp(s));
}

const isAllowlisted = (value: string) => allowlistRegexes().some((re) => re.test(value));

describe('gitleaks allowlist', () => {
  it('keeps the default ruleset enabled', () => {
    // Without this, the allowlist is irrelevant because nothing is being detected.
    expect(toml).toMatch(/useDefault\s*=\s*true/);
  });

  it('every allowlist regex compiles', () => {
    expect(() => allowlistRegexes()).not.toThrow();
  });

  it.each([
    'postgresql://postgres:postgres@localhost:5432/telestar_crm',
    'postgresql://postgres:postgres@127.0.0.1:5432/telestar_crm_test',
    'redis://localhost:6379',
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    // Documentation DSNs: real-shaped, but the password segment is a placeholder.
    'postgresql://crm:<password>@<rds-writer-endpoint>:5432/telestar_crm?sslmode=require',
    'postgresql://${DB_USER}:${DB_PASSWORD}@${DB_IP}:5432/${DB_NAME}?schema=public',
    'postgresql://user:pass@host:5432/crm?sslmode=require',
  ])('allows the known non-credential %s', (value) => {
    expect(isAllowlisted(value)).toBe(true);
  });

  it.each([
    // A credentialled DSN pointing anywhere that is not loopback must still fail the
    // build. This is the assertion that stops the local-database exemption from quietly
    // becoming "any database".
    ['remote Postgres with a password', 'postgresql://crm:hunter2@34.142.236.46:5432/telestar_crm'],
    ['managed Postgres', 'postgresql://crm:pw@db.abc.neon.tech:5432/main'],
    ['Cloud SQL socket', 'postgresql://crm:pw@10.20.30.40:5432/telestar_crm'],
    ['remote Redis with auth', 'rediss://user:realpass@prod-cache.example.net:6380'],
    // The placeholder-password exemption must not spill over onto real ones. These differ
    // from the allowed documentation DSNs only in the password segment.
    ['a real password at a placeholder host', 'postgresql://crm:Tr0ub4dor3xK@<rds-writer-endpoint>:5432/telestar_crm'],
    ['a password that merely contains "pass"', 'postgresql://crm:passw0rdGenuine9@db.internal:5432/crm'],
    ['GitHub personal access token', 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'],
    ['AWS access key id', 'AKIAIOSFODNN7EXAMPLE'],
    ['Google API key', 'AIzaSyD-1234567890abcdefghijklmnopqrstu'],
    ['an unrelated 64-hex value', 'f'.repeat(64)],
  ])('does not allow %s', (_label, value) => {
    expect(isAllowlisted(value)).toBe(false);
  });

  it('scopes path exemptions to templates and named fixture files', () => {
    // A blanket '^tests/' or '^docs/' would exempt any secret pasted into those trees.
    const start = toml.indexOf('paths = [');
    const paths = [...toml.slice(start).matchAll(/'''([\s\S]*?)'''/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      expect(p).not.toBe('^tests/');
      expect(p).not.toBe('^docs/');
      expect(p).not.toMatch(/^\^?(tests|docs|src|lib|app)\/?\$?$/);
    }
  });
});
