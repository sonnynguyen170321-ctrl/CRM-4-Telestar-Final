export type V2IcpVersionStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export type V2IcpLibraryVersion = {
  id: string;
  icpProfileId: string;
  icpProfileName: string;
  icpProfileDescription: string | null;
  offerId: string;
  offerName: string;
  projectId: string;
  clientAccountId: string;
  clientAccountName: string;
  versionNumber: number;
  status: V2IcpVersionStatus;
  optimisticVersion: number;
  rulesJson: unknown;
  publishedAt: string | null;
  publishedByName: string | null;
  publishedByEmailNormalized: string | null;
  accountOwnerName: string | null;
  projectOwnerName: string | null;
  createdAt: string;
  updatedAt: string;
  rulesSummary: V2IcpRulesSummary;
};

export type V2IcpLibraryResult = {
  versions: V2IcpLibraryVersion[];
  selectedVersion: V2IcpLibraryVersion | null;
};

export type V2IcpRulesSummary = {
  displayName: string | null;
  schemaVersion: string | null;
  hardGates: V2IcpRuleSummaryItem[];
  positiveSignals: V2IcpRuleSummaryItem[];
  negativeSignals: V2IcpRuleSummaryItem[];
  companyTypeRules: V2IcpRuleSummaryItem[];
  missingDataPolicy: string[];
  confidencePolicy: string[];
  sourceReliability: string[];
  scorePolicy: string[];
  rawAvailable: boolean;
  targetPersona?: V2IcpRuleSummaryItem[];
  geography?: V2IcpRuleSummaryItem[];
  painPoints?: V2IcpRuleSummaryItem[];
  goodFitExamples?: V2IcpRuleSummaryItem[];
  badFitExamples?: V2IcpRuleSummaryItem[];
  exclusions?: V2IcpRuleSummaryItem[];
};

export type V2IcpRuleSummaryItem = {
  label: string;
  detail: string | null;
};
