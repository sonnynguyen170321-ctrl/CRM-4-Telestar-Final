/**
 * A neural provider names a profile after the person. A keyword engine names it after the SERP.
 *
 * `parseContactHits` required a `Name - Role - Company` title and dropped anything else, because
 * on a Google or Brave result page a bare title means an index or listicle, and harvesting those
 * produced junk contacts. Exa does not work that way. Measured against the production key on
 * 2026-09-17, with the exact query the planner emits:
 *
 *     https://www.linkedin.com/in/janson-seah     title "Janson Seah"        highlight 2114 chars
 *     https://www.linkedin.com/in/dorothy-yiu     title "Dorothy Yiu"        highlight 2684 chars
 *     https://www.linkedin.com/in/quickhrsg       title "Sukhveer Singh…"    highlight 4132 chars
 *
 * Every one is a real profile, and every one was discarded — which is the whole of "research for
 * people doesn't work". The listicle guard still matters; what changes is that a `/in/<slug>` URL
 * plus a title that reads as a person's name is evidence in its own right, and an index page has
 * neither.
 */
import { describe, expect, it } from 'vitest';

import { parseContactHits } from '@telestar/core-research/parseDiscoveryResults';

const hit = (over: Partial<{ title: string; url: string; snippet: string | null; provider: string }> = {}) => ({
  title: 'Janson Seah',
  url: 'https://www.linkedin.com/in/janson-seah',
  snippet: 'Chief Executive Officer at Acme SaaS. Singapore. 500+ connections.',
  provider: 'exa',
  ...over,
});

describe('parseContactHits — Exa-shaped results', () => {
  it('keeps a profile whose title is just the person’s name', () => {
    const out = parseContactHits('ceo saas singapore', [hit()]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: 'CONTACT',
      name: 'Janson Seah',
      linkedinUrl: 'https://www.linkedin.com/in/janson-seah',
      dedupeFingerprint: 'contact:linkedin:janson-seah',
    });
  });

  it('leaves role and company unset rather than inventing them', () => {
    // A bare title carries no role. Guessing one from the highlight would put a fabricated job
    // title on a real person, which is worse than an empty field.
    const out = parseContactHits('q', [hit()]);
    expect(out[0].title).toBeNull();
    expect(out[0].companyName).toBeNull();
  });

  it('still reads role and company when the title does carry them', () => {
    const out = parseContactHits('q', [
      hit({ title: 'Dorothy Yiu - Chief Revenue Officer - Acme Pte Ltd | LinkedIn' }),
    ]);
    expect(out[0]).toMatchObject({ name: 'Dorothy Yiu', title: 'Chief Revenue Officer', companyName: 'Acme Pte Ltd' });
  });

  it('keeps the snippet as evidence for the ledger', () => {
    const out = parseContactHits('q', [hit()]);
    expect(out[0].source.snippet).toContain('Chief Executive Officer');
  });
});

describe('parseContactHits — what must still be refused', () => {
  it('drops a title that is not a person’s name', () => {
    // The listicle guard. `/in/` plus prose is a directory page, not somebody.
    const out = parseContactHits('q', [
      hit({ title: 'Top 25 SaaS CEOs in Singapore you should follow', url: 'https://www.linkedin.com/in/top-25-saas' }),
    ]);
    expect(out).toEqual([]);
  });

  it('drops a non-profile LinkedIn path', () => {
    expect(parseContactHits('q', [hit({ url: 'https://www.linkedin.com/company/acme' })])).toEqual([]);
    expect(parseContactHits('q', [hit({ url: 'https://www.linkedin.com/jobs/view/123' })])).toEqual([]);
  });

  it('drops a lookalike host', () => {
    expect(parseContactHits('q', [hit({ url: 'https://evillinkedin.com/in/janson-seah' })])).toEqual([]);
  });

  it('drops a numeric slug', () => {
    expect(parseContactHits('q', [hit({ url: 'https://www.linkedin.com/in/12345', title: 'Janson Seah' })])).toEqual([]);
  });

  it('does not return the same person twice', () => {
    const out = parseContactHits('q', [hit(), hit({ title: 'Janson Seah | LinkedIn' })]);
    expect(out).toHaveLength(1);
  });
});
