import type {
  IdentityCompanyCandidate,
  IdentityContactCandidate,
  IdentityResolutionInput,
  IdentityResolutionReason,
  IdentityResolutionResult,
  NormalizedIdentityRow,
} from "./types";

const EXACT_COMPANY_DOMAIN_CONFIDENCE = 0.95;
const EXACT_CONTACT_CONFIDENCE = 0.98;
const EXACT_NAME_IN_CONTEXT_CONFIDENCE = 0.88;
const FUZZY_CANDIDATE_CONFIDENCE = 0.62;

const GENERIC_EMAIL_LOCAL_PARTS = new Set([
  "info",
  "sales",
  "support",
  "hello",
  "contact",
  "admin",
  "marketing",
  "team",
  "office",
  "careers",
  "jobs",
  "hr",
  "noreply",
  "no-reply",
]);

const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "aol.com",
  "protonmail.com",
  "zoho.com",
  "live.com",
  "msn.com",
]);

// Vietnamese legal forms, diacritics already stripped, ordered LONGEST-FIRST so the most specific
// match wins. Company/lead identity must not split on the legal form (Invariant 11), which appears as
// a PREFIX ("Cong ty TNHH ABC") or a SUFFIX ("ABC TNHH"), and in many short-forms
// (MTV = mot thanh vien / single-member, DNTN = doanh nghiep tu nhan / sole proprietor, CTCP, Cty).
const VIETNAMESE_LEGAL_FORMS = [
  "cong ty tnhh mot thanh vien",
  "cong ty tnhh hai thanh vien",
  "cong ty tnhh mtv",
  "cong ty co phan",
  "cong ty co phan tap doan",
  "doanh nghiep tu nhan",
  "cong ty tnhh",
  "cong ty cp",
  "tnhh mot thanh vien",
  "tnhh hai thanh vien",
  "cong ty",
  "tnhh mtv",
  "co phan",
  "cty tnhh",
  "cty cp",
  "ctcp",
  "dntn",
  "cty",
  "tnhh",
  "mtv",
  "cp",
];

// Strip a legal form from the front OR back, repeating until stable (a name can carry both a prefix
// and a trailing form). Mid-string occurrences are left alone to avoid mangling real words.
function stripVietnameseLegalForms(name: string): string {
  let current = name;
  let changed = true;
  while (changed) {
    changed = false;
    for (const form of VIETNAMESE_LEGAL_FORMS) {
      if (current === form) {
        return "";
      }
      if (current.startsWith(`${form} `)) {
        current = current.slice(form.length + 1).trim();
        changed = true;
        break;
      }
      if (current.endsWith(` ${form}`)) {
        current = current.slice(0, current.length - form.length - 1).trim();
        changed = true;
        break;
      }
    }
  }
  return current;
}

