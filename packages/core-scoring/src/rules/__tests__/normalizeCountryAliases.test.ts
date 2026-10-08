import { describe, expect, it } from 'vitest';

import { countryVariants, isKnownCountry, normalizeCountry } from '../normalize/normalizeCountry';

describe('normalizeCountry — Gulf and Turkish spellings', () => {
  it.each([
    ['KSA', 'Saudi Arabia'],
    ['Kingdom of Saudi Arabia', 'Saudi Arabia'],
    ['Saudi', 'Saudi Arabia'],
    ['Türkiye', 'Turkey'],
    ['Turkiye', 'Turkey'],
  ])('%s -> %s', (raw, expected) => {
    expect(normalizeCountry(raw)).toBe(expected);
  });
});

describe('isKnownCountry', () => {
  it('knows countries from the region dictionary and alias targets', () => {
    expect(isKnownCountry('Saudi Arabia')).toBe(true);
    expect(isKnownCountry('United States')).toBe(true);
    expect(isKnownCountry('Vietnam')).toBe(true);
  });

  it('does not know an invented place', () => {
    expect(isKnownCountry('Atlantis')).toBe(false);
    expect(isKnownCountry('Riyadh')).toBe(false);
  });
});

describe('countryVariants', () => {
  it('lists the canonical name and its aliases, folded', () => {
    const variants = countryVariants('Saudi Arabia');
    expect(variants).toContain('saudi arabia');
    expect(variants).toContain('ksa');
  });
});
