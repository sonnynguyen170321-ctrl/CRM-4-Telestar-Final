import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The credential `Telestar2026` was published in a public repository for three weeks, in 23
 * files, and every gate stayed green — because `.gitleaks.toml` carried it on the allowlist
 * under "Test credentials & mock tokens" (TEL-P0-009). It was not a test credential:
 * `restore-internal-users.ts` assigned it to all 44 roster accounts and
 * `sync-users-to-production.ts` signed in to https://crm.telestar.cloud with it as a director.
 *
 * The allowlist entry cannot be removed. `secret-scan` runs `gitleaks detect` across the full
 * history (`fetch-depth: 0`) and the literal is in commit `25c3699` for good, so deleting the
 * entry would block every future merge without un-publishing anything.
 *
 * That leaves a hole exactly the shape of the original defect: an allowlisted string is
 * invisible to the scanner *forever*, including in code written tomorrow. This suite is what
 * closes it. gitleaks answers "is there a secret in the history"; this answers the question
 * that actually matters now — "is any tracked file using it".
 */

const REPO_ROOT = process.cwd();

/** Burned credentials. Anything here is public, and may never be assigned to an account. */
const BURNED_CREDENTIALS = ['Telestar2026'];

/**
 * Where the literal is allowed to survive, and why. Each of these *names* the credential in
 * prose or feeds it to something that must reject it — none authenticates with it.
 */
const PERMITTED: ReadonlyArray<{ file: string; reason: string }> = [
  { file: '.gitleaks.toml', reason: 'the allowlist entry itself, and the comment explaining why it cannot be removed' },
  { file: 'scripts/deploy.sh', reason: 'a comment recording DEPLOY-002' },
  { file: 'scripts/deploy-lib.sh', reason: 'a comment recording DEPLOY-002' },
  { file: 'scripts/liveCredentials.ts', reason: 'the doc comment on the helper that replaced it' },
  { file: 'tests/deploy-script.test.ts', reason: 'fed to validate_backup_id as a value it must REJECT' },
  { file: 'tests/no-committed-credentials.test.ts', reason: 'this file' },
  { file: 'tests/restore-internal-users.test.ts', reason: 'asserts the literal is absent from the script' },
  { file: 'docs/archive/admin-control-center/STATUS.md', reason: 'archived record of a fixed defect' },
  { file: 'docs/production-certification/LIVE_RELEASE_STATE.md', reason: 'certification prose naming DEPLOY-002' },
  { file: 'docs/production-certification/DEFECTS.md', reason: 'generated from defects.json, which describes TEL-P0-009' },
  { file: 'docs/production-certification/defects.json', reason: 'the TEL-P0-009 root-cause record' },
];

const permittedFiles = new Set(PERMITTED.map((p) => p.file));

/**
 * Everything git would carry: tracked files, plus untracked ones that are not ignored.
 *
 * `--others --exclude-standard` is what makes this useful during development rather than
 * only after the fact — a new file holding the credential fails here *before* it is
 * committed, which is the point at which it can still be fixed cheaply.
 */
