import { Prisma } from '@prisma/client';
import { prisma, withTenantRaw } from '@/lib/prisma';
import { splitSearchTerms, getTitleSynonyms } from './terms';

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
  const fullSynonyms = getTitleSynonyms(search ?? '');
  const hasTitle = columns.includes('title');

  const perTerm = terms.map((term) => {
    const pattern = `%${term}%`;
    const termSynonyms = getTitleSynonyms(term);

    const anyColumn = Prisma.join(
      columns.map((col) => {
        const baseClause = Prisma.sql`immutable_unaccent(lower(coalesce(${Prisma.raw(`"${col}"`)}, ''))) LIKE immutable_unaccent(lower(${pattern}))`;
        if (col === 'title' && termSynonyms.length > 0) {
          const synClauses = termSynonyms.map(
            (syn) =>
              Prisma.sql`immutable_unaccent(lower(coalesce("title", ''))) LIKE immutable_unaccent(lower(${`%${syn}%`}))`
          );
          return Prisma.sql`(${baseClause} OR ${Prisma.join(synClauses, ' OR ')})`;
        }
        return baseClause;
      }),
      ' OR '
    );
    return Prisma.sql`(${anyColumn})`;
  });

  let where = Prisma.join(perTerm, ' AND ');

  if (fullSynonyms.length > 0 && hasTitle && terms.length > 1) {
    const synClauses = fullSynonyms.map(
      (syn) =>
        Prisma.sql`immutable_unaccent(lower(coalesce("title", ''))) LIKE immutable_unaccent(lower(${`%${syn}%`}))`
    );
    where = Prisma.sql`((${where}) OR (${Prisma.join(synClauses, ' OR ')}))`;
  }

  const tenantClause = tenantId ? Prisma.sql`"tenantId" = ${tenantId} AND ` : Prisma.empty;

  // Raw SQL is outside the tenant extension (see `withTenantRaw` in `lib/prisma.ts`), so under
  // RLS this statement would match no policy and return nothing — and the caller feeds the
  // result straight into `id: { in: [...] }`, so every search would come back empty with no
  // error anywhere.
  //
  // `tenantId` is optional here: callers that already scope their outer query may omit it. With
  // no tenant to set, a cross-tenant bypass is the only thing that would work, and quietly
  // widening a search to every tenant is worse than returning nothing. So the unscoped call
  // keeps today's behaviour and the scoped one gets its context.
  // Built once. Writing it into both arms of the branch below would let a future edit reach one
  // and not the other, and the two would then differ only under RLS — the hardest place to
  // notice.
  const statement = Prisma.sql`SELECT "id" FROM ${tableRef} WHERE ${tenantClause}${where} LIMIT 5000`;

  const rows = tenantId
    ? await withTenantRaw(tenantId, (db) => db.$queryRaw<Array<{ id: string }>>(statement))
    : await prisma.$queryRaw<Array<{ id: string }>>(statement);

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
