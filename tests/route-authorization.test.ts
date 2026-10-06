import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every route that writes either checks the caller may touch *that record*, or says in writing why
 * it does not need to.
 *
 * `tests/route-coverage.test.ts` already asks whether a mutating route has a test. That is a
 * different question, and the difference is the reason this file exists.
 *
 * Four sequence-enrollment routes checked `requireAuth()` and `enrollment.tenantId !==
 * user.tenantId`, and nothing else. `run-now` forces an immediate provider send from the lead
 * owner's mailbox, so any sdr could fire an unscheduled email at any colleague's prospect;
 * `bulk-action` did it to a list at a time behind `requireRole('sdr')`, which is the floor of the
 * hierarchy and therefore admits everyone. Those routes **had tests**: their fixture lead was
 * `assignedToId: user.id`, so the caller always owned the record under test. Coverage was green,
 * authorization was absent, and every other gate in this repo agreed the code was fine.
 *
 * So this gate asks the question those tests could not: is there anything here about *whose* record
 * this is. A listed guard proves somebody thought about it, never that they got it right — a check
 * that tried to judge correctness would be wrong often enough to be switched off, and a gate that
 * gets switched off protects nothing.
 *
 * Regenerate after adding or moving a route:
 *
 *     node scripts/certification/render-route-authorization.mjs
 */

const ROOT = process.cwd();
const MANIFEST_PATH = join(ROOT, '.agent', 'registry', 'route-authorization.yaml');
const MUTATING = ['POST', 'PATCH', 'PUT', 'DELETE'];

interface Row {
  path: string;
  methods: string[];
  guards: string[];
  reason: string | null;
}

/** The manifest is a fixed shape this renderer emits, so it is read directly rather than via a YAML dep. */
function parseManifest(text: string): Row[] {
  const rows: Row[] = [];
  let current: Row | null = null;
  let inGuards = false;

  // Split on either line ending. Git checks this manifest out with CRLF on Windows, and JavaScript's
  // `.` does not match `\r` — it is a line terminator — so `/^\s*-\s+(.+)$/` matched nothing and every
  // route parsed as having no guard at all. The gate was written against a freshly generated LF file
  // and only broke once the committed copy came back through git, which is exactly the way a gate
  // ends up protecting nothing. It failed closed rather than open, which is the one mercy here.
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trimStart().startsWith('#') || raw.trim() === '') continue;

    const path = raw.match(/^\s*-\s+path:\s+(\S+)/);
    if (path) {
      if (current) rows.push(current);
      current = { path: path[1], methods: [], guards: [], reason: null };
      inGuards = false;
      continue;
    }
    if (!current) continue;

    const methods = raw.match(/^\s*methods:\s*\[(.*)\]\s*$/);
    if (methods) {
      current.methods = methods[1].split(',').map((m) => m.trim()).filter(Boolean);
      inGuards = false;
      continue;
    }
    if (/^\s*guards:\s*\[\]\s*$/.test(raw)) {
      inGuards = false;
      continue;
    }
    if (/^\s*guards:\s*$/.test(raw)) {
      inGuards = true;
      continue;
    }
    const reason = raw.match(/^\s*reason:\s+(.+)$/);
    if (reason) {
      current.reason = reason[1].trim();
      inGuards = false;
      continue;
    }
    const item = raw.match(/^\s*-\s+(.+)$/);
    if (item && inGuards) current.guards.push(item[1].trim());
  }
  if (current) rows.push(current);
  return rows;
}

const manifest = existsSync(MANIFEST_PATH) ? parseManifest(readFileSync(MANIFEST_PATH, 'utf8')) : [];

