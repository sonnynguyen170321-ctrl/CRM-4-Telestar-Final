import { describe, it, expect } from 'vitest';
import { buildTermClauses, splitSearchTerms, stripAccents, termVariants, getTitleSynonyms } from '@/lib/search/terms';
import { buildSearchClauses } from '@/lib/leads/listQuery';
import { buildPoolWhere } from '@/lib/leadgen/pool';

/**
 * CRM-C-003. The pool passed the whole raw query string to `contains` on each column,
 * so "Marcus Webb" matched nothing while "Marcus" and "Webb" each matched — the most
 * natural lookup in the product looked like a missing record, and managers re-imported
 * duplicates. `/leads` already split correctly; this pins that both now share it.
 */
describe('search term splitting', () => {
  it('splits on whitespace and collapses padding', () => {
    expect(splitSearchTerms('  Marcus   Webb  ')).toEqual(['Marcus', 'Webb']);
    expect(splitSearchTerms('')).toEqual([]);
    expect(splitSearchTerms(undefined)).toEqual([]);
  });

  it('folds diacritics', () => {
    expect(stripAccents('Nguyễn')).toBe('Nguyen');
    expect(stripAccents('Giám')).toBe('Giam');
  });

  it('offers both the raw and folded variant, de-duplicated', () => {
    expect(termVariants('Nguyễn')).toEqual(['Nguyễn', 'Nguyen']);
    expect(termVariants('Webb')).toEqual(['Webb']);
  });

  it('produces one AND-able clause per term', () => {
    const clauses = buildTermClauses<Record<string, unknown>>('Marcus Webb', ['firstName', 'lastName']);
    expect(clauses).toHaveLength(2);
    for (const c of clauses) expect(Array.isArray((c as { OR: unknown[] }).OR)).toBe(true);
  });

  it('returns nothing for an empty search so the filter is skipped', () => {
    expect(buildTermClauses('', ['firstName'])).toEqual([]);
  });
});

describe('title synonym search alignment', () => {
  it('resolves bidirectional synonyms for executive and common sales titles', () => {
    expect(getTitleSynonyms('CEO')).toContain('chief executive officer');
    expect(getTitleSynonyms('Chief Executive Officer')).toContain('ceo');
    expect(getTitleSynonyms('CTO')).toContain('chief technology officer');
    expect(getTitleSynonyms('Vice President')).toContain('vp');
    expect(getTitleSynonyms('VP')).toContain('vice president');
    expect(getTitleSynonyms('Founder')).toContain('co-founder');
  });

  it('expands title clauses when searching acronyms like CEO', () => {
    const clauses = buildTermClauses<Record<string, unknown>>('CEO', ['title', 'company']);
    expect(clauses).toHaveLength(1);
    const orClauses = (clauses[0] as { OR: Array<Record<string, unknown>> }).OR;
    const titleClauses = orClauses.filter((c) => 'title' in c);
    const titleValues = titleClauses.map((c) => (c.title as { contains: string }).contains);
    expect(titleValues).toContain('CEO');
    expect(titleValues).toContain('chief executive officer');
  });

  it('expands full phrase search like Chief Executive Officer to match CEO in title', () => {
    const clauses = buildTermClauses<Record<string, unknown>>('Chief Executive Officer', ['title', 'company']);
    expect(clauses).toHaveLength(1);
    const rootOr = (clauses[0] as { OR: Array<Record<string, unknown>> }).OR;
    const directTitleMatch = rootOr.find((c) => 'title' in c && (c.title as { contains: string }).contains === 'ceo');
    expect(directTitleMatch).toBeDefined();
  });
});

describe('pool search now matches the leads search', () => {
  it('ANDs a clause per term instead of one raw-string OR', () => {
    const where = buildPoolWhere({ search: 'Marcus Webb' }, 't1') as Record<string, unknown>;

    expect(where.AND).toHaveLength(2);
    // The old shape — a single top-level OR holding the whole string — is gone.
    expect(where.OR).toBeUndefined();
  });

  it('searches fullName, which the importer populates and the old query ignored', () => {
    const where = buildPoolWhere({ search: 'Marcus' }, 't1') as { AND: Array<{ OR: Array<Record<string, unknown>> }> };
    const fields = where.AND[0].OR.map((c) => Object.keys(c)[0]);

    expect(fields).toContain('fullName');
    expect(fields).toContain('title');
  });

  it('leaves the where untouched when no search is given', () => {
    const where = buildPoolWhere({ status: 'raw' }, 't1') as Record<string, unknown>;
    expect(where.AND).toBeUndefined();
    expect(where.tenantId).toBe('t1');
  });

  it('keeps the leads search order-independent', () => {
    const forward = buildSearchClauses('Marcus Webb');
    const reversed = buildSearchClauses('Webb Marcus');
    expect(forward).toHaveLength(reversed.length);
  });
});
