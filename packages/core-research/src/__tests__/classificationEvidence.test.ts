import { describe, expect, it } from 'vitest';

import {
  buildClassificationBundle,
  isEvidenceThin,
  parseEvidenceFacts,
  parseExaCompanyProse,
} from '../classificationEvidence';

const RIYAD =
  'Riyad Bank is a Banking company headquartered in Riyadh, Saudi Arabia. Riyad Bank employs 25,498 people (+2.1% YoY), founded in 1957. ' +
  '- Industry: Banking - Type: Public Company - Headquarters: Riyadh, Riyadh Province';

describe('parseExaCompanyProse', () => {
  it('reads industry, headcount and headquarters from the first sentences of an Exa highlight', () => {
    expect(parseExaCompanyProse(RIYAD)).toEqual({
      industry: 'Banking',
      employeeCount: 25498,
      headquarters: 'Riyadh, Saudi Arabia',
    });
  });

  it('returns nulls for prose that states none of it', () => {
    expect(parseExaCompanyProse('Welcome to our site. We love customers.')).toEqual({
      industry: null,
      employeeCount: null,
      headquarters: null,
    });
  });

  it('does not take a sentence fragment as an industry', () => {
    const out = parseExaCompanyProse('Acme is a leading provider of widgets and a company that cares about people.');
    expect(out.industry).toBeNull();
  });

  it('stays fast on a hostile run of words', () => {
    const start = performance.now();
    parseExaCompanyProse(`X is a ${'word '.repeat(50_000)}`);
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe('buildClassificationBundle', () => {
  const longText = 'We design and operate aircraft maintenance repair and overhaul facilities. '.repeat(80);

  it('caps the highlight at 1500 chars and identity pages at 2500, each carrying its source url', () => {
    const bundle = buildClassificationBundle(
      { name: 'Acme', domain: 'acme.com', sourceUrl: 'https://acme.com/', highlight: 'h'.repeat(4000) },
      [
        { url: 'https://acme.com/about', text: longText },
        { url: 'https://acme.com/services', text: longText },
      ]
    );
    const highlight = bundle.sources.find((s) => s.kind === 'highlight');
    const pages = bundle.sources.filter((s) => s.kind === 'page');
    expect(highlight?.text.length).toBeLessThanOrEqual(1500);
    expect(highlight?.url).toBe('https://acme.com/');
    expect(pages.reduce((n, p) => n + p.text.length, 0)).toBeLessThanOrEqual(2500);
    expect(pages.map((p) => p.url)).toContain('https://acme.com/about');
  });

  it('keeps identity pages and drops pages that describe the audience, not the company', () => {
    const bundle = buildClassificationBundle({ name: 'Board', domain: 'board.com', highlight: null }, [
      { url: 'https://board.com/about', text: `About us. ${longText}` },
      { url: 'https://board.com/careers', text: `Open roles. ${longText}` },
    ]);
    expect(bundle.sources.map((s) => s.url)).toEqual(['https://board.com/about']);
  });

  it('drops soft-404 and thin pages', () => {
    const bundle = buildClassificationBundle({ name: 'A', domain: 'a.com', highlight: null }, [
      { url: 'https://a.com/about', text: 'Page not found' },
    ]);
    expect(bundle.sources).toEqual([]);
  });

  it('exposes parsed LinkedIn facts and Exa prose from the highlight', () => {
    const bundle = buildClassificationBundle({ name: 'Riyad Bank', domain: 'riyadbank.com', highlight: RIYAD });
    expect(bundle.prose.employeeCount).toBe(25498);
    expect(bundle.facts.facts.find((f) => f.key === 'type')?.value).toBe('Public Company');
  });

  it('builds an empty bundle for a candidate with no evidence', () => {
    const bundle = buildClassificationBundle({ name: 'A', domain: null, highlight: null });
    expect(bundle.text).toBe('');
    expect(bundle.sources).toEqual([]);
  });
});

describe('isEvidenceThin', () => {
  it('is thin when there is almost no text and nothing was decided deterministically', () => {
    const bundle = buildClassificationBundle({ name: 'A', domain: 'a.com', highlight: 'A company.' });
    expect(isEvidenceThin(bundle, { decided: false })).toBe(true);
  });

  it('is not thin when a deterministic rule already decided it', () => {
    const bundle = buildClassificationBundle({ name: 'A', domain: 'a.com', highlight: 'A company.' });
    expect(isEvidenceThin(bundle, { decided: true })).toBe(false);
  });

  it('is not thin with a real paragraph of evidence', () => {
    const bundle = buildClassificationBundle({ name: 'A', domain: 'a.com', highlight: RIYAD });
    expect(isEvidenceThin(bundle, { decided: false })).toBe(false);
  });
});

describe('parseEvidenceFacts re-export', () => {
  it('is the same parser the evidence drawer uses', () => {
    expect(parseEvidenceFacts('x').isStructured).toBe(false);
  });
});
