import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { execFileSync } from 'child_process';

import { OPERATOR_SUPPLIED, missingOperatorEnv } from '../scripts/certification/lib/loadEnv.mjs';

/** Windows absolute paths are not valid ESM specifiers; a dynamic import needs a file:// URL. */
const LOADER_URL = pathToFileURL(
  join(process.cwd(), 'scripts', 'certification', 'lib', 'loadEnv.mjs'),
).href;

const fixtureDirs: string[] = [];

/** A throwaway directory holding the env files a case needs, and nothing else. */
function fixtureRoot(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'cert-env-'));
  fixtureDirs.push(dir);
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(dir, name), contents);
  }
  return dir;
}

/**
 * Load in a child process: this one has already been configured by vitest, so observing the
 * load here would measure vitest's environment rather than the loader's behaviour.
 */
function loadInChild(root: string): {
  files: string[];
  databaseUrl: boolean;
  redisUrl: boolean;
  databaseUrlValue: string;
  threw?: string;
} {
  const script = `
    import('${LOADER_URL}')
      .then(m => {
        const files = m.loadCertificationEnv({ root: ${JSON.stringify(root)} });
        console.log('RESULT:' + JSON.stringify({
          files,
          databaseUrl: Boolean(process.env.DATABASE_URL),
          redisUrl: Boolean(process.env.REDIS_URL),
          databaseUrlValue: process.env.DATABASE_URL || '',
        }));
      })
      .catch(e => console.log('RESULT:' + JSON.stringify({ threw: e.message })));
  `;
  // A clean environment, so a value inherited from this shell cannot be mistaken for one the
  // loader read out of a file. NODE_ENV is kept because ProcessEnv requires it.
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? '',
    SystemRoot: process.env.SystemRoot ?? '',
    NODE_ENV: process.env.NODE_ENV,
  };
  const out: string = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', env });
  return JSON.parse(out.slice(out.indexOf('RESULT:') + 7, out.lastIndexOf('}') + 1));
}

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
    // Against a fixture root, not this repository's own files: CI has no .env.local, and a
    // test that depends on one passes here and fails there — which is exactly what it did.
    const root = fixtureRoot({
      '.env.local': 'DATABASE_URL=postgresql://fixture@127.0.0.1:5432/fixture\nREDIS_URL=redis://127.0.0.1:6379\n',
    });
    const parsed = loadInChild(root);
    expect(parsed.files).toContain('.env.local');
    expect(parsed.databaseUrl).toBe(true);
    expect(parsed.redisUrl).toBe(true);
  });

  it('prefers .env.local over .env, as Next.js does', () => {
    const root = fixtureRoot({
      '.env': 'DATABASE_URL=postgresql://from-dot-env@127.0.0.1:5432/x\n',
      '.env.local': 'DATABASE_URL=postgresql://from-dot-env-local@127.0.0.1:5432/x\n',
    });
    const parsed = loadInChild(root);
    expect(parsed.files).toEqual(['.env.local', '.env']);
    expect(parsed.databaseUrlValue).toContain('from-dot-env-local');
  });

  it('returns an empty list where no env file exists, rather than throwing', () => {
    // A CI machine that exports everything explicitly has neither file.
    const parsed = loadInChild(fixtureRoot({}));
    expect(parsed.files).toEqual([]);
    expect(parsed.threw).toBeUndefined();
  });

  it('does not override a variable already exported in the shell', () => {
    // CI exports everything explicitly. An env file must never win over that, or a run would
    // silently test a different configuration than the one CI intended.
    const root = fixtureRoot({
      '.env.local': 'DATABASE_URL=postgresql://from-file@127.0.0.1:5432/x\n',
    });
    const script = `
      process.env.DATABASE_URL = 'postgresql://sentinel:sentinel@127.0.0.1:5432/sentinel';
      import('${LOADER_URL}')
        .then(m => { m.loadCertificationEnv({ root: ${JSON.stringify(root)} }); console.log(process.env.DATABASE_URL); });
    `;
    const out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' });
    expect(out).toContain('sentinel');
    expect(out).not.toContain('from-file');
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

afterAll(() => {
  for (const dir of fixtureDirs) rmSync(dir, { recursive: true, force: true });
});
