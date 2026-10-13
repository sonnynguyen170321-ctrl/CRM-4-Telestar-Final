import {
  INDUSTRY_KEYS,
  canonicalizeIndustry,
} from '@telestar/core-scoring/rules/dictionaries/industry';
import { REGION_TO_COUNTRIES } from '@telestar/core-scoring/rules/dictionaries/regions';

/**
 * What the ICP list fields offer while typing. Suggestions only: a rep can still type anything, and
 * the stored value stays a plain string the scoring dictionaries already understand.
 */

const titleCase = (value: string) =>
  value
    .split(' ')
    .map((word) => (word.length <= 3 && word === word.toUpperCase() ? word : word.charAt(0) + word.slice(1).toLowerCase()))
    .join(' ');

/** Every country the region dictionary knows, once each, alphabetical. */
export const COUNTRY_SUGGESTIONS: readonly string[] = Array.from(
  new Set(Object.values(REGION_TO_COUNTRIES).flat()),
).sort((a, b) => a.localeCompare(b));

/**
 * Industry labels ("It Services", "Cloud Hosting"). Only labels that the scoring dictionary maps back
 * to their own key are offered, so choosing a suggestion can never produce a value that scores as
 * something else.
 */
export const INDUSTRY_SUGGESTIONS: readonly string[] = INDUSTRY_KEYS.map((key) =>
  titleCase(key.replace(/_/g, ' ')),
).filter((label, index) => canonicalizeIndustry(label) === INDUSTRY_KEYS[index]);
