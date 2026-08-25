import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The two ways a worker runner has failed, and neither was visible in a test name.
 *
 * **TEL-P1-020** — `scripts/worker-healthcheck.ts` never exited when the check *succeeded*.
 * Enqueuing opens a BullMQ queue and its Redis connection, and both hold the event loop open;
 * the process only ever terminated because the failure path calls `process.exit(1)`. A health
 * check that hangs when everything is fine is worse than one that fails, because a deploy gate
 * waits forever and it reads as an infrastructure problem. The consequence was observed rather
 * than theorised: an orphaned healthcheck container was found still running after five days.
 *
 * That defect is provable only on the success path, so the behavioural proof is an integration
 * run — recorded in the ledger — and what is asserted here is the mechanism that makes it true:
 * the cleanup is unconditional, and the exit is not reached only by failing.
 *
 * **TEL-P1-048** — `scripts/worker-dev.cjs` spawned `npx tsx <path>` with `shell: true`, so the
 * arguments were concatenated into a command line and re-parsed by the shell. This repository
 * lives at `…\Sonny & AI\CRM-4-Telestar-Final`; cmd.exe split the string at the `&` and
 * `npm run worker:dev` could not start at all. `scripts/worker-start.cjs` had already been
 * fixed for the same reason and the dev runner was left behind.
 */

const REPO_ROOT = process.cwd();

/** Comments removed — both files document the defects they fixed, and prose is not code. */
function code(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('worker-healthcheck releases what it opened (TEL-P1-020)', () => {
  const source = code('scripts/worker-healthcheck.ts');

  it('closes the queues it opened', () => {
    expect(source).toMatch(/closeAllQueues\(\)/);
  });

  it('disconnects the Redis connection, which is the other handle holding the loop open', () => {
    expect(source).toMatch(/getConnection\(\)\s*\.\s*disconnect\(\)/);
  });

  it('cleans up in a finally, so a thrown check still releases its handles', () => {
    const finallyBlock = source.match(/\}\s*finally\s*\{([\s\S]*?)\n\s*\}/);
    expect(finallyBlock, 'no finally block in main()').not.toBeNull();
    expect(finallyBlock![1]).toMatch(/closeAllQueues/);
    expect(finallyBlock![1]).toMatch(/disconnect\(\)/);
  });

  it('exits on both outcomes, not only on failure', () => {
    // The defect in one line: the only `process.exit` reachable on success was absent, so
    // success hung. A bare `process.exit(1)` in a catch is not enough.
    expect(source).toMatch(/process\.exit\(\s*completed\s*\?\s*0\s*:\s*1\s*\)/);
  });

  it('cleans up before it exits', () => {
    const cleanup = source.indexOf('closeAllQueues');
    const exit = source.indexOf('process.exit(completed');
    expect(cleanup).toBeGreaterThan(-1);
    expect(exit).toBeGreaterThan(-1);
    expect(cleanup).toBeLessThan(exit);
  });
});

describe('the worker runners spawn without a shell (TEL-P1-048)', () => {
  const runners = ['scripts/worker-dev.cjs', 'scripts/worker-start.cjs'];

  it.each(runners)('%s does not spawn through a shell', (file) => {
    // `shell: true` concatenates arguments instead of escaping them, so any path containing a
    // shell metacharacter — `&`, and this checkout has one — is re-parsed and broken up.
    expect(code(file)).not.toMatch(/shell:\s*true/);
  });

  it.each(runners)('%s does not shell out to npx', (file) => {
    // `npx tsx` downloads tsx when it cannot resolve it, so the runner can execute a different
    // version from the one package-lock.json pins, with no record that it did.
    expect(code(file)).not.toMatch(/['"`]npx['"`]/);
  });

  it.each(runners)('%s resolves tsx from node_modules and runs it with this node', (file) => {
    const source = code(file);
    expect(source).toMatch(/require\.resolve\(\s*['"`]tsx\/cli['"`]\s*\)/);
    expect(source).toMatch(/spawn\(\s*(?:command|process\.execPath)/);
  });

  it.each(runners)('%s fails closed when tsx is missing rather than fetching it', (file) => {
    const source = code(file);
    expect(source).toMatch(/catch\s*\{[\s\S]*?process\.exit\(1\)/);
  });

  it('worker-dev passes the entry path as its own argument, never interpolated into a command', () => {
    const source = code('scripts/worker-dev.cjs');
    // The non-watch path is the one `npm run worker:dev` uses, and it must be an argv array.
    expect(source).toMatch(/args\s*=\s*\[\s*tsxCli\s*,\s*workerEntry\s*\]/);
  });
});
