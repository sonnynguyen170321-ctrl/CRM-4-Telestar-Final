import { prisma, withTenantRaw } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { canAccessLead, type SessionUser } from '@/lib/auth';
import { normalizeEmail, normalizePhone, normalizeLinkedIn } from '@/lib/leads/normalize';
import { getEvidenceForLead } from '@/lib/research/engine';
import { buildPoolDuplicateKey } from './pool';

/**
 * Lead quality evaluation against the campaign's own requirements (Phase 8a).
 *
 * **The ICP lives in `CampaignLeadRequirement` and nowhere else.** Not in the playbook —
 * `lib/playbooks/policy.ts` is a `.strict()` schema that *rejects* an `icp` key — and not in a
 * second AI-owned qualification table. This reads the requirement rows the leadgen team already
 * maintains and reports how a lead measures against them.
 *
 * It returns an **assessment, not a verdict written to the CRM**. Nothing here changes a lead's
 * qualification, moves a pool item or touches a requirement's counters.
 *
 * ## Canonical source and precedence, per criterion
 *
 * The lead is the outreach record; the linked `Account` and `Contact` are where the firmographic
 * and geographic facts actually live. Precedence runs from the most specific record outward, and
 * nothing is ever inferred:
 *
 * | Criterion | Source, in precedence order |
 * |---|---|
 * | `targetTitles` | `Lead.title` → `Contact.title` |
 * | `targetIndustries` | `Account.industry` |
 * | `targetCountries` | `Contact.country` → `Account.country` |
 * | `companySizeMin`/`Max` | `Account.size` → `Account.staffCountMin`/`staffCountMax` |
 * | `requiredFields` | `SUPPORTED_REQUIRED_FIELDS`, resolved from Lead/Contact/Account |
 *
 * ## `unknown` is not `unmet`, and it is not a pass
 *
 * A criterion the CRM holds no value for is `unknown`: the lead is not disqualified, but the
 * requirement is **not** fully met either. `meetsAnyRequirement` demands every configured
 * criterion be judged and met — the earlier `unmet.length === 0` test reported a requirement met
 * while its mandatory criteria were unresolved, which is a false positive on the exact question
 * a client is billed against.
 */

/**
 * Fields a requirement may name in `requiredFields`, and where each is read from.
 *
 * An explicit map rather than arbitrary property access on a partially-selected object: the
 * previous cast reported a configured field missing whenever *this query* had not selected it,
 * which is a bug in the reader being blamed on the data.
 */
export const SUPPORTED_REQUIRED_FIELDS = [
  'email',
  'phone',
  'linkedIn',
  'whatsApp',
  'title',
  'company',
  'firstName',
  'lastName',
  'country',
  'industry',
  'website',
  'companySize',
] as const;

export type SupportedRequiredField = (typeof SUPPORTED_REQUIRED_FIELDS)[number];

export function isSupportedRequiredField(field: string): field is SupportedRequiredField {
  return (SUPPORTED_REQUIRED_FIELDS as readonly string[]).includes(field);
}

/**
 * Everything `matchRequirement` needs to read, as one selection.
 *
 * Exported so ICP adherence reporting queries exactly what the matcher reads. A report that
 * assembled its own `select` would drift the moment a criterion started reading a new column, and
 * the failure would be silent: a missing column reads as `unknown`, so the report would quietly
 * start calling matched leads unresolved.
 */
export const LEAD_QUALITY_INCLUDE = {
  account: {
    select: {
      industry: true,
      country: true,
      size: true,
      staffCountMin: true,
      staffCountMax: true,
      website: true,
    },
  },
  contact: { select: { title: true, country: true, phone: true, linkedIn: true, whatsApp: true } },
} as const;

export type LeadForQuality = Prisma.LeadGetPayload<{
  include: {
    account: {
      select: {
        industry: true;
        country: true;
        size: true;
        staffCountMin: true;
        staffCountMax: true;
        website: true;
      };
    };
    contact: { select: { title: true; country: true; phone: true; linkedIn: true; whatsApp: true } };
  };
}>;