describe('every route that writes has an ownership check or a written reason', () => {
  const mutating = manifest.filter((r) => r.methods.some((m) => MUTATING.includes(m)));

  it('has a manifest to check at all', () => {
    expect(
      existsSync(MANIFEST_PATH),
      'run node scripts/certification/render-route-authorization.mjs'
    ).toBe(true);
    // A parser that silently returned nothing would make every assertion below vacuously true.
    expect(mutating.length).toBeGreaterThan(50);
  });

  /**
   * The count of mutating routes with neither a per-record check nor a written reason, as of the day
   * this gate was added. It may fall and must never rise.
   *
   * This is a review queue, not a list of 47 bugs. Most of these are role-gated routes acting on
   * records that have no owner column to check — an ICP version, a pool item before conversion, a
   * research run — and each needs a human to look once and write down which. That judgement is the
   * one thing a scan cannot produce, and a reason invented to clear a number would defeat the point:
   * the four routes this gate was built for would each have been waved through by "internal".
   *
   * Lower it when you reason one away. That is the burn-down.
   */
  const UNEXPLAINED_BUDGET = 40;

  it('does not let the number of unexplained mutating routes grow', () => {
    const unexplained = mutating.filter((r) => r.guards.length === 0 && !r.reason);
    expect(
      unexplained.length,
      'a new mutating route has no per-record authorization and no written reason. Either add the ' +
        'check, or add a `reason:` to .agent/registry/route-authorization.yaml saying why this route ' +
        `does not need one — and mean it:\n${unexplained.map((r) => `  ${r.path}`).join('\n')}`
    ).toBeLessThanOrEqual(UNEXPLAINED_BUDGET);
  });

  it('keeps the budget honest — lower it once a route is reasoned away', () => {
    // A budget nobody lowers stops meaning anything. This fails when the real number drops below the
    // stated one, which is the prompt to write the smaller number down.
    const unexplained = mutating.filter((r) => r.guards.length === 0 && !r.reason);
    expect(
      unexplained.length,
      `only ${unexplained.length} mutating routes are unexplained now — set UNEXPLAINED_BUDGET to that`
    ).toBe(UNEXPLAINED_BUDGET);
  });

  it('keeps the reasons meaningful rather than a rubber stamp', () => {
    // A one-word reason is a way of passing the gate without answering it. The four routes this was
    // built for would each have been trivially waved through by "internal" or "n/a".
    const thin = mutating
      .filter((r) => r.reason && r.reason.replace(/[^a-z ]/gi, '').trim().split(/\s+/).length < 8)
      .map((r) => `${r.path}: ${r.reason}`);
    expect(thin, 'these reasons are too short to be a judgement; say what makes the route safe').toEqual(
      []
    );
  });

  it('names the sequence-enrollment routes as guarded, since they are what this gate is for', () => {
    // The regression this file exists to prevent. If any of these four loses `canAccessLead`, the
    // manifest stops listing a guard for it and the previous assertion fails — but naming them here
    // makes the intent legible to whoever reads the failure.
    const watched = [
      'app/api/sequences/[id]/enrollments/[enrollmentId]/run-now/route.ts',
      'app/api/sequences/[id]/enrollments/[enrollmentId]/status/route.ts',
      'app/api/sequences/[id]/enrollments/[enrollmentId]/logs/route.ts',
      'app/api/sequences/[id]/enrollments/bulk-action/route.ts',
    ];
    for (const path of watched) {
      const row = manifest.find((r) => r.path === path);
      expect(row, `${path} is missing from the manifest — regenerate it`).toBeDefined();
      expect(row!.guards, `${path} lost its per-record authorization check`).not.toEqual([]);
    }
  });

  it('matches the filesystem, so a new route cannot hide from it', () => {
    // Same reasoning as the route-coverage gate: an inventory nobody regenerates is an inventory
    // that stops describing the code, and the first route to slip through is the one that matters.
    const listed = new Set(manifest.map((r) => r.path));
    const onDisk: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry === 'route.ts') {
          onDisk.push(full.slice(ROOT.length + 1).split(/[\\/]/).join('/'));
        }
      }
    };
    walk(join(ROOT, 'app', 'api'));

    const missing = onDisk.filter((p) => !listed.has(p));
    expect(
      missing,
      'new routes must be added to the inventory — run node scripts/certification/render-route-authorization.mjs'
    ).toEqual([]);
  });
});
