import { describe, expect, it } from 'vitest';

import { ALL_COUNTRIES, ISO2_TO_COUNTRY, COUNTRY_SPELLINGS } from '../dictionaries/countries';
import { REGION_KEYS, REGION_TO_COUNTRIES } from '../dictionaries/regions';
import { countryKey, isKnownCountry, normalizeCountry } from '../normalize/normalizeCountry';

describe('country dictionary', () => {
  it('covers the whole ISO 3166-1 list (at least 240 countries and territories)', () => {
    expect(ALL_COUNTRIES.length).toBeGreaterThanOrEqual(240);
    expect(new Set(ALL_COUNTRIES).size).toBe(ALL_COUNTRIES.length);
  });

  it('knows Afghanistan, which the region lists never named', () => {
    expect(isKnownCountry('Afghanistan')).toBe(true);
    expect(normalizeCountry('afghanistan')).toBe('Afghanistan');
    expect(ISO2_TO_COUNTRY.af).toBe('Afghanistan');
  });

  it.each([
    ['Isle of Man', 'Isle of Man'],
    ['bosnia and herzegovina', 'Bosnia and Herzegovina'],
    ['Côte d’Ivoire', 'Ivory Coast'],
    ["Cote d'Ivoire", 'Ivory Coast'],
    ['Burma', 'Myanmar'],
    ['Swaziland', 'Eswatini'],
    ['Russian Federation', 'Russia'],
    ['Czech Republic', 'Czechia'],
    ['Korea (North)', 'North Korea'],
    ['DRC', 'Democratic Republic of the Congo'],
    ['Timor Leste', 'Timor-Leste'],
    ['Scotland', 'United Kingdom'],
  ])('%s -> %s', (raw, expected) => {
    expect(normalizeCountry(raw.replace('’', "'"))).toBe(expected);
  });

  it('every region member is a country the dictionary knows', () => {
    for (const key of REGION_KEYS) {
      for (const country of REGION_TO_COUNTRIES[key]) {
        expect(isKnownCountry(country), `${key}: ${country}`).toBe(true);
        expect(COUNTRY_SPELLINGS[country.toLowerCase()], `${key}: ${country}`).toBe(country);
      }
    }
  });

  it('puts Afghanistan in South Asia and the whole continent in Africa', () => {
    expect(REGION_TO_COUNTRIES.SOUTH_ASIA).toContain('Afghanistan');
    expect(REGION_TO_COUNTRIES.AFRICA).toContain('Zimbabwe');
    expect(REGION_TO_COUNTRIES.AFRICA).toContain('Sudan');
  });

  it('compares spellings as one country', () => {
    expect(countryKey('U.K.')).toBe(countryKey('United Kingdom'));
    expect(countryKey('Afghanistan')).toBe('afghanistan');
  });

  it('does not invent a country', () => {
    expect(isKnownCountry(normalizeCountry('Texas'))).toBe(false);
    expect(isKnownCountry(normalizeCountry('Wichita Falls'))).toBe(false);
  });
});