export function resolveIdentity(
  input: IdentityResolutionInput
): IdentityResolutionResult {
  const reasons = new Set<IdentityResolutionReason>();
  const companiesByTenant = filterCompaniesByTenant(
    input.candidates.companies,
    input.context.organizationId,
    reasons
  );
  const contactsByTenant = filterContactsByTenant(
    input.candidates.contacts,
    input.context.organizationId,
    reasons
  );
  const contextCompanies = narrowCompaniesByContext(
    companiesByTenant,
    input.context.accountId,
    input.context.projectId,
    reasons
  );
  const rowDomain = resolveCompanyIdentityDomain(input.row, reasons);
  const rowCompanyName = normalizeCompanyName(input.row.companyName);

  // Step 1: Resolve contact independently across all tenant contacts
  // This runs BEFORE any company resolution so that an existing contact is
  // always found regardless of how (or whether) the company is matched.
  // Previously this was nested inside the domain-match block, causing
  // duplicate V2Contact creation when the company was only name-matched
  // or entirely new.
  const resolvedContact = resolveExactContact(
    input.row,
    contactsByTenant,
    reasons
  );

  // Step 2: Resolve company (domain -> exact name -> fuzzy name)

  if (rowDomain) {
    const domainMatches = contextCompanies.filter((candidate) =>
      getCompanyDomains(candidate).includes(rowDomain)
    );

    if (domainMatches.length === 1) {
      const company = domainMatches[0];
      reasons.add("company_domain_exact");

      if (resolvedContact) {
        return result("exact_contact", EXACT_CONTACT_CONFIDENCE, reasons, {
          companyId: company.id,
          contactId: resolvedContact.id,
        });
      }

      return result("exact_company", EXACT_COMPANY_DOMAIN_CONFIDENCE, reasons, {
        companyId: company.id,
      });
    }
  }

  if (rowCompanyName) {
    const exactNameMatches = contextCompanies.filter((candidate) =>
      getCompanyNames(candidate).includes(rowCompanyName)
    );

    if (exactNameMatches.length === 1) {
      reasons.add("company_name_exact_in_context");

      // If the contact was independently resolved, upgrade to exact_contact
      if (resolvedContact) {
        return result("exact_contact", EXACT_CONTACT_CONFIDENCE, reasons, {
          companyId: exactNameMatches[0].id,
          contactId: resolvedContact.id,
        });
      }

      return result("exact_company", EXACT_NAME_IN_CONTEXT_CONFIDENCE, reasons, {
        companyId: exactNameMatches[0].id,
      });
    }

    const fuzzyMatches = contextCompanies
      .map((candidate) => ({
        candidate,
        score: Math.max(
          ...getCompanyNames(candidate).map((name) =>
            computeNameSimilarity(rowCompanyName, name)
          ),
          0
        ),
      }))
      .filter((match) => match.score >= 0.6)
      .sort((left, right) => right.score - left.score);

    if (fuzzyMatches.length > 0) {
      reasons.add("fuzzy_company_name_candidate_only");

      // If the contact was independently resolved, include it in the candidate result
      if (resolvedContact) {
        return result("candidate", FUZZY_CANDIDATE_CONFIDENCE, reasons, {
          companyId: fuzzyMatches[0].candidate.id,
          contactId: resolvedContact.id,
        });
      }

      return result("candidate", FUZZY_CANDIDATE_CONFIDENCE, reasons, {
        companyId: fuzzyMatches[0].candidate.id,
      });
    }
  }

  // Step 3: No company found at all
  // Even without a company match, if the contact was resolved, return it
  // so the upsert layer can create a new company and link it.
  if (resolvedContact) {
    return result("exact_contact", EXACT_CONTACT_CONFIDENCE, reasons, {
      companyId: resolvedContact.companyId,
      contactId: resolvedContact.id,
    });
  }

  reasons.add("no_usable_identity_evidence");

  return result("none", 0, reasons);
}

export function normalizeIdentityText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value)
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

  return text.length > 0 ? text : null;
}

