import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  HEALTH_ENDPOINTS,
  evaluateHealthProbe,
  evaluateHealthGate,
} from '../scripts/certification/lib/healthGate.mjs';
import {
  parsePlaywrightReport,
  unaccountedResults,
} from '../scripts/certification/lib/playwrightReport.mjs';

/**
 * Phase 9 — adversarial review of the certifier itself.
 *
 * Two gates could not fail in ways that mattered:
 *
 *   TEL-P1-034  gate 22 failed only on HTTP >= 500, so 401, 403, 404, a login redirect, a
 *               proxy's HTML page and a server running a completely different release all
 *               passed. Its description claimed it verified release identity; the code never
 *               read `commit`, and was never given the candidate SHA to compare against. It
 *               also probed two endpoints that do not exist and return 404 in production.
 *
 *   TEL-P1-035  Playwright skips were never counted. Playwright exits 0 when tests skip and the
 *               reporter was `list`, which writes nothing machine-readable, so a run with
 *               skipped browser tests reported `mandatorySkips: 0` and satisfied check K.
 *
 * Every test here is a negative one: a way the certifier could have said PASS.
 */

const SHA = 'd'.repeat(40);
const OTHER_SHA = 'e'.repeat(40);

const healthy = (commit = SHA) => JSON.stringify({ ok: true, ts: 1, commit, version: commit });
const probe = (over: Record<string, unknown> = {}) => ({
  endpoint: '/api/health',
  status: 200,
  body: healthy(),
  ...over,
});

describe('health gate — statuses that used to pass', () => {
  // Each of these carries a PERFECTLY VALID healthy body reporting the right commit, so the
  // only thing that can fail them is the status rule. An earlier version used an empty body,
  // which failed JSON parsing regardless — the tests passed while the status rule was mutated
  // away, which is the same false-green they exist to catch.
  it.each([401, 403, 404, 302, 307, 204])('fails on HTTP %i despite a healthy body', (status) => {
    const result = evaluateHealthProbe(probe({ status }), SHA);
    expect(result.ok).toBe(false);
    expect(result.findings.join(' ')).toContain(`expected HTTP 200, got ${status}`);
  });

  it('names why a 404 is not a pass', () => {
    expect(evaluateHealthProbe(probe({ status: 404 }), SHA).findings.join(' ')).toContain(
      'does not exist',
    );
  });

  it('names why a 401 is not a pass', () => {
    expect(evaluateHealthProbe(probe({ status: 401 }), SHA).findings.join(' ')).toContain(
      'proves nothing about the release',
    );
  });

  it('names a redirect as a probable login page', () => {
    expect(evaluateHealthProbe(probe({ status: 302 }), SHA).findings.join(' ')).toContain(
      'login page',
    );
  });

  it('still fails on 500', () => {
    expect(evaluateHealthProbe(probe({ status: 500 }), SHA).ok).toBe(false);
  });

  it('passes on exactly 200', () => {
    expect(evaluateHealthProbe(probe(), SHA).ok).toBe(true);
  });
});

describe('health gate — bodies that used to pass', () => {
  it('fails on a proxy HTML page served with 200', () => {
    const result = evaluateHealthProbe(
      probe({ body: '<html><body>502 Bad Gateway</body></html>' }),
      SHA,
    );
    expect(result.ok).toBe(false);
    expect(result.findings.join(' ')).toContain('not JSON');
  });

  it('fails on JSON that is not an object', () => {
    expect(evaluateHealthProbe(probe({ body: '"ok"' }), SHA).ok).toBe(false);
    expect(evaluateHealthProbe(probe({ body: 'null' }), SHA).ok).toBe(false);
  });

  it('fails when ok is false, quoting the reason', () => {
    const body = JSON.stringify({ ok: false, reason: 'pending_migrations', commit: SHA });
    const result = evaluateHealthProbe(probe({ body }), SHA);
    expect(result.ok).toBe(false);
    expect(result.findings.join(' ')).toContain('pending_migrations');
  });

  it('fails when the response carries no commit', () => {
    const result = evaluateHealthProbe(probe({ body: JSON.stringify({ ok: true }) }), SHA);
    expect(result.ok).toBe(false);
    expect(result.findings.join(' ')).toContain('cannot be identified');
  });
});

