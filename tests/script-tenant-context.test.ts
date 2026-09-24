import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * A script that reads through the Prisma model API must establish tenant context first.
 *
 * `lib/prisma.ts` is secure by default: with no context and `NODE_ENV=production`, a `findMany`
 * returns `[]` and a `findFirst` returns `null` instead of raising. Correct for a request that
 * lost its session; catastrophic for a script, which then reports what it read — and reads
 * nothing.
 *
 * Measured on production 2026-09-24. `npm run backfill:next-action` printed
 * `Total Evaluated: 0 / Repairs Candidate: 0 / Done.` while 278 enrollments had a null
 * `nextActionAt`. The repair tool reported success having never seen a row, and the same
 * silence was sitting in `production-readiness-audit`, `reconcile-production-db` and
 * `verify-import-worker` — three of the tools whose entire job is to say whether production is
 * healthy. An audit that cannot read returns a clean bill of health.
 *
 * This is a lint, not a runtime check, because the runtime already decided to be quiet. The
 * only place left to catch it is before it ships.
 */

const SCRIPTS_DIR = join(process.cwd(), 'scripts');

/** Model-API reads. Raw SQL does not go through the extension and is not covered here. */
const MODEL_READ = /\bprisma\.[a-zA-Z]+\.(findMany|findFirst|findUnique|findUniqueOrThrow|findFirstOrThrow|count|groupBy|aggregate)\b/;

/** Any of these establishes context, directly or through the shared helpers. */
const ESTABLISHES_CONTEXT = /tenantStorage\.run|forEachTenant|asOperator|withTenantRaw/;

/**
 * Scripts that read through a *library* function rather than calling Prisma themselves, so the
 * regex above cannot see it. Listed by hand because the alternative is following every import.
 */
const READS_VIA_LIBRARY = ['backfill-next-action-at.ts'];

function scriptFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...scriptFiles(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('a script that reads tenant data establishes tenant context', () => {
  it('has no script that would silently read nothing on production', () => {
    const offenders: string[] = [];

    for (const file of scriptFiles(SCRIPTS_DIR)) {
      const src = readFileSync(file, 'utf8');
      const rel = file.slice(process.cwd().length + 1).split('\\').join('/');

      const importsPrisma = /from ['"](@\/lib\/prisma|\.\.\/lib\/prisma|\.\.\/\.\.\/lib\/prisma)['"]/.test(src);
      if (!importsPrisma) continue;

      const reads = MODEL_READ.test(src) || READS_VIA_LIBRARY.some((name) => rel.endsWith(name));
      if (!reads) continue;

      if (!ESTABLISHES_CONTEXT.test(src)) offenders.push(rel);
    }

    expect(
      offenders,
      'these read tenant data with no tenant context, so on production they read nothing and ' +
        'report it as an answer — wrap the work in forEachTenant() or asOperator() from ' +
        'scripts/lib/tenantContext.ts'
    ).toEqual([]);
  });
});
