import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { splitSearchTerms } from './terms';

/**
 * Accent-insensitive id lookup, used as a pre-filter for list queries.
 *
 * Prisma cannot express `unaccent()` inside `contains`, and rewriting the whole list
 * query in raw SQL would drag pagination, filters and tenant scoping along with it.
 * So the search resolves matching ids here in one statement, and the caller feeds
 * `id: { in: [...] }` into the Prisma `where` it already builds. Everything else about
 * those queries is untouched.
 *
 * Both sides are folded via `immutable_unaccent` (see the 20260804000000 migration), so
 * "Giam" matches "Giám" and "Nguyen Hai" matches "Nguyễn Hải" — folding only the query
 * could never do that.
 *
 * Every term must match at least one column, matching the AND-per-term semantics of
 * `buildTermClauses`.
 */
export async function findAccentInsensitiveIds(
  table: 'Lead' | 'LeadPoolItem',
  columns: readonly string[],
  search: string | undefined,
  tenantId?: string
): Promise<string[] | null> {
  const terms = splitSearchTerms(search);
  if (terms.length === 0) return null;

  // Identifiers are from a fixed allowlist above, never user input.
  const tableRef = Prisma.raw(`"${table}"`);

  const perTerm = terms.map((term) => {
    const pattern = `%${term}%`;
    const anyColumn = Prisma.join(
      columns.map(
        (col) =>
          Prisma.sql`immutable_unaccent(lower(coalesce(${Prisma.raw(`"${col}"`)}, ''))) LIKE immutable_unaccent(lower(${pattern}))`
      ),
      ' OR '
    );
    return Prisma.sql`(${anyColumn})`;
  });

  const where = Prisma.join(perTerm, ' AND ');
  const tenantClause = tenantId ? Prisma.sql`"tenantId" = ${tenantId} AND ` : Prisma.empty;

  const rows = await prisma.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM ${tableRef} WHERE ${tenantClause}${where} LIMIT 5000`
  );

  return rows.map((r) => r.id);
}

export const LEAD_SEARCH_COLUMNS = ['firstName', 'lastName', 'company', 'title', 'email'] as const;
export const POOL_SEARCH_COLUMNS = [
  'firstName',
  'lastName',
  'fullName',
  'company',
  'title',
  'email',
  'sourceName',
] as const;
