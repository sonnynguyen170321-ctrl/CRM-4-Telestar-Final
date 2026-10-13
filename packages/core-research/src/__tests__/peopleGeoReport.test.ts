import { describe, expect, it } from 'vitest';

import { buildPeopleEvalReport, formatPeopleEvalReport, type PeopleEvalRow } from '../peopleGeoReport';

const NL = String.fromCharCode(10);
const profile = (name: string, headline: string, place: string | null, history = '') =>
  [name, headline, ...(place ? [place] : [])].join(NL) + (history ? ` … ${history}` : '');

const PAST_AFGHANISTAN = 'Experience: Aircraft Maintenance Officer, US Air Force, 2009 - 2013. Deployed to Kabul, Afghanistan.';

// A fixture shaped like the owner's run: 12 people returned for "Aircraft Maintenance Director" + Afghanistan.
// storedScore is what the old scorer gave (country counted as a keyword anywhere in the profile).
const ROWS: PeopleEvalRow[] = [
  { name: 'William McGregor', snippet: profile('William McGregor', 'Director of Maintenance at Sheppard AFB', 'Wichita Falls, Texas, United States', PAST_AFGHANISTAN), storedScore: 59 },
  { name: 'Dale Hutchins', snippet: profile('Dale Hutchins', 'Aircraft Maintenance Director at Bell', 'Fort Worth, Texas', PAST_AFGHANISTAN), storedScore: 59 },
  { name: 'Priya Nair', snippet: profile('Priya Nair', 'Aviation Maintenance Director at IndiGo', 'Mumbai, India', 'Supported ISAF logistics in Afghanistan, 2012'), storedScore: 56 },
  { name: 'Omar Noori', snippet: profile('Omar Noori', 'Aircraft Maintenance Director at Kam Air', 'Kabul, Afghanistan'), storedScore: 68 },
  { name: 'Hamid Karimi', snippet: profile('Hamid Karimi', 'Aircraft Maintenance Director at Ariana Afghan Airlines', 'Kabul, Afghanistan'), storedScore: 68 },
  { name: 'Sara Ahmadi', snippet: profile('Sara Ahmadi', 'Director of Aircraft Maintenance at Safi Airways', 'Herat, Afghanistan'), storedScore: 62 },
  { name: 'Tom Reyes', snippet: profile('Tom Reyes', 'Aircraft Maintenance Director at Atlas Air', null, 'Aviation maintenance. Afghanistan contract work 2010.'), storedScore: 59 },
  { name: 'Lena Fischer', snippet: profile('Lena Fischer', 'Head of Maintenance at Lufthansa Technik', 'Hamburg, Germany'), storedScore: 38 },
  { name: 'Jo Park', snippet: profile('Jo Park', 'Aircraft Maintenance Director at Korean Air', 'Seoul, South Korea', 'Visited Kabul, Afghanistan in 2019.'), storedScore: 57 },
  { name: 'Ali Zahir', snippet: profile('Ali Zahir', 'Aircraft Maintenance Director at Pamir Airways', null), storedScore: 59 },
  { name: 'Mark Dunn', snippet: profile('Mark Dunn', 'Software Engineer at Acme', 'Austin, Texas'), storedScore: 20 },
  { name: 'Rahim Qadiri', snippet: profile('Rahim Qadiri', 'Aircraft Maintenance Director at Kam Air', 'Kandahar, Afghanistan'), storedScore: 68 },
].map((r) => ({ title: null, companyName: null, location: null, country: null, ...r }));

const RUN = {
  targetCountries: ['Afghanistan'],
  personaTitles: ['Aircraft Maintenance Director'],
  hints: ['Aircraft Maintenance Director', 'Aviation', 'Afghanistan'],
  geoGate: true,
};

describe('people geography report', () => {
  const report = buildPeopleEvalReport(ROWS, RUN);

  it('reads where people really are from the profile head', () => {
    expect(report.actual).toEqual({ total: 12, match: 4, outside: 6, unknown: 2 });
  });

  it('shows the old scorer crediting people who were not in the country', () => {
    // Everyone whose profile named Afghanistan anywhere: 4 in country, 4 outside, 1 unstated.
    expect(report.oldScorerCreditedGeo).toEqual({ total: 9, actuallyMatch: 4, actuallyOutside: 4, actuallyUnknown: 1 });
  });

  it('before: the people ranked 50+ were mostly outside the target', () => {
    expect(report.before.scoreAtLeast50).toEqual({ total: 10, match: 4, outside: 4, unknown: 2 });
  });

  it('after: nobody outside the target scores 50+, and unknowns are held at review', () => {
    expect(report.after.scoreAtLeast50.outside).toBe(0);
    // A headline-only title is "not confirmed": in-country people stay at the edge of the review band until
    // verification quotes their title, so the pre-rank never promotes more than the people who are in country.
    expect(report.after.scoreAtLeast50.total).toBeLessThanOrEqual(4);
    expect(report.after.rejectedOutsideTarget).toBe(6);
    expect(report.after.unknownCappedAtReview).toBe(2);
  });

  it('prints a readable summary', () => {
    const text = formatPeopleEvalReport(report);
    expect(text).toContain('Target countries: Afghanistan');
    expect(text).toMatch(/BEFORE/);
    expect(text).toMatch(/AFTER/);
  });

  it('is empty-safe', () => {
    expect(buildPeopleEvalReport([], RUN).total).toBe(0);
    expect(formatPeopleEvalReport(buildPeopleEvalReport([], RUN))).toContain('n/a');
  });
});
