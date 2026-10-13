import { describe, expect, it } from 'vitest';

import { extractPersonHeadline, extractPersonLocation } from '../personProfile';

// Shaped like an Exa people highlight: passages joined with " … ", the head of the profile first.
const MCGREGOR = [
  'William McGregor\nDirector of Maintenance at Sheppard Air Force Base\nWichita Falls, Texas, United States · 500+ connections',
  'Experience: Aircraft Maintenance Officer, US Air Force, Jan 2009 - Mar 2013. Deployed to Kabul, Afghanistan. Aviation maintenance, avionics.',
  'Afghanistan\nKandahar Airfield, Afghanistan · 2011',
].join(' … ');

describe('extractPersonLocation', () => {
  it('reads the profile head, not a deployment mentioned further down (the McGregor case)', () => {
    expect(extractPersonLocation(MCGREGOR)).toEqual({
      location: 'Wichita Falls, Texas, United States',
      country: 'United States',
    });
  });

  it('reads a City, Region, Country line', () => {
    expect(extractPersonLocation('Anna Tran\nVP Sales at Acme\nHo Chi Minh City, Vietnam')?.country).toBe('Vietnam');
    expect(extractPersonLocation('Omar Noori\nHead of Operations at Kam Air\nKabul, Kabul Province, Afghanistan')).toEqual({
      location: 'Kabul, Kabul Province, Afghanistan',
      country: 'Afghanistan',
    });
  });

  it('places a US state or Canadian province in its country when no country is written', () => {
    expect(extractPersonLocation('Sam Poe\nDirector of Maintenance\nDallas, Texas')?.country).toBe('United States');
    expect(extractPersonLocation('Sam Poe\nDirector of Maintenance\nToronto, Ontario')?.country).toBe('Canada');
  });

  it('reads a country-only line and a "Location:" label', () => {
    expect(extractPersonLocation('Jo Lee\nCTO at Foo\nSingapore · 500+ connections')?.country).toBe('Singapore');
    expect(extractPersonLocation('Jo Lee\nCTO at Foo\nLocation: Hanoi, Vietnam')?.country).toBe('Vietnam');
  });

  it('does not read Atlanta, Georgia as the country Georgia', () => {
    expect(extractPersonLocation('Jo Lee\nCTO at Foo\nAtlanta, Georgia')).toBeNull();
    expect(extractPersonLocation('Jo Lee\nCTO at Foo\nAtlanta, Georgia, United States')?.country).toBe('United States');
    expect(extractPersonLocation('Nika Beridze\nCTO at Foo\nTbilisi, Georgia')?.country).toBe('Georgia');
  });

  it('never takes a story, a dated line or a role as a location', () => {
    expect(extractPersonLocation('Jo Lee\nDeployed to Kabul, Afghanistan')).toBeNull();
    expect(extractPersonLocation('Jo Lee\nKandahar, Afghanistan · 2011')).toBeNull();
    expect(extractPersonLocation('Jo Lee\nDirector, Afghanistan Programs')).toBeNull();
    expect(extractPersonLocation('Jo Lee\nServed in Iraq, Afghanistan')).toBeNull();
  });

  it('is unknown when only a later passage names a place', () => {
    expect(extractPersonLocation('Jo Lee\nCTO at Foo … Kabul, Afghanistan')).toBeNull();
  });

  it('does not read a US state code as a country', () => {
    expect(extractPersonLocation('Jo Lee\nCTO at Foo\nBoston, MA')).toBeNull();
  });

  it('fails soft on empty and odd input', () => {
    expect(extractPersonLocation(null)).toBeNull();
    expect(extractPersonLocation('')).toBeNull();
    expect(extractPersonLocation('\u0000  ,,, … …')).toBeNull();
  });
});

describe('extractPersonHeadline', () => {
  it('splits Role at Employer from the head', () => {
    expect(extractPersonHeadline(MCGREGOR, 'William McGregor')).toEqual({
      headline: 'Director of Maintenance at Sheppard Air Force Base',
      title: 'Director of Maintenance',
      employer: 'Sheppard Air Force Base',
    });
  });

  it('ignores the name, the location and connection counts', () => {
    expect(extractPersonHeadline('Jo Lee\nSingapore\n500+ connections', 'Jo Lee')).toBeNull();
  });

  it('keeps a role with no employer whole', () => {
    expect(extractPersonHeadline('Jo Lee\nAircraft Maintenance Director\nSingapore', 'Jo Lee')).toMatchObject({
      title: 'Aircraft Maintenance Director',
      employer: null,
    });
  });

  it('does not take a past role from a later passage', () => {
    expect(extractPersonHeadline('Jo Lee … Aircraft Maintenance Officer, US Air Force, 2009 - 2013', 'Jo Lee')).toBeNull();
  });
});