describe('health gate — the release identity it claimed to check', () => {
  it('fails when a perfectly healthy server runs a different release', () => {
    // The defect that mattered most: everything green, wrong bytes.
    const result = evaluateHealthProbe(probe({ body: healthy(OTHER_SHA) }), SHA);
    expect(result.ok).toBe(false);
    expect(result.findings.join(' ')).toContain('expected the candidate');
  });

  it('fails when there is no candidate SHA to compare against', () => {
    // A gate that cannot identify the release must not pass by default.
    expect(evaluateHealthGate([probe()], '').ok).toBe(false);
    expect(evaluateHealthGate([probe()], undefined).ok).toBe(false);
  });

  it('fails when nothing was probed at all', () => {
    const result = evaluateHealthGate([], SHA);
    expect(result.ok).toBe(false);
    expect(result.findings.join(' ')).toContain('no health endpoint was probed');
  });

  it('fails the whole gate when any single endpoint fails', () => {
    const result = evaluateHealthGate(
      [probe(), probe({ endpoint: '/api/health/db', status: 404, body: '' })],
      SHA,
    );
    expect(result.ok).toBe(false);
  });

  it('only probes endpoints that exist', () => {
    // /api/health/db and /api/health/redis 404 in production and always have.
    expect(HEALTH_ENDPOINTS).toEqual(['/api/health']);
  });

  it('passes a genuinely healthy candidate', () => {
    expect(evaluateHealthGate([probe()], SHA).ok).toBe(true);
  });
});

describe('playwright accounting — outcomes that used to be invisible', () => {
  const dirs: string[] = [];
  const reportWith = (tests: Array<Record<string, unknown>>) => {
    const dir = mkdtempSync(join(tmpdir(), 'pw-report-'));
    dirs.push(dir);
    const file = join(dir, 'report.json');
    writeFileSync(
      file,
      JSON.stringify({ suites: [{ specs: tests.map((t) => ({ tests: [t] })) }] }),
    );
    return file;
  };

  const expected = { status: 'expected', results: [{ status: 'passed' }] };

  it('counts a clean run as clean', () => {
    const counts = parsePlaywrightReport(reportWith([expected, expected]));
    expect(counts.passed).toBe(2);
    expect(unaccountedResults(counts)).toBe(0);
  });

  it('counts skipped tests, which the ladder never saw', () => {
    const counts = parsePlaywrightReport(
      reportWith([expected, { status: 'skipped', results: [{ status: 'skipped' }] }]),
    );
    expect(counts.skipped).toBe(1);
    expect(unaccountedResults(counts)).toBe(1);
  });

  it('counts flaky tests as unaccounted', () => {
    const counts = parsePlaywrightReport(
      reportWith([{ status: 'flaky', results: [{ status: 'failed' }, { status: 'passed' }] }]),
    );
    expect(counts.flaky).toBe(1);
    expect(unaccountedResults(counts)).toBe(1);
  });

  it('counts timed-out and interrupted results', () => {
    const counts = parsePlaywrightReport(
      reportWith([
        { status: 'unexpected', results: [{ status: 'timedOut' }] },
        { status: 'unexpected', results: [{ status: 'interrupted' }] },
      ]),
    );
    expect(counts.timedOut).toBe(1);
    expect(counts.interrupted).toBe(1);
    expect(unaccountedResults(counts)).toBe(2);
  });

  it('counts failures', () => {
    const counts = parsePlaywrightReport(
      reportWith([{ status: 'unexpected', results: [{ status: 'failed' }] }]),
    );
    expect(counts.failed).toBe(1);
  });

  it('reports not-parsed rather than zero when the report is missing', () => {
    // Absent evidence must never read as a clean run.
    const counts = parsePlaywrightReport(join(tmpdir(), 'definitely-not-here.json'));
    expect(counts.parsed).toBe(false);
    expect(counts.reason).toBeTruthy();
  });

  it('reports not-parsed on a malformed report', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pw-bad-'));
    dirs.push(dir);
    const file = join(dir, 'report.json');
    writeFileSync(file, 'not json at all');
    expect(parsePlaywrightReport(file).parsed).toBe(false);
  });

  it('walks nested suites', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pw-nested-'));
    dirs.push(dir);
    const file = join(dir, 'report.json');
    writeFileSync(
      file,
      JSON.stringify({
        suites: [{ suites: [{ specs: [{ tests: [{ status: 'skipped', results: [] }] }] }] }],
      }),
    );
    expect(parsePlaywrightReport(file).skipped).toBe(1);
  });

  it('cleans up its fixtures', () => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    expect(true).toBe(true);
  });
});

