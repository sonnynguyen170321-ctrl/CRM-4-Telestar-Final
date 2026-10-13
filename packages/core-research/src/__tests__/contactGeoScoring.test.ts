import { describe, expect, it } from 'vitest';

import { parseContactHits } from '../parseDiscoveryResults';
import {
  OFF_PERSONA_SCORE_CAP,
  OUTSIDE_TARGET_SCORE_CAP,
  UNCONFIRMED_TITLE_SCORE_CAP,
  UNKNOWN_COUNTRY_SCORE_CAP,
  geoVerdictFor,
  scoreCandidateHeuristic,
  titleMatchesPersona,
} from '../scoreCandidates';

// The owner's run: "Aircraft Maintenance Director" + Aviation + Afghanistan surfaced a man in Wichita Falls,
// Texas at score 59 "title not confirmed; also matched aviation, afghanistan" -- because Afghanistan was a
// keyword anywhere in a multi-passage highlight and a past deployment counted.
const NL = String.fromCharCode(10);
const MCGREGOR_SNIPPET = [
  ['William McGregor', 'Director of Maintenance at Sheppard Air Force Base', 'Wichita Falls, Texas, United States'].join(NL),
  'Experience: Aircraft Maintenance Officer, US Air Force, 2009 - 2013. Deployed to Kabul, Afghanistan. Aviation maintenance.',
].join(' … ');

const hits = (title: string, slug: string, snippet: string | null) => [
  { title, url: `https://www.linkedin.com/in/${slug}`, snippet, provider: 'exa' },
];
const parse = (title: string, slug: string, snippet: string | null) => parseContactHits('q', hits(title, slug, snippet))[0]!;

const PERSONAS = ['Aircraft Maintenance Director'];
const HINTS = ['Aircraft Maintenance Director', 'Aviation', 'Afghanistan'];
const AF = { personaTitles: PERSONAS, targetCountries: ['Afghanistan'], geoGate: true };

describe('a person in Texas with a past deployment', () => {
  it('is outside the target, not a match, and ranks last', () => {
    const candidate = parse('William McGregor', 'william-mcgregor', MCGREGOR_SNIPPET);
    expect(candidate.country).toBe('United States');
    expect(candidate.location).toBe('Wichita Falls, Texas, United States');

    const fit = scoreCandidateHeuristic(candidate, HINTS, AF);
    expect(fit.rejection).toBe('person_outside_target');
    expect(fit.geo).toBe('outside');
    expect(fit.score).toBeLessThanOrEqual(OUTSIDE_TARGET_SCORE_CAP);
    expect(fit.reason).not.toMatch(/matched.*afghanistan/i);
  });

  it('scored well before the fix: the run country matched anywhere in the profile', () => {
    const candidate = parse('William McGregor', 'william-mcgregor', MCGREGOR_SNIPPET);
    const noGate = scoreCandidateHeuristic(candidate, HINTS, { personaTitles: PERSONAS });
    expect(noGate.reason).not.toMatch(/afghanistan/i);
  });
});

describe('geography is a gate for contacts', () => {
  const kabul = [['Omar Noori', 'Aircraft Maintenance Director at Kam Air', 'Kabul, Afghanistan'].join(NL)].join('');

  it('lets a confirmed in-country person through with a bonus', () => {
    const candidate = parse('Omar Noori - Aircraft Maintenance Director - Kam Air | LinkedIn', 'omar-noori', kabul);
    const fit = scoreCandidateHeuristic(candidate, HINTS, AF);
    expect(fit.geo).toBe('match');
    expect(fit.rejection).toBeUndefined();
    expect(fit.score).toBeGreaterThanOrEqual(60);
  });

  it('caps an unknown location at the review band', () => {
    const candidate = parse('Omar Noori - Aircraft Maintenance Director - Kam Air | LinkedIn', 'omar-noori', 'Aircraft Maintenance Director. Kam Air.');
    const fit = scoreCandidateHeuristic(candidate, HINTS, AF);
    expect(fit.geo).toBe('unknown');
    expect(fit.score).toBeLessThanOrEqual(UNKNOWN_COUNTRY_SCORE_CAP);
    expect(fit.reason).toMatch(/location not stated/);
  });

  it('does not gate when the run names no country, or the list is partial', () => {
    const candidate = parse('William McGregor', 'william-mcgregor', MCGREGOR_SNIPPET);
    expect(scoreCandidateHeuristic(candidate, HINTS, { personaTitles: PERSONAS }).geo).toBeUndefined();
    expect(scoreCandidateHeuristic(candidate, HINTS, { ...AF, geoGate: false }).rejection).toBeUndefined();
  });

  it('geoVerdictFor compares canonical names', () => {
    expect(geoVerdictFor('Afghanistan', ['afghanistan'])).toBe('match');
    expect(geoVerdictFor(null, ['Afghanistan'])).toBe('unknown');
    expect(geoVerdictFor('Germany', [])).toBe('not_applicable');
  });
});

describe('title confirmation', () => {
  it('caps a headline-only title below the review band', () => {
    const candidate = parse('William McGregor', 'william-mcgregor', ['Jo', 'Aircraft Maintenance Director at Foo', 'Kabul, Afghanistan'].join(NL));
    const fit = scoreCandidateHeuristic(candidate, HINTS, AF);
    expect(fit.reason).toMatch(/title not confirmed/);
    expect(fit.score).toBeLessThanOrEqual(UNCONFIRMED_TITLE_SCORE_CAP + 6);
    expect(UNCONFIRMED_TITLE_SCORE_CAP).toBeLessThan(60);
  });

  it('keeps an off-persona title capped', () => {
    const candidate = parse('Sam Poe - Software Engineer - Foo | LinkedIn', 'sam-poe', 'Kabul, Afghanistan');
    expect(scoreCandidateHeuristic(candidate, HINTS, AF).score).toBeLessThanOrEqual(OFF_PERSONA_SCORE_CAP);
  });
});

describe('persona synonyms', () => {
  it.each([
    ['Vice President of Sales', 'VP Sales', true],
    ['Chief Executive Officer', 'CEO', true],
    ['Sales Director', 'Director of Sales', true],
    ['Director of Aircraft Maintenance', 'Aircraft Maintenance Director', true],
    ['Maintenance Director, Aircraft', 'Aircraft Maintenance Director', true],
    ['Software Engineer', 'CEO', false],
    ['Executive Assistant to the CEO', 'Chief Executive Officer', false],
  ])('%s vs %s', (title, persona, expected) => {
    expect(titleMatchesPersona(title, persona)).toBe(expected);
  });
});
