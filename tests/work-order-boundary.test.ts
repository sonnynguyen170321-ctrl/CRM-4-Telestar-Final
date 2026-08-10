import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * The work order client/server boundary (Revenue AI Phase 6b).
 *
 * Phase 6a shipped `lib/workorders/*` with no importer anywhere in the Next application, so its
 * `next build` proved the repository still built and nothing about these modules' bundling.
 * Phase 6b gives them routes and a worker, which is the moment the boundary starts to matter:
 *
 *   - `leases.ts` imports `node:crypto`
 *   - `service.ts`, `conflicts.ts`, `budgets.ts`, `approvals.ts`, `execution.ts` reach Prisma
 *   - `dispatch.ts` reaches BullMQ, and through it `ioredis`
 *
 * Any of those in a Client Component's graph fails `next build` with a wall of
 * "Can't resolve 'async_hooks' / 'dns' / 'net'". **tsc and Vitest both pass while it is broken**
 * — the problem is bundling, not types — which is exactly why this has to be a structural test.
 * Phase 1 of this initiative shipped green on tsc and 820 Vitest tests and still went red in CI
 * for this precise reason.
 *
 * ## Transitive, not direct
 *
 * The check follows the whole import graph rather than looking at each Client Component's own
 * imports. A direct-import test would pass happily on:
 *
 * ```text
 * "use client" panel  →  @/lib/some-helper  →  @/lib/workorders/leases
 * ```
 *
 * which is how this actually breaks in practice — nobody writes the bad import at the top of
 * their component, they inherit it two hops down.
 */

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '.git']);

/**
 * Modules that must never be reachable from a Client Component.
 *
 * `lib/workorders/types.ts` is deliberately absent: it is import-free vocabulary — types,
 * capability sets, budget bounds — and stays client-safe on purpose, the same role
 * `lib/ai/models.ts` plays for the AI layer. Same for `lib/agent/priorities.ts`.
 */
const SERVER_ONLY = [
  'lib/workorders/service.ts',
  'lib/workorders/conflicts.ts',
  'lib/workorders/leases.ts',
  'lib/workorders/budgets.ts',
  'lib/workorders/approvals.ts',
  'lib/workorders/execution.ts',
  'lib/workorders/dispatch.ts',
  'lib/workorders/plan.ts',
  'lib/workorders/authorization.ts',
];

/** Import specifiers that only ever exist server-side, checked on the same graph. */
const SERVER_ONLY_BUILTINS = ['node:crypto', 'bullmq', 'ioredis', '@/lib/prisma'];

function walk(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

const relative = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');

/** Remove comments so prose naming a module is not mistaken for importing it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const IMPORT_RE = /(?:from\s+|require\(|import\()\s*['"]([^'"]+)['"]/g;

/**
 * `import type` / `export type` statements, which TypeScript **erases**.
 *
 * They must not count as edges. `lib/workorders/types.ts` imports `SessionUser` as a type from
 * `lib/agent/capabilities.ts`, which type-imports it from `lib/auth` — and `lib/auth` reaches
 * Prisma and ioredis. Treating that as a real edge reports the client-safe vocabulary module as
 * a bundling hazard, which is precisely the false alarm that gets a structural test deleted.
 */
const TYPE_ONLY_STATEMENT = /\b(?:import|export)\s+type\s+[^;]*?from\s*['"][^'"]+['"]\s*;?/g;

/** `import { type A, type B } from 'x'` — every binding a type, so the import is elided too. */
const ALL_INLINE_TYPE = /\b(?:import|export)\s*\{([^}]*)\}\s*from\s*['"][^'"]+['"]\s*;?/g;

function stripTypeOnlyImports(source: string): string {
  let out = source.replace(TYPE_ONLY_STATEMENT, '');
  out = out.replace(ALL_INLINE_TYPE, (statement, bindings: string) => {
    const parts = bindings
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length === 0) return statement;
    return parts.every((part) => /^type\s/.test(part)) ? '' : statement;
  });
  return out;
}

