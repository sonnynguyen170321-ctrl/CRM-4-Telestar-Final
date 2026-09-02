export type ActivityChannel =
  | "email"
  | "linkedin"
  | "call"
  | "whatsapp"
  | "zalo"
  | "meeting"
  | "manual_note"
  | "other";

export type ActivityType =
  | "new_email"
  | "follow_up_email"
  | "linkedin_connection"
  | "linkedin_message"
  | "call_attempt"
  | "call_connected"
  | "whatsapp_message"
  | "meeting_booked"
  | "meeting_done"
  | "no_pick_up"
  | "not_interested"
  | "positive_reply"
  | "wrong_contact"
  | "manual_note"
  | "other";

export type ActivityOutcome =
  | "positive_response"
  | "meeting_booked"
  | "meeting_done"
  | "follow_up_needed"
  | "no_response"
  | "no_pick_up"
  | "not_interested"
  | "bad_fit"
  | "wrong_person"
  | "bounced"
  | "duplicate"
  | "unknown";

export type ActivityMatchConfidence =
  | "auto_match"
  | "suggested_match"
  | "needs_review"
  | "no_match";

export type SuggestedAction =
  | "create_company"
  | "create_contact"
  | "link_existing_company"
  | "link_existing_contact"
  | "create_lead_assignment"
  | "ignore_row"
  | "mark_non_actionable"
  | "manager_review";

export type ActivityMatchReasonCode =
  | "exact_contact_email_match"
  | "generic_email_downgraded"
  | "generic_email_not_contact_identity"
  | "exact_contact_linkedin_match"
  | "exact_company_domain_match"
  | "company_name_match"
  | "company_name_ambiguous"
  | "domain_conflict"
  | "contact_name_match"
  | "phone_match_supporting_only"
  | "lead_assignment_context_match"
  | "no_lead_assignment_candidate"
  | "multiple_company_candidates"
  | "multiple_contact_candidates"
  | "weak_identity_evidence"
  | "destructive_outcome_requires_review"
  | "meeting_activity_without_lead_assignment"
  | "exact_company_domain_without_contact"
  | "no_usable_identity_evidence"
  | "public_domain_email_blocked"
  | "contact_company_mismatch";

export type ActivityIdentityMatchResult = {
  confidence: ActivityMatchConfidence;
  matchedId?: string | null;
  candidateId?: string | null;
  reasonCodes: ActivityMatchReasonCode[];
  ambiguous: boolean;
  candidateCount: number;
};

export type ActivityMatchResult = {
  overallConfidence: ActivityMatchConfidence;
  reasonCodes: ActivityMatchReasonCode[];
  managerReviewRequired: boolean;
  suggestedActions: SuggestedAction[];
  matchedCompanyId?: string | null;
  matchedContactId?: string | null;
  matchedLeadAssignmentId?: string | null;
  companyMatch: ActivityIdentityMatchResult;
  contactMatch: ActivityIdentityMatchResult;
  leadAssignmentMatch: ActivityIdentityMatchResult;
  warnings: string[];
};

export type V2ActivityCandidateCompany = {
  id: string;
  organizationId?: string | null;
  canonicalDomain?: string | null;
  normalizedName?: string | null;
  displayName?: string | null;
  website?: string | null;
  aliases?: string[];
  projectContextIds?: string[];
};

export type V2ActivityCandidateContact = {
  id: string;
  organizationId?: string | null;
  fullName?: string | null;
  normalizedName?: string | null;
  email?: string | null;
  normalizedEmail?: string | null;
  linkedinUrl?: string | null;
  normalizedLinkedinUrl?: string | null;
  phone?: string | null;
  normalizedPhone?: string | null;
  companyId?: string | null;
  isGenericEmail?: boolean;
};

export type V2ActivityCandidateLeadAssignment = {
  id: string;
  organizationId?: string | null;
  projectId: string;
  icpVersionId?: string | null;
  companyId: string;
  contactId?: string | null;
  status?: string | null;
  ownerUserId?: string | null;
};

export type ResolveActivityMatchInput = {
  activity: CanonicalActivityRow | ExpandedActivityEvent;
  candidates: {
    companies: V2ActivityCandidateCompany[];
    contacts: V2ActivityCandidateContact[];
    leadAssignments: V2ActivityCandidateLeadAssignment[];
  };
  context?: {
    organizationId?: string | null;
    projectId?: string | null;
    sdrUserId?: string | null;
    importRowKind?: ImportRowKind;
    timestampQuality?: TimestampQuality;
    sourceActivityHash?: string | null;
  };
};

export type ImportRowKind =
  | "lead_snapshot"
  | "activity_event"
  | "wide_activity_bundle"
  | "pipeline_snapshot"
  | "meeting_tracker"
  | "unknown_mixed";

export type TimestampQuality =
  | "exact_datetime"
  | "date_only"
  | "inferred_from_note"
  | "missing"
  | "unparseable"
  | "conflicting";

export type WideRowChannelMapping = {
  channel: ActivityChannel;
  stageColumn: string;
  dateColumn?: string;
  noteColumn?: string;
  sourceColumnName?: string;
};

export type CanonicalActivityRow = {
  activityDate: string | null;
  sdrUser: string | null;
  clientAccount: string | null;
  project: string | null;
  companyName: string | null;
  companyWebsite: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  contactLinkedIn: string | null;
  channel: ActivityChannel;
  activityType: ActivityType;
  outcome: ActivityOutcome;
  rawStatus: string | null;
  note: string | null;
  sourceFileName: string | null;
  sourceSheetName: string | null;
  sourceRowNumber: number;
  sourceRowHash: string;
  sourceActivityHash: string;
};

export type RawActivityRecapRow = Record<string, unknown>;

export type NormalizeActivityRowInput = {
  rawRow: RawActivityRecapRow;
  sourceRowNumber: number;
  sourceFileName?: string | null;
  sourceSheetName?: string | null;
};

export type NormalizeActivityRowResult = {
  row: CanonicalActivityRow;
  warnings: string[];
};

export type ComputeSourceActivityHashInput = {
  sourceRowHash: string;
  channel: ActivityChannel;
  sourceColumnName?: string | null;
  rawStage?: string | null;
  rawTimestamp?: string | null;
  eventIndexWithinRow: number;
};

export type ExpandActivityRowsFromRawRowInput = NormalizeActivityRowInput & {
  importRowKind: ImportRowKind;
  wideRowChannelMappings?: WideRowChannelMapping[];
};

export type ExpandedActivityEvent = {
  row: CanonicalActivityRow;
  eventIndexWithinRow: number;
  sourceColumnName?: string | null;
  timestampQuality: TimestampQuality;
  warnings: string[];
};

export type ActivityExpansionResult = {
  events: ExpandedActivityEvent[];
  warnings: string[];
  importRowKind: ImportRowKind;
  requiresManagerReview: boolean;
};
