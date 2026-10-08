/**
 * Display-only parser for a research evidence snippet.
 *
 * Exa's highlight for a LinkedIn company page is one paragraph of prose followed by a run of
 * `- Label: value` pairs, a `- Key Executives:` list, a `- Breakdown:` of the workforce and a
 * comma-separated keyword list. Rendered raw it is a 1,500-character wall the reader scans by
 * eye for the headquarters. This turns it back into the record it was.
 *
 * Nothing here is a scoring input. `fitScore` and qualification read from the research run's
 * own evidence tables; this module is imported by the evidence card and by nothing else. The
 * format is undocumented and may drift, so every branch fails soft: an unrecognised snippet
 * comes back as prose with `isStructured: false`, and a half-recognised one returns whatever
 * did parse.
 */

export type EvidenceFactKey =
  | 'industry'
  | 'type'
  | 'headquarters'
  | 'founded'
  | 'website'
  | 'linkedin'
  | 'followers'
  | 'emails'
  | 'employees'
  | 'size'
  | 'growth'
  | 'aliases';

export type EvidenceFact = {
  key: EvidenceFactKey;
  label: string;
  value: string;
  /** Only ever `https://…` or `mailto:…`; absent when the value is not safely linkable. */
  href?: string;
};

export type EvidenceExecutive = { name: string; title: string };

export type EvidenceBreakdownRow = { label: string; count: number; pct: number | null };

export type EvidenceBreakdown = {
  country: EvidenceBreakdownRow[];
  department: EvidenceBreakdownRow[];
  seniority: EvidenceBreakdownRow[];
};

export type EvidenceFacts = {
  facts: EvidenceFact[];
  executives: EvidenceExecutive[];
  breakdown: EvidenceBreakdown | null;
  keywords: string[];
  /** The narrative part — everything before the first recognised label, or the whole snippet. */
  prose: string;
  isStructured: boolean;
};

const MAX_KEYWORDS = 40;
/**
 * A provider highlight has no length cap on the way in (`sourceSnippet` is Postgres `text`), and
 * this runs on the main thread of the drawer. Past this the text is prose to the reader anyway.
 */
export const MAX_PARSE_CHARS = 8_000;

/** Exa's label spellings, mapped onto stable keys. First occurrence of a key wins. */
const FACT_LABELS: ReadonlyArray<{ key: EvidenceFactKey; label: string; aliases: string[] }> = [
  { key: 'industry', label: 'Industry', aliases: ['industry'] },
  { key: 'type', label: 'Type', aliases: ['type'] },
  { key: 'headquarters', label: 'Headquarters', aliases: ['headquarters', 'hq'] },
  { key: 'founded', label: 'Founded', aliases: ['founded year', 'founded'] },
  { key: 'website', label: 'Website', aliases: ['homepage', 'website'] },
  { key: 'linkedin', label: 'LinkedIn', aliases: ['linkedin'] },
  { key: 'followers', label: 'Followers', aliases: ['linkedin followers', 'followers'] },
  { key: 'emails', label: 'Email', aliases: ['emails', 'email'] },
  { key: 'employees', label: 'Employees', aliases: ['employees'] },
  { key: 'size', label: 'Company size', aliases: ['company size'] },
  { key: 'growth', label: 'Yearly growth', aliases: ['yearly growth', 'growth'] },
  { key: 'aliases', label: 'Also known as', aliases: ['aliases'] },
];

const SECTION_LABELS = {
  executives: 'key executives',
  breakdown: 'breakdown',
  country: 'by country',
  department: 'by department',
  seniority: 'by seniority',
} as const;

const EMPTY: EvidenceFacts = {
  facts: [],
  executives: [],
  breakdown: null,
  keywords: [],
  prose: '',
  isStructured: false,
};

// A segment boundary is " - " followed by something label-shaped ("Founded Year:", "Bryan Sng:").
const SEGMENT_BOUNDARY = /\s+-\s+(?=[A-Za-z][^:]{0,60}:)/;
const LABEL_VALUE = /^([A-Za-z][^:]{0,60}?):\s*([\s\S]*)$/;
const BREAKDOWN_ROW = /([^,:]{1,120}?):\s*(\d[\d,]*)\s*(?:\((\d+(?:\.\d+)?)%\))?/g;
const ELLIPSIS = /\s*(?:\.\.\.|…)\s*/g;
const BARE_DOMAIN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

export function parseEvidenceFacts(snippet: string | null | undefined): EvidenceFacts {
  const text = (snippet ?? '').trim();
  if (!text) return EMPTY;
  try {
    return parse(text.slice(0, MAX_PARSE_CHARS));
  } catch {
    return { ...EMPTY, prose: text.slice(0, MAX_PARSE_CHARS) };
  }
}

