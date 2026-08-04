import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import type { leadStage, priority } from '@/lib/validation/schemas';
import { buildTermClauses } from '@/lib/search/terms';

export interface LeadListFilters {
  stage?: z.infer<typeof leadStage>;
  priority?: z.infer<typeof priority>;
  assignedTo?: string;
  campaignId?: string;
  source?: string;
  importListName?: string;
  emailValidation?: string;
  country?: string;
  industry?: string;
  tag?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  /**
   * Ids pre-resolved by the accent-insensitive SQL search. When set, these replace the
   * Prisma term clauses — the raw query has already applied every term, folded on both
   * sides, which `contains` cannot do. Null/undefined means "no search was performed".
   */
  searchIds?: string[] | null;
  includeArchived?: boolean;
}

/**
 * Compose the Prisma `where` for the lead list.
 *
 * The role scope is ALWAYS the first `AND` clause and is never spread into the
 * same object as the filters — so a search `OR`, a `campaignId`, or an
 * `assignedTo` query param can only *narrow* results, never widen them past the
 * caller's role scope. (The old `{ ...roleScope, ...filters }` spread let a
 * colliding key silently override the scope — that was BUG-001.)
 */
export function buildLeadListWhere(
  roleScope: Prisma.LeadWhereInput,
  filters: LeadListFilters
): Prisma.LeadWhereInput {
  const clauses: Prisma.LeadWhereInput[] = [roleScope];

  if (!filters.includeArchived) {
    clauses.push({ archivedAt: null });
  }

  if (filters.stage) clauses.push({ stage: filters.stage });
  if (filters.priority) clauses.push({ crmPriorityScore: filters.priority });
  if (filters.assignedTo) clauses.push({ assignedToId: filters.assignedTo });
  if (filters.campaignId) clauses.push({ campaignId: filters.campaignId });
  if (filters.source) clauses.push({ source: { contains: filters.source, mode: 'insensitive' } });
  if (filters.importListName) clauses.push({ importListName: { contains: filters.importListName, mode: 'insensitive' } });
  if (filters.emailValidation) clauses.push({ emailValidation: filters.emailValidation });
  if (filters.country) {
    clauses.push({
      OR: [
        { contact: { country: { contains: filters.country, mode: 'insensitive' } } },
        { account: { country: { contains: filters.country, mode: 'insensitive' } } },
      ],
    });
  }
  if (filters.industry) {
    clauses.push({ account: { industry: { contains: filters.industry, mode: 'insensitive' } } });
  }
  if (filters.tag) clauses.push({ tags: { has: filters.tag } });

  if (filters.dateFrom || filters.dateTo) {
    clauses.push({
      createdAt: {
        ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
        ...(filters.dateTo ? { lte: new Date(filters.dateTo + 'T23:59:59Z') } : {}),
      },
    });
  }

  if (filters.searchIds != null) {
    // Accent-folded match already done in SQL; narrow to those rows.
    clauses.push({ id: { in: filters.searchIds } });
  } else {
    for (const clause of buildSearchClauses(filters.search)) {
      clauses.push(clause);
    }
  }

  return { AND: clauses };
}

/**
 * Fields a free-text lead search matches against.
 *
 * `title` is included so this matches the pool's field set — the two search boxes had
 * opposite gaps: the pool searched title but could not handle two words, `/leads`
 * handled two words but ignored title.
 */
const SEARCH_FIELDS = ['firstName', 'lastName', 'company', 'title', 'email', 'phone', 'linkedIn'] as const;

/**
 * Free-text search over a lead.
 *
 * Every whitespace-separated term must match at least one searchable field, which is
 * what makes a full name work: "Elena Popov" requires "Elena" to match some field and
 * "Popov" to match some field — `firstName` and `lastName` respectively. Term order
 * does not matter, so "Popov Elena" works too. Implementation shared with the leadgen
 * pool in `lib/search/terms.ts`.
 */
export function buildSearchClauses(search?: string): Prisma.LeadWhereInput[] {
  return buildTermClauses<Prisma.LeadWhereInput>(search, SEARCH_FIELDS);
}
