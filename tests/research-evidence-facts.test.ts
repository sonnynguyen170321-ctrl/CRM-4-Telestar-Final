/**
 * The evidence drawer used to render an Exa highlight as one ~1,500-character paragraph. For a
 * LinkedIn company page that highlight is semi-structured — `- Label: value` pairs, a Key
 * Executives list, a workforce breakdown, a keyword list — and the reader was left to scan for
 * the headquarters by eye. This parser is display-only: nothing it returns feeds fitScore.
 */
import { describe, expect, it } from 'vitest';

import { MAX_PARSE_CHARS, parseEvidenceFacts } from '@/lib/research/evidenceFacts';
import { candidateAttemptsWhere } from '@/lib/research/readModel';

// Verbatim shape of a production highlight (company renamed fields kept as Exa emits them).
const LINKEDIN_SNIPPET =
  'SimpleAI is a Technology, Information and Internet company. SimpleAI is an AI agent that handles manual work across accounting, finance, HR, and operations. They are trusted by 200+ accounting firms and ISO 27001 certified. SimpleAI employs 22 people (+15.8% YoY, +3 people), founded in 2023. Headquartered in Singapore, Singapore, with an office in Bukit Merah. ... At SimpleAI, we transform bookkeeping by automating data capture, invoice processing, reconciliation, and closing entries with AI-driven precision. ... ' +
  '- Industry: Technology, Information and Internet - Type: Privately held - Headquarters: Singapore, Singapore - Founded Year: 2023 - Homepage: simpleaiworks.com - Aliases: simple ai pte ltd., simpleai, simpleai inc. - LinkedIn: linkedin.com/company/simpleai.sg - Linkedin Followers: 2,302 - Emails: ask@simpleai.sg ... - Employees: 22 - Company Size: 11-50 employees - Yearly Growth: +15.8% ' +
  '- Key Executives: - Bryan Sng: Chief Operating Officer - Otto Von Domingo: Chief Revenue Officer (CRO) ' +
  '- Breakdown: - By Country: Singapore: 8 (36%), India: 2 (9%), Malaysia: 2 (9%), Austria: 1 (5%), Vietnam: 1 (5%) - By Department: Technical: 5 (23%), Product: 3 (14%), Sales: 3 (14%), General Management: 1 (5%), Marketing: 1 (5%), Operations: 1 (5%) - By Seniority: Manager: 5 (23%), Specialist: 5 (23%), Clevel: 2 (9%), Intern: 2 (9%) ... ' +
  'accounting, ai, ai agent, applications, artificial intelligence, automation, bookeeping, efficiency, finance, financial, hr, interface, invoice processing, learn & improve model, manual work, microsoft, ocr, quickbooks, saas, smart apps, smbs, smes, software, technology, worldwide, xero ... ' +
  '- Headquarters: singapore, singapore (SG) - Offices: shaw house singapore, singapore (SG), bukit merah, central region, singapore (SG), singapore, singapore (SG)';

const fact = (result: ReturnType<typeof parseEvidenceFacts>, key: string) =>
  result.facts.find((f) => f.key === key);

describe('parseEvidenceFacts — LinkedIn-style highlight', () => {
  const result = parseEvidenceFacts(LINKEDIN_SNIPPET);

  it('recognises the snippet as structured and keeps the leading prose', () => {
    expect(result.isStructured).toBe(true);
    expect(result.prose.startsWith('SimpleAI is a Technology')).toBe(true);
    expect(result.prose).not.toContain('- Industry:');
  });

  it('extracts the company facts with links where a link is safe', () => {
    expect(fact(result, 'industry')?.value).toBe('Technology, Information and Internet');
    expect(fact(result, 'type')?.value).toBe('Privately held');
    expect(fact(result, 'headquarters')?.value).toBe('Singapore, Singapore');
    expect(fact(result, 'founded')?.value).toBe('2023');
    expect(fact(result, 'website')).toMatchObject({ value: 'simpleaiworks.com', href: 'https://simpleaiworks.com' });
    expect(fact(result, 'linkedin')).toMatchObject({ href: 'https://linkedin.com/company/simpleai.sg' });
    expect(fact(result, 'followers')?.value).toBe('2,302');
    expect(fact(result, 'emails')).toMatchObject({ value: 'ask@simpleai.sg', href: 'mailto:ask@simpleai.sg' });
    expect(fact(result, 'employees')?.value).toBe('22');
    expect(fact(result, 'size')?.value).toBe('11-50 employees');
    expect(fact(result, 'growth')?.value).toBe('+15.8%');
    expect(fact(result, 'aliases')?.value).toBe('simple ai pte ltd., simpleai, simpleai inc.');
  });

  it('keeps the first Headquarters and drops the lowercase repeat', () => {
    expect(result.facts.filter((f) => f.key === 'headquarters')).toHaveLength(1);
  });

  it('splits executives into name and title', () => {
    expect(result.executives).toEqual([
      { name: 'Bryan Sng', title: 'Chief Operating Officer' },
      { name: 'Otto Von Domingo', title: 'Chief Revenue Officer (CRO)' },
    ]);
  });

  it('reads the workforce breakdown as counts and percentages', () => {
    expect(result.breakdown?.country[0]).toEqual({ label: 'Singapore', count: 8, pct: 36 });
    expect(result.breakdown?.country).toHaveLength(5);
    expect(result.breakdown?.department.map((r) => r.label)).toEqual([
      'Technical', 'Product', 'Sales', 'General Management', 'Marketing', 'Operations',
    ]);
    expect(result.breakdown?.seniority[2]).toEqual({ label: 'Clevel', count: 2, pct: 9 });
  });

  it('collects the trailing keyword list, deduplicated', () => {
    expect(result.keywords).toContain('artificial intelligence');
    expect(result.keywords).toContain('xero');
    expect(new Set(result.keywords).size).toBe(result.keywords.length);
    expect(result.keywords.length).toBeGreaterThanOrEqual(20);
  });
});