function parse(text: string): EvidenceFacts {
  const segments = text.split(SEGMENT_BOUNDARY);
  const firstLabelled = segments.findIndex((segment) => classify(segment) !== 'unknown');
  if (firstLabelled === -1) return { ...EMPTY, prose: text };

  const prose = clean(segments.slice(0, firstLabelled).join(' - '));
  const seen = new Set<EvidenceFactKey>();
  const facts: EvidenceFact[] = [];
  const executives: EvidenceExecutive[] = [];
  const breakdown: EvidenceBreakdown = { country: [], department: [], seniority: [] };
  const keywords: string[] = [];
  let mode: 'facts' | 'executives' | 'breakdown' = 'facts';

  for (const segment of segments.slice(firstLabelled)) {
    const match = LABEL_VALUE.exec(segment.trim());
    if (!match) continue;
    const label = match[1].trim().toLowerCase();
    const rawValue = match[2];
    const kind = classify(segment);

    if (kind === 'section') {
      if (label === SECTION_LABELS.executives) mode = 'executives';
      else if (label === SECTION_LABELS.breakdown) mode = 'breakdown';
      else if (label === SECTION_LABELS.country) breakdown.country = parseBreakdownRows(rawValue, keywords);
      else if (label === SECTION_LABELS.department) breakdown.department = parseBreakdownRows(rawValue, keywords);
      else if (label === SECTION_LABELS.seniority) breakdown.seniority = parseBreakdownRows(rawValue, keywords);
      continue;
    }

    if (kind === 'fact') {
      mode = 'facts';
      const definition = FACT_LABELS.find((entry) => entry.aliases.includes(label));
      if (!definition || seen.has(definition.key)) continue;
      const value = clean(rawValue);
      if (!value) continue;
      seen.add(definition.key);
      facts.push({ key: definition.key, label: definition.label, value, ...linkFor(definition.key, value) });
      continue;
    }

    // Unknown label: inside the executives list it is "Name: Title"; elsewhere it is noise.
    if (mode === 'executives') {
      const name = match[1].trim();
      const title = clean(rawValue);
      if (name && title) executives.push({ name, title });
    }
  }

  const hasBreakdown = breakdown.country.length + breakdown.department.length + breakdown.seniority.length > 0;

  return {
    facts,
    executives,
    breakdown: hasBreakdown || mode === 'breakdown' ? breakdown : null,
    keywords: dedupe(keywords).slice(0, MAX_KEYWORDS),
    prose,
    isStructured: true,
  };
}

function classify(segment: string): 'fact' | 'section' | 'unknown' {
  const match = LABEL_VALUE.exec(segment.trim());
  if (!match) return 'unknown';
  const label = match[1].trim().toLowerCase();
  if (FACT_LABELS.some((entry) => entry.aliases.includes(label))) return 'fact';
  if ((Object.values(SECTION_LABELS) as string[]).includes(label)) return 'section';
  return 'unknown';
}

/**
 * "Singapore: 8 (36%), India: 2 (9%) ... accounting, ai, xero ..." — rows up to the last
 * percentage; whatever trails it is Exa's keyword list, which has no label of its own.
 */
function parseBreakdownRows(value: string, keywordsOut: string[]): EvidenceBreakdownRow[] {
  const rows: EvidenceBreakdownRow[] = [];
  let lastIndex = 0;
  for (const match of value.matchAll(BREAKDOWN_ROW)) {
    const count = Number.parseInt(match[2].replace(/,/g, ''), 10);
    if (!Number.isFinite(count)) continue;
    rows.push({
      label: clean(match[1]),
      count,
      pct: match[3] === undefined ? null : Number.parseFloat(match[3]),
    });
    lastIndex = match.index + match[0].length;
  }
  const tail = value.slice(lastIndex).replace(ELLIPSIS, ' ');
  for (const word of tail.split(',')) {
    const keyword = word.trim().replace(/^[\s,]+|[\s,]+$/g, '');
    if (keyword && !/:/.test(keyword)) keywordsOut.push(keyword);
  }
  return rows;
}

function linkFor(key: EvidenceFactKey, value: string): { href?: string } {
  if (key === 'website' || key === 'linkedin') {
    const candidate = value.split(/\s+/)[0] ?? '';
    if (/^https?:\/\//i.test(candidate)) return { href: candidate };
    if (BARE_DOMAIN.test(candidate)) return { href: `https://${candidate}` };
    return {};
  }
  if (key === 'emails') {
    const email = EMAIL.exec(value)?.[0];
    return email ? { href: `mailto:${email}` } : {};
  }
  return {};
}

function clean(value: string): string {
  return value.replace(ELLIPSIS, ' ').replace(/\s+/g, ' ').trim();
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
