/**
 * Shared free-text search term handling.
 *
 * Two search boxes in this product behaved differently. `/leads` split the query on
 * whitespace and ANDed one clause per term, so "Marcus Webb" matched a record whose
 * firstName is Marcus and lastName is Webb. The leadgen pool passed the entire raw
 * string to `contains` against each column independently, so the most natural lookup —
 * typing a prospect's full name — always returned nothing, and a manager concluded the
 * record was missing and re-imported it. This module is the single implementation both
 * now use.
 */

/** Strip diacritics so "Nguyễn" also matches a record stored as "Nguyen". */
export function stripAccents(value: string): string {
  // ̀-ͯ is the Unicode combining-diacritical-marks block that NFD splits out.
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Whitespace-separated, non-empty search terms. Collapses padding. */
export function splitSearchTerms(search?: string): string[] {
  return (search ?? '').trim().split(/\s+/).filter(Boolean);
}

/**
 * Accent-folded variants of a term, de-duplicated.
 *
 * Both forms are searched because normalising only one side is not enough on its own:
 * folding the query lets "Nguyễn" find "Nguyen", but the stored value still has to be
 * folded for "Nguyen" to find "Nguyễn" — that half is handled in SQL by `unaccent`.
 */
export function termVariants(term: string): string[] {
  return Array.from(new Set([term, stripAccents(term)]));
}

/**
 * Build one `OR` group per term over the given fields, to be ANDed by the caller.
 *
 * Generic over the model's where-input type so both `Lead` and `LeadPoolItem` can use
 * it without either owning the logic.
 */
export function buildTermClauses<TWhere>(
  search: string | undefined,
  fields: readonly string[]
): TWhere[] {
  const terms = splitSearchTerms(search);
  if (terms.length === 0) return [];

  return terms.map(
    (term) =>
      ({
        OR: termVariants(term).flatMap((variant) =>
          fields.map((field) => ({
            [field]: { contains: variant, mode: 'insensitive' as const },
          }))
        ),
      }) as TWhere
  );
}