export function normalizeIdentityDomain(value: unknown): string | null {
  const text = normalizeIdentityText(value);

  if (!text) {
    return null;
  }

  const host = text
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .split(/[/?#]/)[0]
    .replace(/^www\./, "");

  return host.length > 0 ? host : null;
}

export function normalizeCompanyName(value: unknown): string | null {
  const text = stripDiacritics(normalizeIdentityText(value));

  if (!text) {
    return null;
  }

  const withoutPunctuation = text
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const withoutLegalForm = stripVietnameseLegalForms(withoutPunctuation);

  return withoutLegalForm.length > 0 ? withoutLegalForm : null;
}

export function isGenericEmail(value: string | null | undefined): boolean {
  const email = normalizeIdentityText(value);

  if (!email || !email.includes("@")) {
    return false;
  }

  return GENERIC_EMAIL_LOCAL_PARTS.has(email.split("@")[0]);
}

export function isPublicEmailDomain(value: string | null | undefined): boolean {
  const text = normalizeIdentityText(value);
  const domain = normalizeIdentityDomain(text?.includes("@") ? text.split("@")[1] : text);

  return domain !== null && PUBLIC_EMAIL_DOMAINS.has(domain);
}

function filterCompaniesByTenant(
  candidates: IdentityCompanyCandidate[],
  organizationId: string,
  reasons: Set<IdentityResolutionReason>
): IdentityCompanyCandidate[] {
  return candidates.filter((candidate) => {
    const matchesTenant = candidate.organizationId === organizationId;

    if (!matchesTenant) {
      reasons.add("tenant_mismatch_ignored");
    }

    return matchesTenant;
  });
}

function filterContactsByTenant(
  candidates: IdentityContactCandidate[],
  organizationId: string,
  reasons: Set<IdentityResolutionReason>
): IdentityContactCandidate[] {
  return candidates.filter((candidate) => {
    const matchesTenant = candidate.organizationId === organizationId;

    if (!matchesTenant) {
      reasons.add("tenant_mismatch_ignored");
    }

    return matchesTenant;
  });
}

function narrowCompaniesByContext(
  candidates: IdentityCompanyCandidate[],
  accountId: string | null | undefined,
  projectId: string | null | undefined,
  reasons: Set<IdentityResolutionReason>
): IdentityCompanyCandidate[] {
  return candidates.filter((candidate) => {
    const matchesAccount = !accountId || candidate.accountId === accountId;
    const matchesProject =
      !projectId ||
      candidate.projectIds === undefined ||
      candidate.projectIds.includes(projectId);
    const matchesContext = matchesAccount && matchesProject;

    if (!matchesContext) {
      reasons.add("context_mismatch_ignored");
    }

    return matchesContext;
  });
}

function resolveCompanyIdentityDomain(
  row: NormalizedIdentityRow,
  reasons: Set<IdentityResolutionReason>
): string | null {
  const explicitDomain =
    normalizeIdentityDomain(row.canonicalDomain) ?? normalizeIdentityDomain(row.website);
  const emailDomain = extractEmailDomain(row.contactEmail);

  if (emailDomain && isPublicEmailDomain(emailDomain)) {
    reasons.add("blocked_public_email_domain");
  }

  if (explicitDomain && !isPublicEmailDomain(explicitDomain)) {
    return explicitDomain;
  }

  if (emailDomain && !isPublicEmailDomain(emailDomain)) {
    return emailDomain;
  }

  return null;
}

function resolveExactContact(
  row: NormalizedIdentityRow,
  candidates: IdentityContactCandidate[],
  reasons: Set<IdentityResolutionReason>
): IdentityContactCandidate | null {
  const email = normalizeIdentityText(row.contactEmail);
  const linkedin = normalizeLinkedin(row.contactLinkedinUrl);

  if (email) {
    if (isGenericEmail(email)) {
      reasons.add("blocked_generic_contact_email");
    } else {
      const emailMatches = candidates.filter(
        (candidate) =>
          normalizeIdentityText(candidate.normalizedEmail) === email ||
          normalizeIdentityText(candidate.email) === email
      );

      if (emailMatches.length === 1 && !isContactGeneric(emailMatches[0])) {
        reasons.add("contact_email_exact");

        return emailMatches[0];
      }
    }
  }

  if (linkedin) {
    const linkedinMatches = candidates.filter(
      (candidate) =>
        normalizeLinkedin(candidate.normalizedLinkedinUrl) === linkedin ||
        normalizeLinkedin(candidate.linkedinUrl) === linkedin
    );

    if (linkedinMatches.length === 1) {
      reasons.add("contact_linkedin_exact");

      return linkedinMatches[0];
    }
  }

  return null;
}

function getCompanyDomains(candidate: IdentityCompanyCandidate): string[] {
  return uniqueValues([
    normalizeIdentityDomain(candidate.canonicalDomain),
    normalizeIdentityDomain(candidate.website),
  ]);
}

function getCompanyNames(candidate: IdentityCompanyCandidate): string[] {
  return uniqueValues([
    normalizeCompanyName(candidate.normalizedName),
    normalizeCompanyName(candidate.displayName),
    ...(candidate.aliases ?? []).map(normalizeCompanyName),
  ]);
}

function extractEmailDomain(value: string | null | undefined): string | null {
  const email = normalizeIdentityText(value);

  if (!email?.includes("@")) {
    return null;
  }

  return normalizeIdentityDomain(email.split("@")[1]);
}

function normalizeLinkedin(value: unknown): string | null {
  return normalizeIdentityText(value)
    ?.replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "") ?? null;
}

function isContactGeneric(candidate: IdentityContactCandidate): boolean {
  return (
    candidate.isGenericEmail === true ||
    isGenericEmail(candidate.normalizedEmail) ||
    isGenericEmail(candidate.email)
  );
}

function stripDiacritics(value: string | null): string | null {
  return value
    ?.normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d") ?? null;
}

function computeNameSimilarity(left: string, right: string): number {
  if (left === right) {
    return 1;
  }

  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  const intersection = Array.from(leftTokens).filter((token) =>
    rightTokens.has(token)
  ).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;

  return union === 0 ? 0 : intersection / union;
}

function result(
  kind: IdentityResolutionResult["kind"],
  confidence: number,
  reasons: Set<IdentityResolutionReason>,
  ids: { companyId?: string; contactId?: string } = {}
): IdentityResolutionResult {
  return {
    kind,
    confidence,
    reasons: Array.from(reasons),
    ...ids,
  };
}

function uniqueValues(values: Array<string | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => value !== null)));
}
