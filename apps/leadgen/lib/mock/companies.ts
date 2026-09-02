import type { CompanyScoreResult } from "@/lib/types";

export const companyScoreResults: CompanyScoreResult[] = [
  {
    company_name: "Northstar Cloud",
    website: "https://northstarcloud.example",
    company_country: "Canada",
    type: "Cloud",
    note: "Product-led infrastructure platform.",
    company_score: 82,
    qualification: "qualified",
    confidence: 0.86,
    reason: "B2B cloud platform with clear software product signals.",
    one_sentence_company_summary:
      "Northstar Cloud provides infrastructure monitoring software for B2B engineering teams.",
    hard_rule_flags: {
      excluded_country: false,
      solo_company: false,
      services_signal: false,
      personal_email_signal: false,
    },
    review_state: "reviewed",
  },
  {
    company_name: "Vector Ledger",
    website: "https://vectorledger.example",
    company_country: "United Kingdom",
    type: "Blockchain Solution",
    note: "Needs business model review.",
    company_score: 64,
    qualification: "uncertain",
    confidence: 0.58,
    reason: "Blockchain product is visible, but B2B fit is not yet clear.",
    one_sentence_company_summary:
      "Vector Ledger builds ledger tooling for transaction verification workflows.",
    hard_rule_flags: {
      excluded_country: false,
      solo_company: false,
      services_signal: false,
      personal_email_signal: false,
    },
    review_state: "needs_review",
  },
  {
    company_name: "AgencyWorks Studio",
    website: "https://agencyworks.example",
    company_country: "Australia",
    type: "Not Relevant",
    note: "Agency/service positioning.",
    company_score: 18,
    qualification: "unqualified",
    confidence: 0.91,
    reason: "Website copy is service-led and agency-oriented.",
    one_sentence_company_summary:
      "AgencyWorks Studio offers outsourced design and development services.",
    hard_rule_flags: {
      excluded_country: false,
      solo_company: false,
      services_signal: true,
      personal_email_signal: false,
    },
    review_state: "unreviewed",
  },
];
