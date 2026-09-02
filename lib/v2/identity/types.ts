export type IdentityResolutionKind =
  | "exact_company"
  | "exact_contact"
  | "candidate"
  | "none";

export type IdentityResolutionReason =
  | "company_domain_exact"
  | "company_name_exact_in_context"
  | "contact_email_exact"
  | "contact_linkedin_exact"
  | "blocked_public_email_domain"
  | "blocked_generic_contact_email"
  | "tenant_mismatch_ignored"
  | "context_mismatch_ignored"
  | "fuzzy_company_name_candidate_only"
  | "no_usable_identity_evidence";

export type IdentityResolutionInput = {
  row: NormalizedIdentityRow;
  context: IdentityResolutionContext;
  candidates: IdentityResolutionCandidates;
};

export type IdentityResolutionContext = {
  organizationId: string;
  projectId?: string | null;
  accountId?: string | null;
};

export type NormalizedIdentityRow = {
  companyName?: string | null;
  canonicalDomain?: string | null;
  website?: string | null;
  contactEmail?: string | null;
  contactLinkedinUrl?: string | null;
};

export type IdentityResolutionCandidates = {
  companies: IdentityCompanyCandidate[];
  contacts: IdentityContactCandidate[];
};

export type IdentityCompanyCandidate = {
  id: string;
  organizationId: string;
  accountId?: string | null;
  projectIds?: string[];
  canonicalDomain?: string | null;
  website?: string | null;
  normalizedName?: string | null;
  displayName?: string | null;
  aliases?: string[];
};

export type IdentityContactCandidate = {
  id: string;
  organizationId: string;
  companyId?: string; // Optional because a contact may be orphaned or we search globally
  email?: string | null;
  normalizedEmail?: string | null;
  linkedinUrl?: string | null;
  normalizedLinkedinUrl?: string | null;
  isGenericEmail?: boolean;
};

export type IdentityResolutionResult = {
  kind: IdentityResolutionKind;
  confidence: number;
  reasons: IdentityResolutionReason[];
  companyId?: string;
  contactId?: string;
};