export interface RequirementMatch {
  requirementId: string;
  campaignId: string;
  /** Criteria the lead satisfies, named. */
  met: string[];
  /** Criteria it fails, named. */
  unmet: string[];
  /** Criteria the CRM holds no value for. Neither a pass nor a failure. */
  unknown: string[];
  /** True only when every configured criterion was judged and met. */
  fullyMet: boolean;
}

export interface LeadQualityAssessment {
  leadId: string;
  /** True when at least one requirement is **fully** met — nothing unmet and nothing unknown. */
  meetsAnyRequirement: boolean;
  requirements: RequirementMatch[];
  duplicateKey: string | null;
  duplicateLeadIds: string[];
  citedEvidenceIds: string[];
  summary: string;
}

export class LeadQualityAccessError extends Error {
  constructor(leadId: string) {
    super(`Unauthorized lead quality evaluation for lead ${leadId}`);
    this.name = 'LeadQualityAccessError';
  }
}

export async function evaluateLeadQuality(
  user: SessionUser,
  input: { tenantId: string; leadId: string }
): Promise<LeadQualityAssessment> {
  const lead = (await prisma.lead.findUnique({
    where: { id: input.leadId },
    include: LEAD_QUALITY_INCLUDE,
  })) as LeadForQuality | null;

  if (!lead || lead.tenantId !== input.tenantId) throw new LeadQualityAccessError(input.leadId);
  if (!(await canAccessLead(user, lead))) throw new LeadQualityAccessError(input.leadId);

  const requirements = await prisma.campaignLeadRequirement.findMany({
    where: { tenantId: input.tenantId, campaignId: lead.campaignId, status: 'open' },
  });

  const matches = requirements.map((req) => matchRequirement(lead, req));

  const duplicateKey = buildPoolDuplicateKey(lead);
  const duplicateLeadIds = duplicateKey
    ? await findDuplicateLeadIds(input.tenantId, lead, duplicateKey)
    : [];

  const evidence = await getEvidenceForLead(input.tenantId, lead.id);
  const citedEvidenceIds = [
    ...evidence.companySignals.map((s) => s.id),
    ...evidence.accountPainHypotheses.map((p) => p.id),
    ...evidence.personalizationHooks.map((h) => h.id),
  ];

  return {
    leadId: lead.id,
    meetsAnyRequirement: matches.some((m) => m.fullyMet),
    requirements: matches,
    duplicateKey,
    duplicateLeadIds,
    citedEvidenceIds,
    summary: describeAssessment(matches, duplicateLeadIds.length, citedEvidenceIds.length),
  };
}

/**
 * Judge one lead against one requirement. The single definition of "does this match the ICP".
 *
 * Exported so `lib/leadgen/icpAdherence.ts` measures adherence with the same rules the per-lead
 * assessment uses. A percentage computed by a second implementation would eventually disagree
 * with the assessment shown next to it, and there would be no way to say which was right.
 */
export function matchRequirement(
  lead: LeadForQuality,
  req: {
    id: string;
    campaignId: string;
    targetTitles: string[];
    targetIndustries: string[];
    targetCountries: string[];
    companySizeMin: number | null;
    companySizeMax: number | null;
    requiredFields: string[];
  }
): RequirementMatch {
  const met: string[] = [];
  const unmet: string[] = [];
  const unknown: string[] = [];

  const record = (label: string, verdict: 'met' | 'unmet' | 'unknown') => {
    if (verdict === 'met') met.push(label);
    else if (verdict === 'unmet') unmet.push(label);
    else unknown.push(label);
  };

  if (req.targetTitles.length > 0) {
    const title = firstValue(lead.title, lead.contact?.title);
    record('title', judgeText(title, req.targetTitles, 'contains'));
  }

  if (req.targetIndustries.length > 0) {
    record('industry', judgeText(lead.account?.industry ?? null, req.targetIndustries, 'contains'));
  }

  if (req.targetCountries.length > 0) {
    const country = firstValue(lead.contact?.country, lead.account?.country);
    record('country', judgeText(country, req.targetCountries, 'equals'));
  }

  if (req.companySizeMin !== null || req.companySizeMax !== null) {
    record('companySize', judgeCompanySize(lead, req.companySizeMin, req.companySizeMax));
  }

  for (const field of req.requiredFields) {
    if (!isSupportedRequiredField(field)) {
      // An unrecognised requirement is not silently satisfied. It is unknown until someone
      // teaches this map how to read it.
      record(`requiredField:${field}`, 'unknown');
      continue;
    }
    record(`requiredField:${field}`, resolveRequiredField(lead, field) ? 'met' : 'unmet');
  }

  const configured = met.length + unmet.length + unknown.length;

  return {
    requirementId: req.id,
    campaignId: req.campaignId,
    met,
    unmet,
    unknown,
    // Fully met means every configured criterion was judged and passed. A requirement with no
    // criteria at all is not a pass either — there is nothing it asserts about the lead.
    fullyMet: configured > 0 && unmet.length === 0 && unknown.length === 0,
  };
}

