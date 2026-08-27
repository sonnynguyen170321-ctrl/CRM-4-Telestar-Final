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
 * Common executive and sales job title synonyms / acronyms.
 * Enables bidirectional alignment: searching "CEO" finds "Chief Executive Officer" and vice versa.
 */
export const TITLE_SYNONYM_GROUPS: ReadonlyArray<readonly string[]> = [
  ['ceo', 'chief executive officer'],
  ['cto', 'chief technology officer', 'chief technical officer'],
  ['cfo', 'chief financial officer'],
  ['coo', 'chief operating officer'],
  ['cmo', 'chief marketing officer'],
  ['cro', 'chief revenue officer'],
  ['cpo', 'chief product officer'],
  ['cio', 'chief information officer'],
  ['ciso', 'chief information security officer'],
  ['vp', 'vice president'],
  ['svp', 'senior vice president'],
  ['evp', 'executive vice president'],
  ['avp', 'assistant vice president'],
  ['md', 'managing director'],
  ['gm', 'general manager'],
  ['founder', 'co-founder', 'cofounder', 'co founder', 'owner'],
  ['sdr', 'sales development representative'],
  ['bdr', 'business development representative'],
  ['ae', 'account executive'],
  ['hr', 'human resources', 'people operations'],
] as const;

/**
 * Returns title synonyms for a given word or phrase.
 * For example:
 *   getTitleSynonyms("ceo") -> ["chief executive officer"]
 *   getTitleSynonyms("Chief Executive Officer") -> ["ceo"]
 */
export function getTitleSynonyms(queryOrTerm: string): string[] {
  const normalized = stripAccents(queryOrTerm).trim().toLowerCase();
  if (!normalized) return [];

  const results = new Set<string>();
  for (const group of TITLE_SYNONYM_GROUPS) {
    const matched = group.some((item) => item.toLowerCase() === normalized);
    if (matched) {
      for (const item of group) {
        if (item.toLowerCase() !== normalized) {
          results.add(item);
        }
      }
    }
  }
  return Array.from(results);
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

  const fullSynonyms = getTitleSynonyms(search ?? '');
  const hasTitleField = fields.includes('title');

  const perTerm = terms.map((term) => {
    const variants = termVariants(term);
    const termSynonyms = getTitleSynonyms(term);

    const orClauses: Record<string, unknown>[] = [];
    for (const variant of variants) {
      for (const field of fields) {
        orClauses.push({ [field]: { contains: variant, mode: 'insensitive' as const } });
        if (field === 'title' && termSynonyms.length > 0) {
          for (const syn of termSynonyms) {
            orClauses.push({ [field]: { contains: syn, mode: 'insensitive' as const } });
          }
        }
      }
    }
    return { OR: orClauses } as TWhere;
  });

  if (fullSynonyms.length > 0 && hasTitleField && terms.length > 1) {
    return [
      {
        OR: [
          { AND: perTerm },
          ...fullSynonyms.map((syn) => ({
            title: { contains: syn, mode: 'insensitive' as const },
          })),
        ],
      } as TWhere,
    ];
  }

  return perTerm;
}