function importsOf(absFile: string): string[] {
  const source = stripTypeOnlyImports(stripComments(readFileSync(absFile, 'utf8')));
  const found: string[] = [];
  for (const match of source.matchAll(IMPORT_RE)) found.push(match[1]);
  return found;
}

/** Resolve a local specifier to a file on disk, or null for a package. */
function resolveLocal(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else return null;

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

interface Reach {
  /** Server-only files reachable from the entry, with the path that reaches them. */
  offenders: string[];
  visited: number;
}

/** Follow every local import transitively from one entry file. */
function reachableServerOnly(entry: string): Reach {
  const offenders: string[] = [];
  const seen = new Set<string>();
  const stack: { file: string; trail: string[] }[] = [{ file: entry, trail: [relative(entry)] }];

  while (stack.length > 0) {
    const { file, trail } = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    for (const spec of importsOf(file)) {
      if (SERVER_ONLY_BUILTINS.includes(spec) && file !== entry) {
        // Reported against the hop that pulled it in, with the trail that got there.
        offenders.push(`${trail.join(' → ')} → (${spec})`);
        continue;
      }

      const resolved = resolveLocal(spec, file);
      if (!resolved) continue;

      const rel = relative(resolved);
      if (SERVER_ONLY.includes(rel)) {
        offenders.push([...trail, rel].join(' → '));
        continue;
      }
      stack.push({ file: resolved, trail: [...trail, rel] });
    }
  }

  return { offenders, visited: seen.size };
}

function isClientComponent(absFile: string): boolean {
  return /^\s*['"]use client['"]/m.test(readFileSync(absFile, 'utf8'));
}

describe('work order server-only modules stay out of client bundles', () => {
  const uiFiles = [
    ...walk(path.join(ROOT, 'components')),
    ...walk(path.join(ROOT, 'app')),
    ...walk(path.join(ROOT, 'context')),
  ];
  const clientFiles = uiFiles.filter(isClientComponent);

  it('finds Client Components to check (guards against a broken walker)', () => {
    // A walker that silently returned nothing would make every assertion below vacuous — the
    // exact failure mode that makes a structural test worse than no test.
    expect(uiFiles.length).toBeGreaterThan(50);
    expect(clientFiles.length).toBeGreaterThan(10);
  });

  it('every guarded module exists — the list cannot rot into naming nothing', () => {
    for (const rel of SERVER_ONLY) {
      expect(existsSync(path.join(ROOT, rel)), `${rel} is guarded but does not exist`).toBe(true);
    }
  });

  it('no Client Component reaches a work order server-only module, at any depth', () => {
    const offenders: string[] = [];
    for (const file of clientFiles) {
      const { offenders: found } = reachableServerOnly(file);
      offenders.push(...found.filter((trail) => trail.includes('lib/workorders/')));
    }
    expect(offenders).toEqual([]);
  });

  it('proves the walker actually traverses, by reaching a known server-only module from a route', () => {
    // The control. Without it, "no offenders" could mean the resolver silently failed on every
    // specifier and the test above is vacuous. A route that dispatches work orders *must* reach
    // the service, so finding it proves the graph walk works.
    const dispatchRoute = path.join(ROOT, 'app/api/work-orders/[id]/dispatch/route.ts');
    expect(existsSync(dispatchRoute)).toBe(true);

    const { offenders, visited } = reachableServerOnly(dispatchRoute);
    expect(visited).toBeGreaterThan(1);
    expect(offenders.some((trail) => trail.includes('lib/workorders/'))).toBe(true);
  });

  it('keeps the vocabulary modules client-safe', () => {
    // `types.ts` and `priorities.ts` are the client-safe half of the boundary, and they earn it
    // by importing nothing that reaches a runtime. If either grows a Prisma or BullMQ import,
    // every Client Component that reads a work order type or an SLA label breaks at build time.
    for (const rel of ['lib/workorders/types.ts', 'lib/agent/priorities.ts']) {
      const { offenders } = reachableServerOnly(path.join(ROOT, rel));
      expect(offenders, `${rel} must stay client-safe`).toEqual([]);
    }
  });
});