describe('parseEvidenceFacts — plain prose and bad input', () => {
  it('passes a DuckDuckGo-style sentence through untouched', () => {
    const prose = 'Acme Logistics provides cold-chain freight across Vietnam and Thailand since 2011.';
    const result = parseEvidenceFacts(prose);
    expect(result).toMatchObject({ isStructured: false, prose, facts: [], executives: [], breakdown: null, keywords: [] });
  });

  it('returns an empty result for null or blank input', () => {
    expect(parseEvidenceFacts(null)).toMatchObject({ isStructured: false, prose: '', facts: [] });
    expect(parseEvidenceFacts('   ')).toMatchObject({ isStructured: false, prose: '', facts: [] });
  });

  it('does not throw on partial or malformed sections', () => {
    const broken =
      'Intro. - Founded Year: - Key Executives: - Breakdown: - By Country: Singapore: abc - Homepage: javascript:alert(1) - Industry: Softw';
    const result = parseEvidenceFacts(broken);
    expect(result.isStructured).toBe(true);
    expect(fact(result, 'founded')).toBeUndefined();
    expect(result.executives).toEqual([]);
    expect(result.breakdown?.country ?? []).toEqual([]);
    expect(fact(result, 'website')?.href).toBeUndefined();
    expect(fact(result, 'industry')?.value).toBe('Softw');
  });

  it('never links anything but http(s) and mailto', () => {
    const result = parseEvidenceFacts('- Homepage: ftp://x.example - LinkedIn: data:text/html,hi - Emails: not an email');
    expect(fact(result, 'website')?.href).toBeUndefined();
    expect(fact(result, 'linkedin')?.href).toBeUndefined();
    expect(fact(result, 'emails')?.href).toBeUndefined();
  });
});

describe('parseEvidenceFacts — cost bounds', () => {
  it('stays fast on a hostile 100k-character breakdown with no separators', () => {
    // The breakdown row regex used an unbounded lazy group; a garbled highlight with no commas
    // or colons after "By Country:" cost ~4.8 s at 100k chars on the drawer's main thread.
    const hostile = `Intro. - Industry: Software - Breakdown: - By Country: ${'x'.repeat(100_000)}`;
    const startedAt = performance.now();
    const result = parseEvidenceFacts(hostile);
    expect(performance.now() - startedAt).toBeLessThan(250);
    expect(result.isStructured).toBe(true);
    expect(result.prose.length + result.facts.length).toBeGreaterThan(0);
  });

  it('parses at most MAX_PARSE_CHARS of a snippet', () => {
    const result = parseEvidenceFacts('a'.repeat(MAX_PARSE_CHARS + 500));
    expect(result.prose).toHaveLength(MAX_PARSE_CHARS);
  });
});

describe('candidateAttemptsWhere', () => {
  it('binds both arms to the tenant and the run arm to this candidate run only', () => {
    const where = candidateAttemptsWhere({ tenantId: 't-1', candidateId: 'c-1', runId: 'r-1' });
    expect(where.tenantId).toBe('t-1');
    expect(where.OR).toEqual([{ candidateId: 'c-1' }, { candidateId: null, runId: 'r-1' }]);
    // An attempt from another run in the same tenant does not match the run arm.
    const other: Record<string, unknown> = { tenantId: 't-1', candidateId: null, runId: 'r-2' };
    const arms = (where.OR ?? []) as Record<string, unknown>[];
    const matchesRunArm = arms.some((arm) => Object.entries(arm).every(([k, v]) => other[k] === v));
    expect(matchesRunArm).toBe(false);
  });
});
