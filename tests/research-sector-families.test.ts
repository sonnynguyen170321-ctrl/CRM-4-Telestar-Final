import { describe, expect, it } from 'vitest';

import { INDUSTRY_KEYS, type IndustryKey } from '@telestar/core-scoring/rules/dictionaries/industry';

import { SECTOR_FAMILIES, sameFamily } from '@/lib/research/verifyScoring';

/**
 * Research rejects a candidate only when its industry is in no sector family of the targets
 * (docs/scoring/TAXONOMY_2026-10.md). The nine industry-v3 keys must sit in a family with the sectors
 * they are commonly confused with, or a correctly classified company would be rejected instead of reviewed.
 */
describe('sameFamily: industry-v3 keys', () => {
  it.each<[IndustryKey, IndustryKey]>([
    ['PROFESSIONAL_SERVICES', 'LEGAL'],
    ['STAFFING_HR', 'BPO_OUTSOURCING'],
    ['BPO_OUTSOURCING', 'IT_SERVICES'],
    ['SECURITY_SERVICES', 'PROFESSIONAL_SERVICES'],
    ['WHOLESALE_DISTRIBUTION', 'RETAIL'],
    ['WHOLESALE_DISTRIBUTION', 'FMCG'],
    ['WHOLESALE_DISTRIBUTION', 'LOGISTICS'],
    ['WHOLESALE_DISTRIBUTION', 'MANUFACTURING'],
    ['AUTOMOTIVE', 'MANUFACTURING'],
    ['AEROSPACE_DEFENSE', 'MANUFACTURING'],
    ['AUTOMOTIVE', 'AEROSPACE_DEFENSE'],
    ['NONPROFIT', 'GOVERNMENT'],
  ])('%s and %s share a family', (a, b) => {
    expect(sameFamily(a, b)).toBe(true);
    expect(sameFamily(b, a)).toBe(true);
  });

  it.each<[IndustryKey, IndustryKey]>([
    ['LEGAL', 'BANKING'],
    ['STAFFING_HR', 'HEALTHCARE'],
    ['AUTOMOTIVE', 'SOFTWARE'],
    ['AEROSPACE_DEFENSE', 'HOSPITALITY'],
    ['NONPROFIT', 'RETAIL'],
    ['WHOLESALE_DISTRIBUTION', 'CYBERSECURITY'],
    ['PROFESSIONAL_SERVICES', 'SOFTWARE'],
  ])('%s and %s are unrelated (an unambiguous miss)', (a, b) => {
    expect(sameFamily(a, b)).toBe(false);
  });

  it('a key is always in its own family', () => {
    for (const key of INDUSTRY_KEYS) expect(sameFamily(key, key)).toBe(true);
  });

  it('keeps the older families intact', () => {
    expect(sameFamily('BANKING', 'FINTECH')).toBe(true);
    expect(sameFamily('SOFTWARE', 'CYBERSECURITY')).toBe(true);
    expect(sameFamily('SOFTWARE', 'BPO_OUTSOURCING')).toBe(false);
    expect(SECTOR_FAMILIES.length).toBeGreaterThanOrEqual(7);
  });
});
