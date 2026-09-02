import type {
  ActivityIdentityMatchResult,
  ActivityMatchConfidence,
  ActivityMatchReasonCode,
  ActivityMatchResult,
  CanonicalActivityRow,
  ExpandedActivityEvent,
  ResolveActivityMatchInput,
  SuggestedAction,
  V2ActivityCandidateCompany,
  V2ActivityCandidateContact,
  V2ActivityCandidateLeadAssignment,
} from "./types";

const GENERIC_EMAIL_LOCAL_PARTS = new Set([
  "info",
  "sales",
  "contact",
  "hello",
  "support",
  "admin",
  "marketing",
  "team",
  "enquiry",
  "inquiries",
  "general",
  "office",
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

export function resolveActivityMatch(
  input: ResolveActivityMatchInput
): ActivityMatchResult {
  const activity = unwrapActivity(input.activity);
  const organizationId = normalizeMatchText(input.context?.organizationId);
  const projectId = normalizeMatchText(input.context?.projectId);
  const companyCandidates = filterByOrganization(
    input.candidates.companies,
    organizationId
  );
  const contactCandidates = filterByOrganization(
    input.candidates.contacts,
    organizationId
  );
  const leadAssignmentCandidates = filterByOrganization(
    input.candidates.leadAssignments,
    organizationId
  );
  const companyMatch = resolveCompanyMatch(activity, companyCandidates);
  const contactMatch = resolveContactMatch(activity, contactCandidates, companyMatch);
  const leadAssignmentMatch = resolveLeadAssignmentMatch(
    leadAssignmentCandidates,
    companyMatch,
    contactMatch,
    projectId
  );
  const contactCompanyMismatch = hasContactCompanyMismatch(
    contactCandidates,
    companyMatch,
    contactMatch
  );
  const result = aggregateMatchResult(
    activity,
    companyMatch,
    contactMatch,
    leadAssignmentMatch,
    contactCompanyMismatch
  );

  return {
    ...result,
    matchedCompanyId: companyMatch.matchedId ?? null,
    matchedContactId: contactMatch.matchedId ?? null,
    matchedLeadAssignmentId: leadAssignmentMatch.matchedId ?? null,
    companyMatch,
    contactMatch,
    leadAssignmentMatch,
    warnings: [],
  };
}

export function isGenericEmail(value: string | null | undefined): boolean {
  const email = normalizeMatchText(value);

  if (email === null) {
    return false;
  }

  const [localPart] = email.split("@");

  return GENERIC_EMAIL_LOCAL_PARTS.has(localPart);
}

export function isPublicEmailDomain(
  domainOrEmail: string | null | undefined
): boolean {
  const normalized = normalizeMatchText(domainOrEmail);

  if (normalized === null) {
    return false;
  }

  const domain = normalized.includes("@")
    ? normalized.split("@")[1]
    : normalizeMatchDomain(normalized);

  return domain !== undefined && domain !== null && PUBLIC_EMAIL_DOMAINS.has(domain);
}

export function normalizeMatchText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim().toLowerCase().replace(/\s+/g, " ");

  return text.length > 0 ? text : null;
}

export function normalizeMatchDomain(value: unknown): string | null {
  const text = normalizeMatchText(value);

  if (text === null) {
    return null;
  }

  const withoutScheme = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const host = withoutScheme.split(/[/?#]/)[0]?.replace(/^www\./, "") ?? "";

  return host.length > 0 ? host : null;
}

function resolveCompanyMatch(
  activity: CanonicalActivityRow,
  candidates: V2ActivityCandidateCompany[]
): ActivityIdentityMatchResult {
  const websiteDomain = normalizeMatchDomain(activity.companyWebsite);
  const emailDomain = normalizeMatchDomain(extractEmailDomain(activity.contactEmail));
  const blockedPublicDomain =
    isPublicEmailDomain(websiteDomain) || isPublicEmailDomain(emailDomain);
  const activityDomain =
    websiteDomain !== null && !isPublicEmailDomain(websiteDomain)
      ? websiteDomain
      : emailDomain !== null && !isPublicEmailDomain(emailDomain)
        ? emailDomain
        : null;
  const activityCompanyName = normalizeMatchText(activity.companyName);
  const reasonCodes: ActivityMatchReasonCode[] = [];

  if (activityDomain !== null) {
    const domainMatches = candidates.filter((candidate) =>
      getCompanyDomains(candidate).includes(activityDomain)
    );

    if (domainMatches.length === 1) {
      return identityMatch("auto_match", domainMatches[0].id, [
        "exact_company_domain_match",
      ], false, domainMatches.length);
    }

    if (domainMatches.length > 1) {
      return identityMatch(
        "needs_review",
        null,
        ["exact_company_domain_match", "domain_conflict", "multiple_company_candidates"],
        true,
        domainMatches.length
      );
    }
  }

  if (activityCompanyName !== null) {
    const nameMatches = candidates.filter((candidate) =>
      getCompanyNames(candidate).includes(activityCompanyName)
    );

    if (nameMatches.length === 1) {
      return identityMatch(
        "suggested_match",
        nameMatches[0].id,
        [
          ...(blockedPublicDomain ? ["public_domain_email_blocked" as const] : []),
          "company_name_match",
        ],
        false,
        nameMatches.length
      );
    }

    if (nameMatches.length > 1) {
      if (blockedPublicDomain) {
        reasonCodes.push("public_domain_email_blocked");
      }

      reasonCodes.push("company_name_match", "company_name_ambiguous");

      if (hasDomainConflict(nameMatches)) {
        reasonCodes.push("domain_conflict");
      }

      reasonCodes.push("multiple_company_candidates");

      return identityMatch("needs_review", null, reasonCodes, true, nameMatches.length);
    }
  }

  return identityMatch(
    "no_match",
    null,
    blockedPublicDomain
      ? ["public_domain_email_blocked", "no_usable_identity_evidence"]
      : ["no_usable_identity_evidence"],
    false,
    0
  );
}

function resolveContactMatch(
  activity: CanonicalActivityRow,
  candidates: V2ActivityCandidateContact[],
  companyMatch: ActivityIdentityMatchResult
): ActivityIdentityMatchResult {
  const email = normalizeMatchText(activity.contactEmail);
  const linkedinUrl = normalizeMatchLinkedin(activity.contactLinkedIn);
  const phone = normalizePhone(activity.contactPhone);
  const contactName = normalizeMatchText(activity.contactName);
  const companyScopedCandidates =
    companyMatch.matchedId !== null && companyMatch.matchedId !== undefined
      ? candidates.filter((candidate) => candidate.companyId === companyMatch.matchedId)
      : candidates;

  if (email !== null && isGenericEmail(email)) {
    const genericMatches = candidates.filter(
      (candidate) => getContactEmail(candidate) === email
    );

    return identityMatch(
      "needs_review",
      null,
      ["generic_email_not_contact_identity", "generic_email_downgraded"],
      genericMatches.length > 1,
      genericMatches.length
    );
  }

  if (email !== null) {
    const emailMatches = candidates.filter(
      (candidate) => getContactEmail(candidate) === email && !isCandidateGenericEmail(candidate)
    );

    if (emailMatches.length === 1) {
      return identityMatch("auto_match", emailMatches[0].id, [
        "exact_contact_email_match",
      ], false, emailMatches.length);
    }

    if (emailMatches.length > 1) {
      return identityMatch(
        "needs_review",
        null,
        ["exact_contact_email_match", "multiple_contact_candidates"],
        true,
        emailMatches.length
      );
    }
  }

  if (linkedinUrl !== null) {
    const linkedinMatches = candidates.filter(
      (candidate) => normalizeMatchLinkedin(candidate.normalizedLinkedinUrl) === linkedinUrl ||
        normalizeMatchLinkedin(candidate.linkedinUrl) === linkedinUrl
    );

    if (linkedinMatches.length === 1) {
      return identityMatch("auto_match", linkedinMatches[0].id, [
        "exact_contact_linkedin_match",
      ], false, linkedinMatches.length);
    }

    if (linkedinMatches.length > 1) {
      return identityMatch(
        "needs_review",
        null,
        ["exact_contact_linkedin_match", "multiple_contact_candidates"],
        true,
        linkedinMatches.length
      );
    }
  }

  if (phone !== null) {
    const phoneMatches = candidates.filter(
      (candidate) => normalizePhone(candidate.normalizedPhone) === phone ||
        normalizePhone(candidate.phone) === phone
    );

    if (phoneMatches.length === 1) {
      return identityMatch("suggested_match", phoneMatches[0].id, [
        "phone_match_supporting_only",
      ], false, phoneMatches.length);
    }

    if (phoneMatches.length > 1) {
      return identityMatch(
        "needs_review",
        null,
        ["phone_match_supporting_only", "multiple_contact_candidates"],
        true,
        phoneMatches.length
      );
    }
  }

  if (contactName !== null) {
    const nameMatches = companyScopedCandidates.filter((candidate) =>
      getContactNames(candidate).includes(contactName)
    );

    if (nameMatches.length === 1 && companyMatch.confidence !== "no_match") {
      return identityMatch("suggested_match", nameMatches[0].id, [
        "contact_name_match",
      ], false, nameMatches.length);
    }

    if (nameMatches.length > 1) {
      return identityMatch(
        "needs_review",
        null,
        ["contact_name_match", "multiple_contact_candidates"],
        true,
        nameMatches.length
      );
    }

    return identityMatch("needs_review", null, ["weak_identity_evidence"], false, 0);
  }

  return identityMatch("no_match", null, ["no_usable_identity_evidence"], false, 0);
}

function resolveLeadAssignmentMatch(
  candidates: V2ActivityCandidateLeadAssignment[],
  companyMatch: ActivityIdentityMatchResult,
  contactMatch: ActivityIdentityMatchResult,
  projectId: string | null
): ActivityIdentityMatchResult {
  if (companyMatch.matchedId === null || companyMatch.matchedId === undefined) {
    return identityMatch("no_match", null, ["no_lead_assignment_candidate"], false, 0);
  }

  const matches = candidates.filter((candidate) => {
    if (candidate.companyId !== companyMatch.matchedId) {
      return false;
    }

    if (projectId !== null && candidate.projectId !== projectId) {
      return false;
    }

    if (
      contactMatch.matchedId !== null &&
      contactMatch.matchedId !== undefined &&
      candidate.contactId !== null &&
      candidate.contactId !== undefined &&
      candidate.contactId !== contactMatch.matchedId
    ) {
      return false;
    }

    return true;
  });

  if (matches.length === 1) {
    return identityMatch("auto_match", matches[0].id, [
      "lead_assignment_context_match",
    ], false, matches.length);
  }

  if (matches.length > 1) {
    return identityMatch(
      "needs_review",
      null,
      ["lead_assignment_context_match", "weak_identity_evidence"],
      true,
      matches.length
    );
  }

  return identityMatch("no_match", null, ["no_lead_assignment_candidate"], false, 0);
}

function aggregateMatchResult(
  activity: CanonicalActivityRow,
  companyMatch: ActivityIdentityMatchResult,
  contactMatch: ActivityIdentityMatchResult,
  leadAssignmentMatch: ActivityIdentityMatchResult,
  contactCompanyMismatch: boolean
): Omit<
  ActivityMatchResult,
  | "companyMatch"
  | "contactMatch"
  | "leadAssignmentMatch"
  | "matchedCompanyId"
  | "matchedContactId"
  | "matchedLeadAssignmentId"
  | "warnings"
> {
  const reasonCodes = uniqueReasonCodes([
    ...companyMatch.reasonCodes,
    ...contactMatch.reasonCodes,
    ...leadAssignmentMatch.reasonCodes,
  ]);
  const suggestedActions = new Set<SuggestedAction>();
  const destructiveWeakIdentity =
    isDestructiveActivity(activity) &&
    !(
      companyMatch.confidence === "auto_match" &&
      contactMatch.confidence === "auto_match" &&
      leadAssignmentMatch.confidence === "auto_match"
    );
  const meetingWithoutLeadAssignment =
    isMeetingActivity(activity) && leadAssignmentMatch.confidence === "no_match";

  if (
    companyMatch.confidence === "no_match" &&
    contactMatch.confidence === "no_match"
  ) {
    suggestedActions.add("manager_review");
  }

  if (companyMatch.confidence !== "no_match") {
    suggestedActions.add("link_existing_company");
  } else {
    suggestedActions.add("create_company");
  }

  if (contactMatch.confidence !== "no_match") {
    suggestedActions.add("link_existing_contact");
  } else {
    suggestedActions.add("create_contact");
  }

  if (
    leadAssignmentMatch.confidence === "no_match" &&
    companyMatch.confidence !== "no_match"
  ) {
    suggestedActions.add("create_lead_assignment");
  }

  if (destructiveWeakIdentity) {
    reasonCodes.push("destructive_outcome_requires_review");
  }

  if (meetingWithoutLeadAssignment) {
    reasonCodes.push("meeting_activity_without_lead_assignment");
  }

  if (contactCompanyMismatch) {
    reasonCodes.push("contact_company_mismatch");
  }

  if (
    companyMatch.confidence === "auto_match" &&
    contactMatch.confidence === "no_match" &&
    leadAssignmentMatch.confidence === "no_match"
  ) {
    reasonCodes.push("exact_company_domain_without_contact");
  }

  const hasConflict =
    companyMatch.ambiguous ||
    contactMatch.ambiguous ||
    leadAssignmentMatch.ambiguous ||
    reasonCodes.includes("domain_conflict") ||
    reasonCodes.includes("multiple_company_candidates") ||
    reasonCodes.includes("multiple_contact_candidates");
  const noUsableEvidence =
    companyMatch.confidence === "no_match" &&
    contactMatch.confidence === "no_match" &&
    leadAssignmentMatch.confidence === "no_match";
  let overallConfidence: ActivityMatchConfidence;

  if (
    destructiveWeakIdentity ||
    meetingWithoutLeadAssignment ||
    hasConflict ||
    contactCompanyMismatch
  ) {
    overallConfidence = "needs_review";
    suggestedActions.add("manager_review");
  } else if (noUsableEvidence) {
    overallConfidence = "no_match";
  } else if (
    companyMatch.confidence === "auto_match" &&
    contactMatch.confidence === "auto_match" &&
    leadAssignmentMatch.confidence === "auto_match"
  ) {
    overallConfidence = "auto_match";
  } else if (
    companyMatch.confidence === "auto_match" &&
    contactMatch.confidence === "no_match"
  ) {
    overallConfidence = "suggested_match";
  } else if (
    [companyMatch.confidence, contactMatch.confidence, leadAssignmentMatch.confidence].includes(
      "needs_review"
    )
  ) {
    overallConfidence = "needs_review";
    suggestedActions.add("manager_review");
  } else {
    overallConfidence = "suggested_match";
  }

  const managerReviewRequired = overallConfidence === "needs_review";

  if (managerReviewRequired) {
    suggestedActions.add("manager_review");
  }

  return {
    overallConfidence,
    reasonCodes: uniqueReasonCodes(reasonCodes),
    managerReviewRequired,
    suggestedActions: Array.from(suggestedActions),
  };
}

function unwrapActivity(
  activity: CanonicalActivityRow | ExpandedActivityEvent
): CanonicalActivityRow {
  return "row" in activity ? activity.row : activity;
}

function identityMatch(
  confidence: ActivityMatchConfidence,
  matchedId: string | null,
  reasonCodes: ActivityMatchReasonCode[],
  ambiguous: boolean,
  candidateCount: number
): ActivityIdentityMatchResult {
  return {
    confidence,
    matchedId,
    candidateId: matchedId,
    reasonCodes,
    ambiguous,
    candidateCount,
  };
}

function filterByOrganization<T extends { organizationId?: string | null }>(
  candidates: T[],
  organizationId: string | null
): T[] {
  if (organizationId === null) {
    return candidates;
  }

  return candidates.filter(
    (candidate) =>
      candidate.organizationId === null ||
      candidate.organizationId === undefined ||
      normalizeMatchText(candidate.organizationId) === organizationId
  );
}

function hasContactCompanyMismatch(
  candidates: V2ActivityCandidateContact[],
  companyMatch: ActivityIdentityMatchResult,
  contactMatch: ActivityIdentityMatchResult
): boolean {
  if (
    companyMatch.matchedId === null ||
    companyMatch.matchedId === undefined ||
    contactMatch.matchedId === null ||
    contactMatch.matchedId === undefined
  ) {
    return false;
  }

  const matchedContact = candidates.find(
    (candidate) => candidate.id === contactMatch.matchedId
  );

  return (
    matchedContact?.companyId !== null &&
    matchedContact?.companyId !== undefined &&
    matchedContact.companyId !== companyMatch.matchedId
  );
}

function getCompanyDomains(candidate: V2ActivityCandidateCompany): string[] {
  return uniqueValues([
    normalizeMatchDomain(candidate.canonicalDomain),
    normalizeMatchDomain(candidate.website),
  ]);
}

function getCompanyNames(candidate: V2ActivityCandidateCompany): string[] {
  return uniqueValues([
    normalizeMatchText(candidate.normalizedName),
    normalizeMatchText(candidate.displayName),
    ...(candidate.aliases ?? []).map(normalizeMatchText),
  ]);
}

function getContactNames(candidate: V2ActivityCandidateContact): string[] {
  return uniqueValues([
    normalizeMatchText(candidate.normalizedName),
    normalizeMatchText(candidate.fullName),
  ]);
}

function getContactEmail(candidate: V2ActivityCandidateContact): string | null {
  return normalizeMatchText(candidate.normalizedEmail) ?? normalizeMatchText(candidate.email);
}

function isCandidateGenericEmail(candidate: V2ActivityCandidateContact): boolean {
  return candidate.isGenericEmail === true || isGenericEmail(getContactEmail(candidate));
}

function normalizeMatchLinkedin(value: unknown): string | null {
  const text = normalizeMatchText(value);

  return text?.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "") ?? null;
}

function normalizePhone(value: unknown): string | null {
  const text = normalizeMatchText(value);

  if (text === null) {
    return null;
  }

  const digits = text.replace(/\D/g, "");

  return digits.length > 0 ? digits : null;
}

function extractEmailDomain(value: string | null): string | null {
  const email = normalizeMatchText(value);

  if (email === null || !email.includes("@")) {
    return null;
  }

  return email.split("@")[1] ?? null;
}

function hasDomainConflict(candidates: V2ActivityCandidateCompany[]): boolean {
  return new Set(candidates.flatMap(getCompanyDomains)).size > 1;
}

function isDestructiveActivity(activity: CanonicalActivityRow): boolean {
  return ["not_interested", "bounced", "wrong_person", "bad_fit"].includes(
    activity.outcome
  );
}

function isMeetingActivity(activity: CanonicalActivityRow): boolean {
  return (
    activity.activityType === "meeting_booked" ||
    activity.activityType === "meeting_done" ||
    activity.outcome === "meeting_booked" ||
    activity.outcome === "meeting_done"
  );
}

function uniqueValues(values: Array<string | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => value !== null)));
}

function uniqueReasonCodes(
  reasonCodes: ActivityMatchReasonCode[]
): ActivityMatchReasonCode[] {
  return Array.from(new Set(reasonCodes));
}
