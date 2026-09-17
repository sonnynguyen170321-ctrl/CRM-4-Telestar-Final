/**
 * Every custom event a button fires has something listening for it.
 *
 * These events are how one surface tells another that its data moved: the New Lead modal fires
 * `crm:lead-created`, the leads list refetches. When nothing listens, the write still happens and
 * the screen still doesn't change — which from the operator's seat is indistinguishable from a
 * button that does nothing. That is what `crm:lead-created` did: `DashboardShell.tsx` dispatched
 * it, no file listened, and creating a lead left the list showing the old page.
 *
 * `CommandPalette` had the same shape earlier with `telestar:open-dialer` — dispatched, never
 * heard. Twice is a pattern, and a pattern is worth a gate rather than another round of reading.
 *
 * This checks wiring, not behaviour: that a listener exists, not that it does the right thing.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
// `lib` too: the dispatcher is not always in the component that owns the button —
// `lib/leads/openLead.ts` fires `crm:open-lead` on behalf of several call sites.
const SOURCE_DIRS = ['app', 'components', 'lib'];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(tsx|ts)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = SOURCE_DIRS.flatMap((d) => sourceFiles(join(ROOT, d))).map((f) => ({
  path: relative(ROOT, f).split(sep).join('/'),
  text: readFileSync(f, 'utf8'),
}));

/** `new CustomEvent('name')` / `new Event('name')`, however it is dispatched. */
const DISPATCH = /new\s+(?:Custom)?Event\(\s*['"`]([^'"`]+)['"`]/g;
const LISTEN = /addEventListener\(\s*['"`]([^'"`]+)['"`]/g;
/** `const OPEN_LEAD_EVENT = 'crm:open-lead'` — a name reached through a constant, not a literal. */
const NAMED_CONSTANT = /const\s+([A-Z][A-Z0-9_]*)\s*=\s*['"`]([^'"`]+:[^'"`]+)['"`]/g;

function collect(re: RegExp): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of files) {
    for (const m of file.text.matchAll(new RegExp(re.source, 'g'))) {
      const name = m[1];
      // Only this app's namespaced events. DOM events (`click`, `keydown`) are the platform's.
      if (!name.includes(':')) continue;
      found.set(name, [...(found.get(name) ?? []), file.path]);
    }
  }
  return found;
}

/**
 * Names reached through a constant. `new CustomEvent(OPEN_LEAD_EVENT)` is a dispatch even though
 * the literal is a file away, and a gate that cannot see it reports a false orphan — which it did,
 * for `crm:open-lead`, the first time this ran.
 */
function viaConstants(kind: 'dispatch' | 'listen'): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const call = kind === 'dispatch' ? /new\s+(?:Custom)?Event\(\s*([A-Z][A-Z0-9_]*)/g : /addEventListener\(\s*([A-Z][A-Z0-9_]*)/g;
  for (const file of files) {
    const names = new Map<string, string>();
    for (const m of file.text.matchAll(NAMED_CONSTANT)) names.set(m[1], m[2]);
    for (const m of file.text.matchAll(call)) {
      const value = names.get(m[1]);
      if (!value || !value.includes(':')) continue;
      found.set(value, [...(found.get(value) ?? []), file.path]);
    }
  }
  return found;
}

function merge(a: Map<string, string[]>, b: Map<string, string[]>): Map<string, string[]> {
  const out = new Map(a);
  for (const [k, v] of b) out.set(k, [...(out.get(k) ?? []), ...v]);
  return out;
}

const dispatched = merge(collect(DISPATCH), viaConstants('dispatch'));
const listened = merge(collect(LISTEN), viaConstants('listen'));

describe('custom event wiring', () => {
  it('finds the events this app dispatches', () => {
    // A guard on the guard: if the dispatch pattern stops matching, every assertion below passes
    // vacuously and the gate quietly stops working.
    expect(dispatched.size).toBeGreaterThan(0);
  });

  it('has a listener for every dispatched event', () => {
    const orphans = [...dispatched.entries()]
      .filter(([name]) => !listened.has(name))
      .map(([name, where]) => `${name} (dispatched in ${where.join(', ')})`);

    expect(
      orphans,
      'a dispatched event nobody hears is a write whose screen never updates — wire it or delete it'
    ).toEqual([]);
  });

  it('does not listen for an event nothing dispatches', () => {
    // The mirror: a listener for a name that no longer exists is dead code that reads as coverage.
    const unheard = [...listened.entries()]
      .filter(([name]) => !dispatched.has(name))
      .map(([name, where]) => `${name} (listened in ${where.join(', ')})`);

    expect(unheard, 'a listener with no dispatcher is dead wiring').toEqual([]);
  });
});