function firstValue(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    if (value && value.trim()) return value;
  }
  return null;
}

function judgeText(
  value: string | null,
  targets: string[],
  mode: 'contains' | 'equals'
): 'met' | 'unmet' | 'unknown' {
  if (!value) return 'unknown';
  const needle = value.toLowerCase();
  const hit = targets.some((target) => {
    const t = target.toLowerCase().trim();
    return mode === 'equals' ? needle.trim() === t : needle.includes(t);
  });
  return hit ? 'met' : 'unmet';
}

/**
 * Company size against the requirement band.
 *
 * `Account.size` is the headcount when it is known. Failing that, the staff-count band is used:
 * it satisfies the requirement only when the **whole** band fits, because a range that merely
 * overlaps does not establish the company is in it.
 */
function judgeCompanySize(
  lead: LeadForQuality,
  min: number | null,
  max: number | null
): 'met' | 'unmet' | 'unknown' {
  const account = lead.account;
  if (!account) return 'unknown';

  if (typeof account.size === 'number') {
    if (min !== null && account.size < min) return 'unmet';
    if (max !== null && account.size > max) return 'unmet';
    return 'met';
  }

  const bandMin = account.staffCountMin;
  const bandMax = account.staffCountMax;
  if (bandMin === null && bandMax === null) return 'unknown';

  if (min !== null && (bandMin === null || bandMin < min)) {
    return bandMax !== null && bandMax < min ? 'unmet' : 'unknown';
  }
  if (max !== null && (bandMax === null || bandMax > max)) {
    return bandMin !== null && bandMin > max ? 'unmet' : 'unknown';
  }
  return 'met';
}

function resolveRequiredField(lead: LeadForQuality, field: SupportedRequiredField): boolean {
  const present = (value: unknown): boolean =>
    typeof value === 'string' ? value.trim().length > 0 : typeof value === 'number';

  switch (field) {
    case 'email':
      return present(lead.email);
    case 'phone':
      return present(lead.phone) || present(lead.contact?.phone);
    case 'linkedIn':
      return present(lead.linkedIn) || present(lead.contact?.linkedIn);
    case 'whatsApp':
      return present(lead.whatsApp) || present(lead.contact?.whatsApp);
    case 'title':
      return present(lead.title) || present(lead.contact?.title);
    case 'company':
      return present(lead.company);
    case 'firstName':
      return present(lead.firstName);
    case 'lastName':
      return present(lead.lastName);
    case 'country':
      return present(lead.contact?.country) || present(lead.account?.country);
    case 'industry':
      return present(lead.account?.industry);
    case 'website':
      return present(lead.account?.website);
    case 'companySize':
      return (
        present(lead.account?.size) ||
        present(lead.account?.staffCountMin) ||
        present(lead.account?.staffCountMax)
      );
  }
}

/**
 * Leads sharing this lead's pool identity.
 *
 * Queried in the database, with the *same* normalization `buildPoolDuplicateKey` applies, rather
 * than loading a page of leads and comparing keys in memory — the old `take: 1000` turned every
 * duplicate past that arbitrary window into a false negative, and a false negative here is a
 * second person receiving the same campaign.
 *
 * The tier guards reproduce the key function's precedence exactly: it returns the *first*
 * available identifier, so a candidate matching on phone is only a duplicate when it, too, has
 * no email — otherwise its own key would be the email one and the two keys would differ.
 */
async function findDuplicateLeadIds(
  tenantId: string,
  lead: LeadForQuality,
  duplicateKey: string
): Promise<string[]> {
  const [tier, ...rest] = duplicateKey.split(':');
  const value = rest.join(':');

  const rows = await matchByTier(tenantId, lead.id, tier, value, lead);
  return rows.map((row) => row.id);
}

