/**
 * Every repair the worker can run is a repair the scheduler actually runs.
 *
 * The sweep has two halves that have to name the same set: `REPAIR_FN` in
 * `workers/maintenance.ts` maps a name to the function, and `DEFAULT_TYPES` in
 * `app/api/cron/maintenance/route.ts` decides what the nightly job asks for. Nothing connected
 * them, and they drifted: `enrollment-schedule-drift` and `stale-pending-outbound` were
 * written, registered and left out of the array. Because `KNOWN_TYPES` is derived from
 * `DEFAULT_TYPES`, the route also rejected them as unknown when asked for by hand — so two
 * repairs existed, passed their own tests, and had never once run in production.
 *
 * That is the same shape as the bugs this sweep is meant to catch: a mechanism that reports
 * itself present while doing nothing. A registered repair that the scheduler never calls is
 * worse than a missing one, because the missing one is visible.
 *
 * Read as source rather than imported: `workers/maintenance.ts` opens Redis connections at
 * module scope, and the route pulls in the Next request stack. The two lists are plain string
 * literals, and comparing them is the whole point.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const worker = readFileSync(join(process.cwd(), 'workers', 'maintenance.ts'), 'utf8');
const route = readFileSync(
  join(process.cwd(), 'app', 'api', 'cron', 'maintenance', 'route.ts'),
  'utf8'
);
const types = readFileSync(join(process.cwd(), 'lib', 'bullmq', 'types.ts'), 'utf8');

/** The keys of the `REPAIR_FN` record — what the worker is able to run. */
function registeredRepairs(): string[] {
  const start = worker.indexOf('const REPAIR_FN');
  expect(start, 'REPAIR_FN has been renamed — update this test with it').toBeGreaterThan(-1);
  const body = worker.slice(start, worker.indexOf('};', start));
  return [...body.matchAll(/^\s*'([a-z-]+)':/gm)].map((m) => m[1]);
}

/** The entries of `DEFAULT_TYPES` — what the nightly sweep asks for. */
function scheduledRepairs(): string[] {
  const decl = route.indexOf('const DEFAULT_TYPES');
  expect(decl, 'DEFAULT_TYPES has been renamed — update this test with it').toBeGreaterThan(-1);
  // From the `[` that opens the array, so the `['types']` in the type annotation ahead of it
  // is not read as a repair name.
  const start = route.indexOf('= [', decl);
  const body = route.slice(start, route.indexOf('];', start));
  return [...body.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
}

/** The union in `MaintenanceRepairPayload` — what a payload is allowed to carry. */
function declaredRepairs(): string[] {
  const start = types.indexOf('export interface MaintenanceRepairPayload');
  const body = types.slice(start, types.indexOf(')[];', start));
  return [...body.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
}

describe('the maintenance repair registry', () => {
  const registered = registeredRepairs();
  const scheduled = scheduledRepairs();
  const declared = declaredRepairs();

  it('finds the three lists at all', () => {
    // A guard on the guard: if any extractor stops matching, every assertion below passes
    // vacuously and this gate quietly stops working.
    expect(registered.length).toBeGreaterThan(5);
    expect(scheduled.length).toBeGreaterThan(5);
    expect(declared.length).toBeGreaterThan(5);
  });

  it('schedules every repair the worker can run', () => {
    const neverRun = registered.filter((name) => !scheduled.includes(name));
    expect(
      neverRun,
      'these repairs exist and the nightly sweep never asks for them — add them to DEFAULT_TYPES or delete them'
    ).toEqual([]);
  });

  it('does not schedule a repair the worker cannot run', () => {
    const noHandler = scheduled.filter((name) => !registered.includes(name));
    expect(
      noHandler,
      'the sweep asks for a repair with no handler — the worker silently skips it'
    ).toEqual([]);
  });

  it('declares every scheduled repair in the payload type', () => {
    const undeclared = scheduled.filter((name) => !declared.includes(name));
    expect(undeclared, 'a scheduled repair missing from MaintenanceRepairPayload').toEqual([]);
  });

  it('keeps the quota repair in the sweep', () => {
    // Named explicitly because it is the one whose absence is invisible: without it a mailbox
    // silently loses send capacity every day and simply stops early. See
    // tests/email-quota-release.test.ts for what it repairs.
    expect(registered).toContain('quota-drift');
    expect(scheduled).toContain('quota-drift');
  });
});
