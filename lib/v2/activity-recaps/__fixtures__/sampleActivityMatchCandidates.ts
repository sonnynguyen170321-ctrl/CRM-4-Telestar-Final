import type {
  ActivityMatchConfidence,
  ActivityMatchReasonCode,
  CanonicalActivityRow,
  V2ActivityCandidateCompany,
  V2ActivityCandidateContact,
  V2ActivityCandidateLeadAssignment,
} from "../types";

export type SampleActivityMatchFixture = {
  name: string;
  activity: CanonicalActivityRow;
  candidates: {
    companies: V2ActivityCandidateCompany[];
    contacts: V2ActivityCandidateContact[];
    leadAssignments: V2ActivityCandidateLeadAssignment[];
  };
  context?: {
    organizationId?: string | null;
    projectId?: string | null;
  };
  expected: {
    overallConfidence: ActivityMatchConfidence;
    companyConfidence: ActivityMatchConfidence;
    contactConfidence: ActivityMatchConfidence;
    leadAssignmentConfidence: ActivityMatchConfidence;
    managerReviewRequired: boolean;
    reasonCodes: ActivityMatchReasonCode[];
  };
};

const baseActivity = {
  activityDate: "2026-06-01",
  sdrUser: "Mina",
  clientAccount: "Client A",
  project: "Project A",
  companyName: null,
  companyWebsite: null,
  contactName: null,
  contactEmail: null,
  contactPhone: null,
  contactLinkedIn: null,
  channel: "email",
  activityType: "positive_reply",
  outcome: "positive_response",
  rawStatus: "Positive reply",
  note: null,
  sourceFileName: "activity.csv",
  sourceSheetName: "Sheet 1",
  sourceRowNumber: 1,
  sourceRowHash: "source-row-hash",
  sourceActivityHash: "source-activity-hash",
} satisfies CanonicalActivityRow;

const acmeCompany: V2ActivityCandidateCompany = {
  id: "company-acme",
  organizationId: "org-1",
  canonicalDomain: "acme.example",
  normalizedName: "acme",
  displayName: "Acme",
  website: "https://acme.example",
};

const acmeContact: V2ActivityCandidateContact = {
  id: "contact-ada",
  organizationId: "org-1",
  fullName: "Ada Lovelace",
  normalizedName: "ada lovelace",
  email: "ada@acme.example",
  normalizedEmail: "ada@acme.example",
  linkedinUrl: "https://linkedin.com/in/ada-acme",
  normalizedLinkedinUrl: "linkedin.com/in/ada-acme",
  phone: "+66 20000000",
  normalizedPhone: "6620000000",
  companyId: "company-acme",
};

const acmeLeadAssignment: V2ActivityCandidateLeadAssignment = {
  id: "lead-acme-ada",
  organizationId: "org-1",
  projectId: "project-1",
  icpVersionId: "icp-1",
  companyId: "company-acme",
  contactId: "contact-ada",
  status: "active",
};