function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function readIfText(file: string): string | null {
  try {
    const buf = readFileSync(path.join(REPO_ROOT, file));
    if (buf.includes(0)) return null; // binary
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

describe('no burned credential is in use in any tracked file (TEL-P0-009)', () => {
  const offenders: Array<{ file: string; credential: string }> = [];
  const files = trackedFiles();

  for (const file of files) {
    if (permittedFiles.has(file)) continue;
    const text = readIfText(file);
    if (text === null) continue;
    for (const credential of BURNED_CREDENTIALS) {
      if (text.includes(credential)) offenders.push({ file, credential });
    }
  }

  it('scans a non-trivial number of tracked files, so a broken scan cannot pass silently', () => {
    // Without this, a `git ls-files` that returned nothing would read as a clean result.
    expect(files.length).toBeGreaterThan(100);
  });

  it('finds the credential in no file outside the documented exceptions', () => {
    const detail = offenders.map((o) => `  ${o.file} contains ${o.credential}`).join('\n');
    expect(offenders, `burned credentials found in tracked files:\n${detail}`).toEqual([]);
  });

  it('keeps every documented exception honest — each named file still exists', () => {
    // An exception for a deleted file is a hole waiting for a new file of the same name.
    const tracked = new Set(files);
    const stale = PERMITTED.filter((p) => !tracked.has(p.file)).map((p) => p.file);
    expect(stale, `permitted files that are no longer tracked: ${stale.join(', ')}`).toEqual([]);
  });

  it('grants no exception to a file that authenticates or provisions', () => {
    // A comment naming the credential is fine. An exception covering a file that could sign in
    // with it is the original defect, re-granted.
    for (const { file } of PERMITTED) {
      const text = readIfText(file);
      if (text === null) continue;
      for (const credential of BURNED_CREDENTIALS) {
        const usedAsCredential = new RegExp(
          `(?:password|passwd|pwd|secret|token)\\s*[:=]\\s*['"\`]${credential}['"\`]`,
          'i'
        );
        expect(
          usedAsCredential.test(text),
          `${file} assigns ${credential} as a credential — an allowlist entry does not make that safe`
        ).toBe(false);
      }
    }
  });
});

describe('the live-verification scripts have no default credential', () => {
  const LIVE_SCRIPTS = [
    'scripts/deep-audit-playwright.ts',
    'scripts/deep-ui-audit.ts',
    'scripts/diagnose-email-send.ts',
    'scripts/live-e2e-all-roles.ts',
    'scripts/live-e2e-director.ts',
    'scripts/test-email-send.ts',
    'scripts/verify-ai-enhancements.ts',
    'scripts/verify-dark-mode-live.ts',
    'scripts/verify-integrations-live.ts',
    'scripts/verify-new-ai-greeting.ts',
    'scripts/verify-rbac-journey-live.ts',
    'scripts/verify-ui-ux-live.ts',
  ];

  it.each(LIVE_SCRIPTS)('%s reads its password from the environment', (file) => {
    const text = readIfText(file);
    expect(text, `${file} is missing`).not.toBeNull();
    expect(text!).toMatch(/requireLivePassword\(\)/);
  });

  it.each(LIVE_SCRIPTS)('%s falls back to no literal if the environment is unset', (file) => {
    const text = readIfText(file)!;
    // `process.env.X || 'literal'` is the shape that made this a production disclosure.
    expect(text).not.toMatch(/process\.env\.[A-Z_]+\s*\|\|\s*['"][^'"]{6,}['"]/);
  });

  it('fails closed when the environment variable is absent', async () => {
    const { requireLivePassword, LIVE_PASSWORD_ENV } = await import('../scripts/liveCredentials');
    const saved = process.env[LIVE_PASSWORD_ENV];
    try {
      delete process.env[LIVE_PASSWORD_ENV];
      expect(() => requireLivePassword()).toThrow(/REFUSED/);
      process.env[LIVE_PASSWORD_ENV] = '';
      expect(() => requireLivePassword()).toThrow(/REFUSED/);
      process.env[LIVE_PASSWORD_ENV] = '   ';
      expect(() => requireLivePassword()).toThrow(/REFUSED/);
      process.env[LIVE_PASSWORD_ENV] = 'a-real-secret';
      expect(requireLivePassword()).toBe('a-real-secret');
    } finally {
      if (saved === undefined) delete process.env[LIVE_PASSWORD_ENV];
      else process.env[LIVE_PASSWORD_ENV] = saved;
    }
  });
});

describe('the unsafe legacy provisioning paths are gone (TEL-P0-010)', () => {
  const REMOVED = [
    // Deleted every user in every tenant except one: `findMany({ where: { id: { not: dean.id } } })`
    // with no tenantId predicate, then deleteMany, with each reassignment in a swallowing catch.
    'scripts/set-single-director.ts',
    // A fourth copy of the roster, provisioning it with one hard-coded shared password.
    'scripts/provision-telestar-organization.ts',
    // Wrote users into live production over the API with a defaulted director credential,
    // assigned one shared password to all of them, and exited 0 on failure.
    'scripts/sync-users-to-production.ts',
  ];

  it.each(REMOVED)('%s is no longer tracked', (file) => {
    expect(trackedFiles()).not.toContain(file);
  });

  it.each(['single-director:clean', 'prod:sync-users'])('npm script "%s" no longer exists', (script) => {
    const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    expect(Object.keys(pkg.scripts)).not.toContain(script);
  });

  it('leaves exactly one roster-provisioning entrypoint, and it is the guarded one', () => {
    const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    const provisioners = Object.entries(pkg.scripts as Record<string, string>).filter(
      ([, cmd]) =>
        cmd.includes('restore-internal-users') ||
        cmd.includes('set-single-director') ||
        cmd.includes('provision-telestar-organization') ||
        cmd.includes('sync-users-to-production')
    );
    expect(provisioners.map(([name]) => name)).toEqual(['users:restore']);
  });
});