/**
 * Raw SQL is outside the tenant extension, so each tier query sets its own context via
 * `withTenantRaw` — see the note in `lib/prisma.ts`. Unwrapped under RLS these return no rows,
 * which reads as "no duplicate found" and would let every duplicate through silently.
 *
 * Wrapped per statement rather than around the whole switch: the `default` branch calls
 * `fallbackKeyScan`, which uses model operations, and those open their own transaction.
 */
async function matchByTier(
  tenantId: string,
  leadId: string,
  tier: string,
  value: string,
  lead: LeadForQuality
): Promise<Array<{ id: string }>> {
  switch (tier) {
    case 'email':
      return withTenantRaw(tenantId, (db) => db.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Lead"
        WHERE "tenantId" = ${tenantId} AND id <> ${leadId}
          AND lower(btrim(email)) = ${value}
      `);
    case 'phone':
      return withTenantRaw(tenantId, (db) => db.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Lead"
        WHERE "tenantId" = ${tenantId} AND id <> ${leadId}
          AND (email IS NULL OR btrim(email) = '')
          AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = ${value}
      `);
    case 'linkedin':
      return withTenantRaw(tenantId, (db) => db.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Lead"
        WHERE "tenantId" = ${tenantId} AND id <> ${leadId}
          AND (email IS NULL OR btrim(email) = '')
          AND (phone IS NULL OR btrim(phone) = '')
          AND lower(btrim("linkedIn")) = ${value}
      `);
    case 'name': {
      const [firstName, lastName, company] = value.split('|');
      return withTenantRaw(tenantId, (db) => db.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Lead"
        WHERE "tenantId" = ${tenantId} AND id <> ${leadId}
          AND (email IS NULL OR btrim(email) = '')
          AND (phone IS NULL OR btrim(phone) = '')
          AND ("linkedIn" IS NULL OR btrim("linkedIn") = '')
          AND lower(btrim("firstName")) = ${firstName}
          AND lower(btrim("lastName")) = ${lastName}
          AND lower(btrim(company)) = ${company}
      `);
    }
    default:
      // An unrecognised tier means `buildPoolDuplicateKey` grew a case this query has not been
      // taught. Fall back to the key comparison rather than silently reporting no duplicates.
      return fallbackKeyScan(tenantId, leadId, lead);
  }
}

async function fallbackKeyScan(
  tenantId: string,
  leadId: string,
  lead: LeadForQuality
): Promise<Array<{ id: string }>> {
  const key = buildPoolDuplicateKey(lead);
  const candidates = await prisma.lead.findMany({
    where: { tenantId, id: { not: leadId } },
    select: { id: true, email: true, phone: true, linkedIn: true, firstName: true, lastName: true, company: true },
  });
  return candidates.filter((candidate) => buildPoolDuplicateKey(candidate) === key).map((c) => ({ id: c.id }));
}

/** Exposed so a test can prove the SQL tiers agree with the key function's normalization. */
export function duplicateKeyComponents(lead: {
  email?: string | null;
  phone?: string | null;
  linkedIn?: string | null;
}): { email: string | null; phone: string | null; linkedIn: string | null } {
  return {
    email: normalizeEmail(lead.email),
    phone: normalizePhone(lead.phone),
    linkedIn: normalizeLinkedIn(lead.linkedIn),
  };
}

function describeAssessment(
  matches: RequirementMatch[],
  duplicateCount: number,
  evidenceCount: number
): string {
  if (matches.length === 0) {
    return 'No open lead requirement for this campaign — nothing to measure this lead against.';
  }
  const parts = matches.map(
    (m) =>
      `requirement ${m.requirementId}: ${m.met.length} met, ${m.unmet.length} unmet, ${m.unknown.length} unknown` +
      (m.unknown.length > 0 ? ' (not fully met — unresolved criteria)' : '')
  );
  if (duplicateCount > 0) parts.push(`${duplicateCount} possible duplicate lead(s) in this tenant`);
  parts.push(evidenceCount > 0 ? `${evidenceCount} research evidence row(s) available` : 'no research evidence yet');
  return parts.join('; ');
}