export const SAMPLE_ACTIVITY_MATCH_FIXTURES: SampleActivityMatchFixture[] = [
  {
    name: "exact non-generic email company domain and lead assignment auto match",
    activity: {
      ...baseActivity,
      companyName: "Acme",
      companyWebsite: "https://acme.example",
      contactName: "Ada Lovelace",
      contactEmail: "ada@acme.example",
    },
    candidates: {
      companies: [acmeCompany],
      contacts: [acmeContact],
      leadAssignments: [acmeLeadAssignment],
    },
    context: {
      organizationId: "org-1",
      projectId: "project-1",
    },
    expected: {
      overallConfidence: "auto_match",
      companyConfidence: "auto_match",
      contactConfidence: "auto_match",
      leadAssignmentConfidence: "auto_match",
      managerReviewRequired: false,
      reasonCodes: [
        "exact_company_domain_match",
        "exact_contact_email_match",
        "lead_assignment_context_match",
      ],
    },
  },
  {
    name: "generic email with company domain cannot auto match contact",
    activity: {
      ...baseActivity,
      companyName: "Acme",
      companyWebsite: "https://acme.example",
      contactEmail: "info@acme.example",
    },
    candidates: {
      companies: [acmeCompany],
      contacts: [
        {
          ...acmeContact,
          id: "contact-info",
          email: "info@acme.example",
          normalizedEmail: "info@acme.example",
          isGenericEmail: true,
        },
      ],
      leadAssignments: [],
    },
    context: {
      organizationId: "org-1",
      projectId: "project-1",
    },
    expected: {
      overallConfidence: "needs_review",
      companyConfidence: "auto_match",
      contactConfidence: "needs_review",
      leadAssignmentConfidence: "no_match",
      managerReviewRequired: true,
      reasonCodes: [
        "generic_email_not_contact_identity",
        "generic_email_downgraded",
      ],
    },
  },
  {
    name: "exact company domain only is suggested match",
    activity: {
      ...baseActivity,
      companyName: "Acme",
      companyWebsite: "https://acme.example",
    },
    candidates: {
      companies: [acmeCompany],
      contacts: [],
      leadAssignments: [],
    },
    context: {
      organizationId: "org-1",
      projectId: "project-1",
    },
    expected: {
      overallConfidence: "suggested_match",
      companyConfidence: "auto_match",
      contactConfidence: "no_match",
      leadAssignmentConfidence: "no_match",
      managerReviewRequired: false,
      reasonCodes: ["exact_company_domain_without_contact"],
    },
  },
  {
    name: "same company name with different domains needs review",
    activity: {
      ...baseActivity,
      companyName: "Acme",
    },
    candidates: {
      companies: [
        acmeCompany,
        {
          ...acmeCompany,
          id: "company-acme-alt",
          canonicalDomain: "acme-alt.example",
          website: "https://acme-alt.example",
        },
      ],
      contacts: [],
      leadAssignments: [],
    },
    context: {
      organizationId: "org-1",
    },
    expected: {
      overallConfidence: "needs_review",
      companyConfidence: "needs_review",
      contactConfidence: "no_match",
      leadAssignmentConfidence: "no_match",
      managerReviewRequired: true,
      reasonCodes: [
        "company_name_ambiguous",
        "domain_conflict",
        "multiple_company_candidates",
      ],
    },
  },
  {
    name: "exact contact linkedin with lead assignment auto match",
    activity: {
      ...baseActivity,
      companyWebsite: "https://acme.example",
      contactLinkedIn: "https://linkedin.com/in/ada-acme",
    },
    candidates: {
      companies: [acmeCompany],
      contacts: [acmeContact],
      leadAssignments: [acmeLeadAssignment],
    },
    context: {
      organizationId: "org-1",
      projectId: "project-1",
    },
    expected: {
      overallConfidence: "auto_match",
      companyConfidence: "auto_match",
      contactConfidence: "auto_match",
      leadAssignmentConfidence: "auto_match",
      managerReviewRequired: false,
      reasonCodes: [
        "exact_company_domain_match",
        "exact_contact_linkedin_match",
        "lead_assignment_context_match",
      ],
    },
  },
  {
    name: "phone only match is suggested not auto",
    activity: {
      ...baseActivity,
      contactPhone: "+66 2 000 0000",
    },
    candidates: {
      companies: [],
      contacts: [acmeContact],
      leadAssignments: [],
    },
    expected: {
      overallConfidence: "suggested_match",
      companyConfidence: "no_match",
      contactConfidence: "suggested_match",
      leadAssignmentConfidence: "no_match",
      managerReviewRequired: false,
      reasonCodes: ["phone_match_supporting_only"],
    },
  },
  {
    name: "destructive outcome with weak identity needs review",
    activity: {
      ...baseActivity,
      companyName: "Acme",
      activityType: "wrong_contact",
      outcome: "bounced",
      rawStatus: "Bounced",
    },
    candidates: {
      companies: [acmeCompany],
      contacts: [],
      leadAssignments: [],
    },
    expected: {
      overallConfidence: "needs_review",
      companyConfidence: "suggested_match",
      contactConfidence: "no_match",
      leadAssignmentConfidence: "no_match",
      managerReviewRequired: true,
      reasonCodes: ["destructive_outcome_requires_review"],
    },
  },
  {
    name: "no usable identity evidence no match",
    activity: {
      ...baseActivity,
      note: "Follow up later",
    },
    candidates: {
      companies: [acmeCompany],
      contacts: [acmeContact],
      leadAssignments: [acmeLeadAssignment],
    },
    expected: {
      overallConfidence: "no_match",
      companyConfidence: "no_match",
      contactConfidence: "no_match",
      leadAssignmentConfidence: "no_match",
      managerReviewRequired: false,
      reasonCodes: ["no_usable_identity_evidence"],
    },
  },
  {
    name: "meeting booked without lead assignment needs review",
    activity: {
      ...baseActivity,
      companyWebsite: "https://acme.example",
      contactEmail: "ada@acme.example",
      activityType: "meeting_booked",
      outcome: "meeting_booked",
      rawStatus: "Meeting booked",
    },
    candidates: {
      companies: [acmeCompany],
      contacts: [acmeContact],
      leadAssignments: [],
    },
    context: {
      organizationId: "org-1",
      projectId: "project-1",
    },
    expected: {
      overallConfidence: "needs_review",
      companyConfidence: "auto_match",
      contactConfidence: "auto_match",
      leadAssignmentConfidence: "no_match",
      managerReviewRequired: true,
      reasonCodes: ["meeting_activity_without_lead_assignment"],
    },
  },
  {
    name: "public email domain is blocked from company domain evidence",
    activity: {
      ...baseActivity,
      contactEmail: "john@gmail.com",
    },
    candidates: {
      companies: [
        {
          id: "company-gmail",
          organizationId: "org-1",
          canonicalDomain: "gmail.com",
          normalizedName: "gmail",
          displayName: "Gmail",
          website: "https://gmail.com",
        },
      ],
      contacts: [],
      leadAssignments: [],
    },
    context: {
      organizationId: "org-1",
    },
    expected: {
      overallConfidence: "no_match",
      companyConfidence: "no_match",
      contactConfidence: "no_match",
      leadAssignmentConfidence: "no_match",
      managerReviewRequired: false,
      reasonCodes: ["public_domain_email_blocked"],
    },
  },
  {
    name: "contact company mismatch needs review",
    activity: {
      ...baseActivity,
      companyName: "Company B",
      companyWebsite: "https://company-b.example",
      contactEmail: "ada@company-a.example",
    },
    candidates: {
      companies: [
        {
          id: "company-a",
          organizationId: "org-1",
          canonicalDomain: "company-a.example",
          normalizedName: "company a",
          displayName: "Company A",
          website: "https://company-a.example",
        },
        {
          id: "company-b",
          organizationId: "org-1",
          canonicalDomain: "company-b.example",
          normalizedName: "company b",
          displayName: "Company B",
          website: "https://company-b.example",
        },
      ],
      contacts: [
        {
          id: "contact-company-a",
          organizationId: "org-1",
          fullName: "Ada Lovelace",
          normalizedName: "ada lovelace",
          email: "ada@company-a.example",
          normalizedEmail: "ada@company-a.example",
          companyId: "company-a",
        },
      ],
      leadAssignments: [],
    },
    context: {
      organizationId: "org-1",
      projectId: "project-1",
    },
    expected: {
      overallConfidence: "needs_review",
      companyConfidence: "auto_match",
      contactConfidence: "auto_match",
      leadAssignmentConfidence: "no_match",
      managerReviewRequired: true,
      reasonCodes: ["contact_company_mismatch"],
    },
  },
];
