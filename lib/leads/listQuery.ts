import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import type { leadStage, priority } from '@/lib/validation/schemas';

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

  for (const clause of buildSearchClauses(filters.search)) {
    clauses.push(clause);
  }

  return { AND: clauses };
}

/** Fields a free-text lead search matches against. */
const SEARCH_FIELDS = ['firstName', 'lastName', 'company', 'email', 'phone', 'linkedIn'] as const;

/** Strip diacritics so "Nguyễn" also matches a record stored as "Nguyen". */
function stripAccents(value: string): string {
  // ̀-ͯ is the Unicode combining-diacritical-marks block that NFD splits out.
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Free-text search over a lead.
 *
 * Every whitespace-separated term must match at least one searchable field, which is
 * what makes a full name work: "Elena Popov" requires "Elena" to match some field and
 * "Popov" to match some field — `firstName` and `lastName` respectively. Matching the
 * whole string against a single column (the old behaviour) returned nothing for any
 * first-plus-last-name query. Term order does not matter, so "Popov Elena" works too.
 */
export function buildSearchClauses(search?: string): Prisma.LeadWhereInput[] {
  const terms = (search ?? '').trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  return terms.map((term) => {
    const variants = Array.from(new Set([term, stripAccents(term)]));
    return {
      OR: variants.flatMap((variant) =>
        SEARCH_FIELDS.map((field) => ({
          [field]: { contains: variant, mode: 'insensitive' as const },
        }))
      ),
    } as Prisma.LeadWhereInput;
  });
}
