import { describe, it, expect } from 'vitest';
import { buildLeadListWhere, buildSearchClauses } from '@/lib/leads/listQuery';
import { bulkTaskActionSchema } from '@/lib/validation/schemas';

/**
 * Regression tests for the CRMTest internal-team feedback round:
 *   F3 — leads could not be found by full name
 *   F4B — daily task bulk actions
 */

const fieldsMatched = (clause: Record<string, any>) =>
  (clause.OR as Record<string, any>[]).map((c) => Object.keys(c)[0]);

const containsValues = (clause: Record<string, any>) =>
  (clause.OR as Record<string, any>[]).map((c) => Object.values(c)[0].contains);

describe('buildSearchClauses (F3 — lead search by name)', () => {
  it('returns no clause for an empty or whitespace-only search', () => {
    expect(buildSearchClauses(undefined)).toEqual([]);
    expect(buildSearchClauses('')).toEqual([]);
    expect(buildSearchClauses('   ')).toEqual([]);
  });

  it('matches a single term against name, company, title, email, phone and linkedIn', () => {
    const [clause] = buildSearchClauses('Elena');
    // `title` joined the set in the CRM-C-003/D-004 fix: the pool search covered job
    // title while /leads did not, so the two boxes had opposite blind spots. Both now
    // read the same field list from lib/search/terms.ts.
    expect(fieldsMatched(clause)).toEqual([
      'firstName',
      'lastName',
      'company',
      'title',
      'email',
      'phone',
      'linkedIn',
    ]);
  });

  it('requires every term of a full name to match — one AND clause per term', () => {
    const clauses = buildSearchClauses('Elena Popov');
    expect(clauses).toHaveLength(2);
    expect(containsValues(clauses[0])).toContain('Elena');
    expect(containsValues(clauses[1])).toContain('Popov');
  });

  it('is order-independent and collapses repeated whitespace', () => {
    const forward = buildSearchClauses('Elena   Popov');
    const reverse = buildSearchClauses('Popov Elena');
    expect(forward).toHaveLength(2);
    expect(reverse).toHaveLength(2);
    expect(containsValues(reverse[0])).toContain('Popov');
  });

  it('searches the accent-stripped variant alongside the raw term', () => {
    const [clause] = buildSearchClauses('Nguyễn');
    const values = containsValues(clause);
    expect(values).toContain('Nguyễn');
    expect(values).toContain('Nguyen');
  });

  it('does not duplicate variants when the term has no accents', () => {
    const [clause] = buildSearchClauses('Smith');
    expect(new Set(containsValues(clause))).toEqual(new Set(['Smith']));
  });

  it('keeps the role scope as the first AND clause so search can only narrow results', () => {
    const roleScope = { assignedToId: 'sdr-1' };
    const where = buildLeadListWhere(roleScope, { search: 'Elena Popov' });
    const clauses = where.AND as Record<string, any>[];
    expect(clauses[0]).toEqual(roleScope);
    expect(clauses).toHaveLength(4); // scope + archivedAt + one per search term
  });

  it('hides archived leads unless includeArchived is set', () => {
    const hidden = buildLeadListWhere({}, {}).AND as Record<string, any>[];
    expect(hidden).toContainEqual({ archivedAt: null });

    const shown = buildLeadListWhere({}, { includeArchived: true }).AND as Record<string, any>[];
    expect(shown).not.toContainEqual({ archivedAt: null });
  });
});

describe('bulkTaskActionSchema (F4B — daily task bulk actions)', () => {
  const base = { taskIds: ['t1', 't2'] };

  it('accepts complete and skip without extra fields', () => {
    expect(bulkTaskActionSchema.safeParse({ ...base, action: 'complete' }).success).toBe(true);
    expect(bulkTaskActionSchema.safeParse({ ...base, action: 'skip' }).success).toBe(true);
  });

  it('requires at least one task id and caps the batch size', () => {
    expect(bulkTaskActionSchema.safeParse({ taskIds: [], action: 'skip' }).success).toBe(false);
    const tooMany = Array.from({ length: 201 }, (_, i) => `t${i}`);
    expect(bulkTaskActionSchema.safeParse({ taskIds: tooMany, action: 'skip' }).success).toBe(false);
  });

  it('requires dueDate to reschedule', () => {
    expect(bulkTaskActionSchema.safeParse({ ...base, action: 'reschedule' }).success).toBe(false);
    expect(
      bulkTaskActionSchema.safeParse({
        ...base,
        action: 'reschedule',
        dueDate: '2026-08-03T09:00:00.000Z',
      }).success
    ).toBe(true);
  });

  it('requires userId to reassign', () => {
    expect(bulkTaskActionSchema.safeParse({ ...base, action: 'reassign' }).success).toBe(false);
    expect(
      bulkTaskActionSchema.safeParse({ ...base, action: 'reassign', userId: 'u1' }).success
    ).toBe(true);
  });

  it('requires note text for the note action', () => {
    expect(bulkTaskActionSchema.safeParse({ ...base, action: 'note' }).success).toBe(false);
    expect(bulkTaskActionSchema.safeParse({ ...base, action: 'note', note: '  ' }).success).toBe(false);
    expect(
      bulkTaskActionSchema.safeParse({ ...base, action: 'note', note: 'Called, no answer' }).success
    ).toBe(true);
  });

  it('rejects unknown actions', () => {
    expect(bulkTaskActionSchema.safeParse({ ...base, action: 'delete' }).success).toBe(false);
  });
});
