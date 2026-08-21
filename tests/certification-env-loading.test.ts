import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { execFileSync } from 'child_process';

import { OPERATOR_SUPPLIED, missingOperatorEnv } from '../scripts/certification/lib/loadEnv.mjs';

/** Windows absolute paths are not valid ESM specifiers; a dynamic import needs a file:// URL. */
const LOADER_URL = pathToFileURL(
  join(process.cwd(), 'scripts', 'certification', 'lib', 'loadEnv.mjs'),
).href;

/**
 * The ladder loaded configuration with `import 'dotenv/config'`, which reads `.env` and
 * nothing else. This project keeps local configuration in `.env.local` — the Next.js
 * convention the app, the dev server and `agent doctor` all follow — and has no `.env`.
 *
 * So on a machine set up exactly as the project documents, gate 02 failed:
 *
 *     DATABASE_URL is not set
 *     REDIS_URL is not set; the Redis-dependent gates cannot run
 *
 * A real gate failing for real, but for an environment-loading reason rather than anything
 * about the candidate — and it costs a whole ladder run to find out.
 */

describe('certification env loading', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ['DATABASE_URL', 'REDIS_URL', 'E2E_PASSWORD']) saved[key] = process.env[key];
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('reads .env.local, which is where this project keeps configuration', () => {
    // Run in a child so the load is observed from a clean process rather than this one,
    // which vitest has already configured.
    const script = `
      import('${LOADER_URL}')
        .then(m => {
          const files = m.loadCertificationEnv();
          console.log(JSON.stringify({
            files,
            databaseUrl: Boolean(process.env.DATABASE_URL),
            redisUrl: Boolean(process.env.REDIS_URL),
          }));
        });
    `;
    const out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' });
    const parsed = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
    expect(parsed.files).toContain('.env.local');
    expect(parsed.databaseUrl).toBe(true);
    expect(parsed.redisUrl).toBe(true);
  });

  it('does not override a variable already exported in the shell', () => {
    // CI exports everything explicitly. An env file must never win over that, or a run would
    // silently test a different configuration than the one CI intended.
    const script = `
      process.env.DATABASE_URL = 'postgresql://sentinel:sentinel@127.0.0.1:5432/sentinel';
      import('${LOADER_URL}')
        .then(m => { m.loadCertificationEnv(); console.log(process.env.DATABASE_URL); });
    `;
    const out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' });
    expect(out).toContain('sentinel');
  });

  it('names E2E_PASSWORD as operator-supplied rather than reading it from a file', () => {
    // It is run-scoped by design, and e2e/support/fixture.ts refuses the published demo
    // password. Putting it in an env file would defeat both.
    expect(OPERATOR_SUPPLIED).toContain('E2E_PASSWORD');

    delete process.env.E2E_PASSWORD;
    expect(missingOperatorEnv()).toContain('E2E_PASSWORD');

    process.env.E2E_PASSWORD = 'a-run-scoped-value';
    expect(missingOperatorEnv()).not.toContain('E2E_PASSWORD');
  });

  it('treats a whitespace-only value as missing', () => {
    process.env.E2E_PASSWORD = '   ';
    expect(missingOperatorEnv()).toContain('E2E_PASSWORD');
  });

  it('the ladder loads configuration before reading any env-dependent constant', () => {
    const runner = readFileSync(
      join(process.cwd(), 'scripts', 'certification', 'run-full-certification.mjs'),
      'utf8',
    );
    const load = runner.indexOf('loadCertificationEnv()');
    const readsEnv = runner.indexOf('process.env.CERT_PORT');
    expect(load).toBeGreaterThan(-1);
    expect(readsEnv).toBeGreaterThan(-1);
    // CERT_PORT is read at module load; loading config inside main() would be too late.
    expect(load).toBeLessThan(readsEnv);
  });

  it('the ladder no longer relies on dotenv/config alone', () => {
    const runner = readFileSync(
      join(process.cwd(), 'scripts', 'certification', 'run-full-certification.mjs'),
      'utf8',
    );
    expect(runner).not.toContain("import 'dotenv/config'");
  });
});

describe('loadCertificationEnv is safe to call anywhere', () => {
  it('returns the list of files it read and never throws', () => {
    // It resolves relative to REPO_ROOT, not the working directory, so it behaves the same
    // wherever it is invoked from — and on a machine with no env file at all it must return
    // an empty list rather than throwing, so CI still runs.
    const script = `
      import('${LOADER_URL}')
        .then(m => { const f = m.loadCertificationEnv(); console.log('FILES:' + JSON.stringify(f)); })
        .catch(e => { console.log('threw: ' + e.message); });
    `;
    const out = execFileSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
    expect(out).not.toContain('threw:');
    const files = JSON.parse(out.slice(out.indexOf('FILES:') + 6, out.lastIndexOf(']') + 1));
    expect(Array.isArray(files)).toBe(true);
  });
});
