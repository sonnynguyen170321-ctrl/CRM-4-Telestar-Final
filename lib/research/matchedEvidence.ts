/**
 * What a candidate was actually found to be, as short labelled facts with the quote behind each (owner
 * report, 2026-10-13). "Why it surfaced" used to show the run's own query terms as chips, so a person who
 * matched nothing still wore "Aviation" and "Afghanistan". Query terms say what we asked for, not what we
 * got. Everything here was read from the candidate's own evidence.
 *
 * No imports: safe in client components.
 */

export type MatchedFact = {
  label: 'Title' | 'Employer' | 'Location' | 'Industry' | 'Sells' | 'Headquarters' | 'Staff';
  value: string;
  /** The verbatim text it was read from, when there is one. */
  quote: string | null;
  /** How the fact stands against the run: only set where it is checked (a person's country). */
  standing?: 'inside' | 'outside' | 'unknown';
};

type PersonJson = {
  title?: unknown;
  titleSource?: unknown;
  employer?: unknown;
  location?: unknown;
  country?: unknown;
  geo?: unknown;
  evidence?: unknown;
};

type CompanyJson = { kind?: unknown; industry?: unknown; whatTheySell?: unknown; hqCountry?: unknown; employeeCount?: unknown };

export type EvidenceInput = {
  kind?: string | null;
  title?: string | null;
  companyName?: string | null;
  location?: string | null;
  country?: string | null;
  verificationJson?: unknown;
  sourceJson?: unknown;
};

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

function quoteFor(evidence: unknown, field: string): string | null {
  if (!Array.isArray(evidence)) return null;
  const hit = evidence.find((item) => item && typeof item === 'object' && (item as { field?: unknown }).field === field);
  return text((hit as { quote?: unknown } | undefined)?.quote);
}

function personFacts(input: EvidenceInput): MatchedFact[] {
  const person = ((input.verificationJson as { person?: PersonJson } | null)?.person ?? {}) as PersonJson;
  const profile = ((input.sourceJson as { profile?: { location?: unknown; country?: unknown } } | null)?.profile ?? {}) as {
    location?: unknown;
    country?: unknown;
  };
  const out: MatchedFact[] = [];

  const title = text(person.title) ?? text(input.title);
  if (title) out.push({ label: 'Title', value: title, quote: quoteFor(person.evidence, 'title') });

  const employer = text(person.employer) ?? text(input.companyName);
  if (employer) out.push({ label: 'Employer', value: employer, quote: quoteFor(person.evidence, 'employer') });

  const location = text(person.location) ?? text(input.location) ?? text(profile.location);
  const country = text(person.country) ?? text(input.country) ?? text(profile.country);
  if (location || country) {
    const geo = text(person.geo);
    out.push({
      label: 'Location',
      value: location && country && !location.toLowerCase().includes(country.toLowerCase()) ? `${location}, ${country}` : (location ?? country)!,
      quote: quoteFor(person.evidence, 'location'),
      standing: geo === 'match' ? 'inside' : geo === 'outside' ? 'outside' : geo === 'unknown' ? 'unknown' : undefined,
    });
  }
  return out;
}

function companyFacts(input: EvidenceInput): MatchedFact[] {
  const company = ((input.verificationJson as { company?: CompanyJson } | null)?.company ?? {}) as CompanyJson;
  const out: MatchedFact[] = [];
  const industry = text(company.industry);
  if (industry) out.push({ label: 'Industry', value: industry, quote: null });
  const sells = text(company.whatTheySell);
  if (sells) out.push({ label: 'Sells', value: sells, quote: null });
  const hq = text(company.hqCountry);
  if (hq) out.push({ label: 'Headquarters', value: hq, quote: null });
  if (typeof company.employeeCount === 'number') out.push({ label: 'Staff', value: company.employeeCount.toLocaleString('en-US'), quote: null });
  return out;
}

/** The facts read from this candidate's own evidence. Empty when nothing was read: the UI then says so. */
export function matchedEvidence(input: EvidenceInput): MatchedFact[] {
  return input.kind === 'contact' ? personFacts(input) : companyFacts(input);
}