describe('the ladder wires both corrections', () => {
  const runner = readFileSync(
    join(process.cwd(), 'scripts', 'certification', 'run-full-certification.mjs'),
    'utf8',
  );

  it('gives the health gate the candidate SHA', () => {
    expect(runner).toContain('gateHealthSmoke(runLabel, candidateSha)');
  });

  it('no longer passes health on anything under 500', () => {
    expect(runner).not.toContain('if (response.status >= 500) ok = false;');
  });

  it('writes the health log to the path it records', () => {
    // These were two different paths, so the recorded artifact did not exist and each run
    // overwrote the previous run's log.
    const gate = runner.slice(runner.indexOf('async function gateHealthSmoke'));
    expect(gate).toContain('const logPath = path.join(RAW_DIR, `${runLabel}-22-health-smoke.log`)');
    expect(gate).not.toContain("path.join(RAW_DIR, 'gate-22-health-smoke.log')");
  });

  it('asks Playwright for a machine-readable report', () => {
    expect(runner).toContain('PLAYWRIGHT_JSON_OUTPUT_NAME');
    expect(runner).toContain("'--reporter=list,json'");
  });

  it('adds Playwright outcomes to the mandatory skip count', () => {
    expect(runner).toContain('playwrightUnaccounted');
    expect(runner).toMatch(/mandatorySkips[\s\S]{0,200}playwrightUnaccounted/);
  });

  it('fails a Playwright gate that exited 0 while skipping tests', () => {
    expect(runner).toMatch(/gate\.status === 'PASS' && counts\.parsed && unaccounted === 0/);
  });

  it('gives the locally started server the candidate identity', () => {
    // Gate 22 requires health to report the candidate commit. APP_COMMIT is baked into the
    // image by --build-arg, and `next build` here does not do that, so the local server
    // reported "unknown" and the gate could never pass locally — measured on run 1.
    expect(runner).toContain('APP_COMMIT: candidateSha');
    // The call site passes it through; the callback body between them is long, so match the
    // closing argument rather than trying to span the whole block.
    expect(runner).toContain('}, { candidateSha });');
  });

  it('records why supplying that identity is not circular', () => {
    // If this reasoning is ever lost, someone will reasonably mistake gate 22 for
    // self-certification and either delete it or trust it too far.
    //
    // Scoped to the whole function rather than its first N characters. The original
    // `slice(0, 1400)` broke the moment the port-ownership guard (TEL-P1-039) was added ahead
    // of the comment — a test that fails because an unrelated fix landed above it is measuring
    // character offsets, not the thing it claims to protect.
    const start = runner.indexOf('async function withServer');
    const end = runner.indexOf('async function withWorker');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(runner.slice(start, end)).toContain('EV-RELEASE-IDENTITY');
  });
});
