import { existsSync, readFileSync } from 'node:fs';

/**
 * Count what a Playwright run actually did.
 *
 * The ladder computed `mandatorySkips` from Vitest and the Redis suite only, so Playwright skips
 * were invisible to it. Playwright exits 0 when tests are skipped, and the gates were recorded
 * from the exit code alone — so a run with 16 skipped browser tests reported
 * `mandatorySkips: 0`, and the validator's check K ("final runs require zero") passed on it.
 *
 * The project's reporter is `list`, which produces nothing machine-readable at all, so there was
 * no artifact to count even if someone had wanted to. The ladder now asks for a JSON report on
 * the certification path only, leaving CI and local runs as they were (TEL-P1-035).
 *
 * `skipped` is the number that matters for release, but `flaky`, `timedOut` and `interrupted`
 * are counted too: each is a result that is neither a pass nor an honest failure, and a
 * certification that cannot see them cannot claim a clean run.
 */

const EMPTY = {
  parsed: false,
  /** Why the report could not be read. `null` when it was read fine. */
  reason: null,
  total: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
  flaky: 0,
  timedOut: 0,
  interrupted: 0,
};

/** Walk the suite tree, because `stats` alone does not distinguish timedOut or interrupted. */
function walkSpecs(suites, visit) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) visit(test);
    }
    walkSpecs(suite.suites, visit);
  }
}

export function parsePlaywrightReport(reportPath) {
  if (!reportPath || !existsSync(reportPath)) return { ...EMPTY, reason: 'no report file' };

  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch (error) {
    return { ...EMPTY, reason: `report is not JSON: ${String(error)}` };
  }

  const counts = { ...EMPTY, parsed: true };

  walkSpecs(report.suites, (test) => {
    counts.total += 1;
    // `test.status` is Playwright's verdict for the test across its retries.
    switch (test.status) {
      case 'expected':
        counts.passed += 1;
        break;
      case 'skipped':
        counts.skipped += 1;
        break;
      case 'flaky':
        counts.flaky += 1;
        break;
      default:
        counts.failed += 1;
    }
    // A timeout or an interruption is recorded on the individual result, not the verdict.
    for (const result of test.results ?? []) {
      if (result.status === 'timedOut') counts.timedOut += 1;
      if (result.status === 'interrupted') counts.interrupted += 1;
    }
  });

  return counts;
}

/**
 * Results that are neither a pass nor an honest failure. Any of them above zero means the run
 * cannot be described as clean, whatever the exit code said.
 */
export function unaccountedResults(counts) {
  return counts.skipped + counts.flaky + counts.timedOut + counts.interrupted;
}

export function describePlaywright(counts) {
  if (!counts.parsed) return `not parsed (${counts.reason ?? 'unknown'})`;
  return (
    `${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped, ` +
    `${counts.flaky} flaky, ${counts.timedOut} timed out, ${counts.interrupted} interrupted`
  );
}
