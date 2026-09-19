/**
 * Every API route is written down, and every route that writes has a net or a reason.
 *
 * The bugs that keep reaching production are not exotic. `POST /api/sequences` 500'd on every call
 * for as long as it existed, because nothing tested it. The inbox read and wrote across the whole
 * company because `e2e/roles/role-negative-access.spec.ts` — which exists precisely to check that
 * "UI and API agree" — covers `/admin`, the lead pool and import/export, and nothing said which
 * routes it did not reach. The hole was invisible, so no amount of re-auditing found it.
 *
 * This file is the thing that survives someone forgetting. It cannot judge whether a test is any
 * good; it can refuse to let a new mutating route appear with nothing pointed at it, and it can
 * keep the count of known-uncovered routes visible instead of unknown.
 *
 * Regenerate the manifest after adding or moving a route:
 *
 *     node scripts/certification/render-route-coverage.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const MANIFEST_PATH = join(ROOT, '.agent', 'registry', 'route-coverage.yaml');
const MUTATING = ['POST', 'PATCH', 'PUT', 'DELETE'];

/**
 * The count of mutating routes with no test, as of the day this gate was added. It may fall and
 * must never rise: a new route arriving with nothing pointed at it is the failure this exists to
 * catch. Lower it when you cover one — that is the burn-down.
 */
const UNCOVERED_BUDGET = 26;

interface ManifestRow {
  path: string;
  methods: string[];
  tests: string[];
  reason: string | null;
}

function parseManifest(text: string): ManifestRow[] {
  const rows: ManifestRow[] = [];
  let current: ManifestRow | null = null;
  let inTests = false;

  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('#') || line.trim() === '' || line.trim() === 'routes:') continue;

    const path = line.match(/^\s*-\s+path:\s+(\S+)/);
    if (path) {
      if (current) rows.push(current);
      current = { path: path[1], methods: [], tests: [], reason: null };
      inTests = false;
      continue;
    }
    if (!current) continue;

    const methods = line.match(/^\s*methods:\s*\[([^\]]*)\]/);
    if (methods) {
      current.methods = methods[1].split(',').map((m) => m.trim()).filter(Boolean);
      inTests = false;
      continue;
    }
    if (/^\s*tests:\s*\[\]/.test(line)) { inTests = false; continue; }
    if (/^\s*tests:\s*$/.test(line)) { inTests = true; continue; }
    const reason = line.match(/^\s*reason:\s+(.+)$/);
    if (reason) { current.reason = reason[1].trim(); inTests = false; continue; }
    const item = line.match(/^\s*-\s+(\S+)$/);
    if (item && inTests) current.tests.push(item[1]);
  }
  if (current) rows.push(current);
  return rows;
}

function routeFilesOnDisk(dir = join(ROOT, 'app', 'api'), out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) routeFilesOnDisk(full, out);
    else if (entry === 'route.ts') out.push(relative(ROOT, full).split(sep).join('/'));
  }
  return out.sort();
}

const manifest = parseManifest(readFileSync(MANIFEST_PATH, 'utf8'));
const onDisk = routeFilesOnDisk();
const byPath = new Map(manifest.map((r) => [r.path, r]));

describe('the route inventory matches the filesystem', () => {
  it('lists every route that exists', () => {
    const missing = onDisk.filter((p) => !byPath.has(p));
    expect(
      missing,
      'new routes must be added to the inventory — run node scripts/certification/render-route-coverage.mjs'
    ).toEqual([]);
  });

  it('lists no route that has been deleted or moved', () => {
    const diskSet = new Set(onDisk);
    const stale = manifest.map((r) => r.path).filter((p) => !diskSet.has(p));
    expect(stale, 'the inventory has entries for routes that no longer exist — regenerate it').toEqual([]);
  });

  it('records the methods each route actually exports', () => {
    // A route that grows a POST is a route that grew a way to change data. The inventory has to
    // notice, or a mutating handler hides behind a read-only entry.
    const drifted: string[] = [];
    for (const row of manifest) {
      if (!existsSync(join(ROOT, row.path))) continue;
      const source = readFileSync(join(ROOT, row.path), 'utf8');
      for (const method of [...MUTATING, 'GET']) {
        const exported =
          new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b`).test(source) ||
          new RegExp(`export\\s+const\\s+${method}\\b`).test(source);
        if (exported !== row.methods.includes(method)) drifted.push(`${row.path}: ${method}`);
      }
    }
    expect(drifted, 'regenerate the inventory — exported methods have changed').toEqual([]);
  });
});

describe('every route that writes has a net, or an admission that it does not', () => {
  const mutating = manifest.filter((r) => r.methods.some((m) => MUTATING.includes(m)));

  it('points every covering test at a file that exists', () => {
    const dangling: string[] = [];
    for (const row of manifest) {
      for (const test of row.tests) {
        if (!existsSync(join(ROOT, test))) dangling.push(`${row.path} -> ${test}`);
      }
    }
    expect(dangling, 'a named test file is gone; regenerate the inventory').toEqual([]);
  });

  it('does not let the number of untested mutating routes grow', () => {
    const uncovered = mutating.filter((r) => r.tests.length === 0 && !r.reason);
    expect(
      uncovered.length,
      `mutating routes with neither a test nor a reason:\n${uncovered.map((r) => `  ${r.path}`).join('\n')}`
    ).toBeLessThanOrEqual(UNCOVERED_BUDGET);
  });

  it('keeps the budget honest — lower it once routes are covered', () => {
    // A budget nobody lowers is a budget that stops meaning anything. This fails when the real
    // number drops below the stated one, which is the prompt to write the smaller number down.
    const uncovered = mutating.filter((r) => r.tests.length === 0 && !r.reason);
    expect(
      uncovered.length,
      `only ${uncovered.length} mutating routes are uncovered now — set UNCOVERED_BUDGET to that`
    ).toBe(UNCOVERED_BUDGET);
  });
});
