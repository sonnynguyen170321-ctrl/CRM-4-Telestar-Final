import { describe, it, expect } from 'vitest';

/**
 * The uniqueness guarantees that exist in the database but not in `schema.prisma`.
 *
 * Postgres partial unique indexes have no Prisma syntax, so four constraints this application
 * genuinely depends on are invisible to the schema file:
 *
 *   lead_normalized_email_unique      (tenantId, campaignId, normalizedEmail) WHERE NOT NULL
 *   suppression_email_scope_unique    (tenantId, email,   COALESCE(campaignId,''))
 *   suppression_domain_scope_unique   (tenantId, domain,  COALESCE(campaignId,''))
 *   suppression_company_scope_unique  (tenantId, company, COALESCE(campaignId,''))
 *
 * They are load-bearing, not decorative. `workers/import.ts` creates a lead and catches `P2002`
 * to converge when two workers are handed the same row — `tests/import-fault-injection.test.ts`
 * drives that race and asserts exactly one lead survives. Without the index the create simply
 * succeeds twice and the race silently produces two leads.
 *
 * The risk is not hypothetical. `prisma migrate dev` diffs the database against `schema.prisma`,
 * sees an index the schema does not describe, and proposes dropping it. That has already half
 * happened once: `20260803010000_reconcile_schema_drift` added a *plain* unique index on
 * SuppressionEntry alongside the hand-written `COALESCE` one. The plain index treats two NULL
 * campaignIds as distinct, so it does not catch the duplicate the original was written to
 * catch; both now sit in the database and only one of them is in the schema.
 *
 * So this test is the thing standing between a routine migration and the quiet loss of a
 * concurrency guarantee. If it fails, do not delete it — restore the index.
 */

const { prisma } = await import('@/lib/prisma');

let hasDb = false;
try {
  if (process.env.DATABASE_URL) {
    await prisma.$queryRaw`SELECT 1`;
    hasDb = true;
  }
} catch {
  hasDb = false;
}

/** Each one, with what it actually protects and what breaks without it. */
const REQUIRED = [
  {
    name: 'lead_normalized_email_unique',
    table: 'Lead',
    protects:
      'two concurrent imports of the same row creating two leads — workers/import.ts relies on ' +
      'the P2002 this raises',
  },
  {
    name: 'suppression_email_scope_unique',
    table: 'SuppressionEntry',
    protects:
      'the same address being suppressed twice at tenant scope; the COALESCE is what makes two ' +
      'NULL campaignIds collide, which the plain schema-level unique index does not',
  },
  {
    name: 'suppression_domain_scope_unique',
    table: 'SuppressionEntry',
    protects: 'the same domain being suppressed twice at tenant scope',
  },
  {
    name: 'suppression_company_scope_unique',
    table: 'SuppressionEntry',
    protects: 'the same company being suppressed twice at tenant scope',
  },
  {
    name: 'telephony_number_overall_default_unique',
    table: 'TelephonyNumber',
    protects: 'two overall-default caller IDs for one team, so a call would show whichever the query met first',
  },
  {
    name: 'telephony_number_country_default_unique',
    table: 'TelephonyNumber',
    protects: 'two default caller IDs for one country of one team',
  },
] as const;

describe.skipIf(!hasDb)('partial unique indexes that schema.prisma cannot express', () => {
  it('all four still exist in the database', async () => {
    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()
    `;
    const present = new Set(rows.map((r) => r.indexname));

    const missing = REQUIRED.filter((r) => !present.has(r.name));

    expect(
      missing.map((m) => `${m.name} on "${m.table}" — without it: ${m.protects}`),
      'a migration has dropped a uniqueness guarantee the application still relies on. ' +
        'Prisma cannot see these indexes, so `migrate dev` proposes removing them. Restore the ' +
        'index rather than deleting this test.'
    ).toEqual([]);
  });

  it('each one is unique and partial, not merely present', async () => {
    // A migration that recreated these as plain indexes would leave the names in place while
    // removing the guarantee — the failure would look exactly like success.
    const rows = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname IN (
          'lead_normalized_email_unique',
          'suppression_email_scope_unique',
          'suppression_domain_scope_unique',
          'suppression_company_scope_unique',
          'telephony_number_overall_default_unique',
          'telephony_number_country_default_unique'
        )
    `;

    for (const row of rows) {
      expect(row.indexdef, `${row.indexname} is no longer UNIQUE`).toMatch(/CREATE UNIQUE INDEX/i);
      // Either a WHERE clause (Lead) or a COALESCE expression (SuppressionEntry) — both are the
      // part Prisma cannot express, and both are the part that does the work.
      expect(
        /WHERE|COALESCE/i.test(row.indexdef),
        `${row.indexname} lost the predicate that made it meaningful: ${row.indexdef}`
      ).toBe(true);
    }
  });

  it('the Lead index ignores rows with a null normalizedEmail', async () => {
    // The null is deliberate — `forceDuplicateLead` uses it so an intentional duplicate can
    // exist. The index has to permit that, or importing a known duplicate would fail outright.
    const [row] = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = current_schema() AND indexname = 'lead_normalized_email_unique'
    `;
    expect(row?.indexdef).toMatch(/WHERE \(?"?normalizedEmail"? IS NOT NULL\)?/i);
  });
});
