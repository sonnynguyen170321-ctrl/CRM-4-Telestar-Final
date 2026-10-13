import { describe, expect, it } from 'vitest';

import { matchedEvidence } from '@/lib/research/matchedEvidence';

describe('matchedEvidence', () => {
  it('shows the facts read from the person, with quotes, and never the run query terms', () => {
    const facts = matchedEvidence({
      kind: 'contact',
      title: null,
      verificationJson: {
        person: {
          title: 'Aircraft Maintenance Director', employer: 'Kam Air', location: 'Kabul, Afghanistan', country: 'Afghanistan', geo: 'match',
          evidence: [{ field: 'title', quote: 'Aircraft Maintenance Director at Kam Air' }, { field: 'location', quote: 'Kabul, Afghanistan' }],
        },
      },
      sourceJson: { query: '"Aircraft Maintenance Director" Aviation Afghanistan' },
    });
    expect(facts.map((f) => f.label)).toEqual(['Title', 'Employer', 'Location']);
    expect(facts[0]).toMatchObject({ value: 'Aircraft Maintenance Director', quote: 'Aircraft Maintenance Director at Kam Air' });
    expect(facts[2]).toMatchObject({ standing: 'inside', quote: 'Kabul, Afghanistan' });
    expect(JSON.stringify(facts)).not.toMatch(/Aviation/);
  });

  it('flags a location outside the target and falls back to the parsed profile head before verification', () => {
    const outside = matchedEvidence({ kind: 'contact', verificationJson: { person: { location: 'Texas', country: 'United States', geo: 'outside' } } });
    expect(outside[0]).toMatchObject({ label: 'Location', standing: 'outside' });
    const parsed = matchedEvidence({ kind: 'contact', sourceJson: { profile: { location: 'Wichita Falls, Texas, United States', country: 'United States' } } });
    expect(parsed).toEqual([{ label: 'Location', value: 'Wichita Falls, Texas, United States', quote: null, standing: undefined }]);
  });

  it('is empty when nothing was read, and reads company facts for companies', () => {
    expect(matchedEvidence({ kind: 'contact' })).toEqual([]);
    expect(matchedEvidence({ kind: 'company', verificationJson: { company: { industry: 'Banking', hqCountry: 'Saudi Arabia', employeeCount: 25498 } } }).map((f) => f.label)).toEqual(['Industry', 'Headquarters', 'Staff']);
  });
});
