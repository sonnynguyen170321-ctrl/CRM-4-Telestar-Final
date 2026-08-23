import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * A test that mints a per-run tenant and never deletes it is a leak, and this repository ran
 * one for eleven days.
 *
 * Eleven suites created a tenant in `beforeEach` with a fresh `randomUUID()` and had no
 * teardown at all. Measured on the development database on 2026-08-23: **74,974 tenants and
 * 430,835 leads**, oldest 2026-08-12, **14,041 created in the previous 24 hours**. Telestar is
 * one BPO with one tenant.
 *
 * The cost was not storage. Org-wide aggregates scan all of it, so the admin overview suite
 * began timing out at its 20-second budget — three failures in a full run that then passed
 * 33/33 with the budget raised, which is what a data problem looks like when it is mistaken for
 * a code one. It compounds, and it is shared: every developer on that database pays for it.
 *
 * A fixed-id tenant is fine and common here — 29 suites use one, delete it before creating it,
 * and delete it again afterwards, so nothing accumulates. What cannot be allowed is a *random*
 * id created without registered cleanup, because each run leaves a new row behind for ever.
 * That is the only shape this checks for.
 */

const TEST_DIR = join(process.cwd(), 'tests');

/** Strip comments so prose describing the pattern is not mistaken for the pattern. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function testFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...testFiles(full));
    else if (entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

const offenders = testFiles(TEST_DIR)
  .filter((file) => file !== join(TEST_DIR, 'test-tenant-leak.test.ts'))
  .filter((file) => {
    const source = stripComments(readFileSync(file, 'utf8'));

    // A tenant id built from a random value — the shape that produces a new row every run.
    const mintsRandomTenantId = /tenant[A-Za-z]*\s*=\s*`[^`]*\$\{\s*randomUUID\(\)\s*\}[^`]*`/.test(
      source
    );
    if (!mintsRandomTenantId) return false;

    // Creating it directly rather than through the helper that registers its own cleanup.
    const createsDirectly = /prisma\.tenant\.(create|createMany|upsert)\(/.test(source);
    if (!createsDirectly) return false;

    // ...unless the file removes it itself. Either is a real cleanup.
    const cleansUp =
      /prisma\.tenant\.delete(Many)?\(/.test(source) || /createTestTenant\(/.test(source);
    return !cleansUp;
  })
  .map((file) => file.slice(process.cwd().length + 1));

describe('tests do not leak tenants', () => {
  it('no suite mints a random tenant id without cleaning it up', () => {
    // `createTestTenant` in tests/helpers/testTenant.ts creates and registers the delete
    // together, so the two cannot drift apart. An explicit tenant.delete is equally fine.
    expect(offenders).toEqual([]);
  });

  it('the helper registers cleanup on the test, not on the file', () => {
    // `onTestFinished` matters: these tenants are created per test case in `beforeEach`, so an
    // `afterAll` would leave every tenant but the last. It also registers from inside the hook
    // that creates, which is what let eleven files be fixed without touching their describe
    // nesting — the edit most likely to go wrong.
    const helper = readFileSync(join(TEST_DIR, 'helpers', 'testTenant.ts'), 'utf8');
    expect(helper).toContain('onTestFinished');
    expect(helper).toMatch(/prisma\.tenant\.deleteMany/);
  });
});
