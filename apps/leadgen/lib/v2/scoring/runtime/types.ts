import type { CompanyIntelligenceScoringTrace } from "@telestar/core-intel/mapIntelligenceProfileToScoring";
import type {
  AccountPreRank,
  CompanyEvidence,
  IcpAssessment,
  PersonaEvidence,
  Qualification as IcpQualification,
} from "@telestar/core-scoring/icpRulesSchema";
import type { IcpRulesV2Assessment } from "@telestar/core-scoring/rules/deriveQualification";
import type { IcpVersionRulesV2 } from "@telestar/core-scoring/rules/schema-v2";
import type { V2JobDatabase } from "../../jobs/types";

export const SCORE_HV0_JOB_SCHEMA_VERSION = "v2.score-hv0.icp-score-job.v1";
export const SCORE_HV0_SCORING_SOURCE = "icp1r_hard_rules";
export const SCORE_HV0_SCORING_VERSION = "V2.SCORE-HV0:icp1r.v1";
export const SCORE_HV0_RULES_V2_SCORING_SOURCE = "rules_v2_hard_rules";
export const SCORE_HV0_RULES_V2_SCORING_VERSION = "V2.SCORE-HV0:rules-v2.v1";
export const DEFAULT_SCORE_HV0_BATCH_SIZE = 100;
export type PersistedV2Qualification =
  | IcpQualification
  | "COMPANY_QUALIFIED_NEEDS_CONTACT";

export type ScoreHv0JobPayload = {
  schemaVersion: typeof SCORE_HV0_JOB_SCHEMA_VERSION;
  selection:
    | { kind: "lead_assignment_ids"; leadAssignmentIds: string[] }
    | { kind: "project_icp"; projectId: string; icpVersionId: string };
  options?: {
    batchSize?: number;
  };
  // R2: when present, the score handler mirrors progress onto this V2RuntimeRun
  // (per-batch chunk status + run rollup) so the UI can show async progress.
  runtimeRunId?: string;
};

export type V2ScoreRuntimeDatabase = V2JobDatabase;

export type ScoreHv0FailureCode =
  | "LEAD_ASSIGNMENT_NOT_ELIGIBLE"
  | "CONTACT_ASSIGNMENT_MISSING_CONTACT"
  | "ICP_VERSION_RULES_INVALID"
  | "ICP_ASSESSMENT_FAILED";

export type ScoreHv0AssignmentFailure = {
  leadAssignmentId: string;
  code: ScoreHv0FailureCode;
  message: string;
};

export type ScoreHv0AssignmentResult = {
  leadAssignmentId: string;
  assessmentId: string;
  qualification: PersistedV2Qualification;
  accountPreRank: AccountPreRank;
  fitScore: number;
  confidenceScore: number;
  inputFingerprint: string;
  reusedExistingAssessment: boolean;
  previousAssessmentId: string | null;
};

export type ScoreHv0ResultSummary = {
  schemaVersion: "v2.score-hv0.result.v1";
  selection: ScoreHv0JobPayload["selection"];
  counts: {
    selected: number;
    processed: number;
    scored: number;
    reused: number;
    created: number;
    skipped: number;
    failed: number;
  };
  results: ScoreHv0AssignmentResult[];
  failures: ScoreHv0AssignmentFailure[];
};

export type ContactIdentifierSnapshot = {
  type: string;
  normalizedValue: string;
  rawValue: string | null;
  isGeneric: boolean;
  isValid: boolean;
  validityStatus: string;
};

export type ScoreHv0LeadAssignmentSnapshot = {
  id: string;
  organizationId: string;
  projectId: string;
  icpVersionId: string;
  companyId: string;
  contactId: string | null;
  assignmentLevel: "COMPANY" | "CONTACT";
  workflowStatus: string;
  status: string;
  latestHardRuleAssessmentId: string | null;
};

export type ScoreHv0CompanySnapshot = {
  id: string;
  name: string;
  nameNormalized: string;
  canonicalDomain: string | null;
  websiteUrl: string | null;
  country: string | null;
};

export type ScoreHv0ContactSnapshot = {
  id: string;
  fullName: string;
  fullNameNormalized: string | null;
  title: string | null;
} | null;

export type ScoreHv0IcpVersionSnapshot = {
  id: string;
  version: number;
  versionNumber: number;
  status: "PUBLISHED";
  rulesJson: unknown;
};

export type ScoreHv0ScoringInput = {
  leadAssignment: ScoreHv0LeadAssignmentSnapshot;
  company: ScoreHv0CompanySnapshot;
  contact: ScoreHv0ContactSnapshot;
  contactIdentifiers: ContactIdentifierSnapshot[];
  icpVersion: ScoreHv0IcpVersionSnapshot;
  companyEvidence: CompanyEvidence;
  personaEvidence?: PersonaEvidence;
  icpRules: IcpVersionRulesV2;
  intelligenceTrace: CompanyIntelligenceScoringTrace | null;
};

export type BuildScoringInputResult =
  | { ok: true; input: ScoreHv0ScoringInput }
  | { ok: false; failure: ScoreHv0AssignmentFailure };

export type HardRuleAssessmentPersistenceInput = {
  organizationId: string;
  leadAssignmentId: string;
  icpVersionId: string;
  fitScore: number;
  confidenceDecimal: number;
  qualification: PersistedV2Qualification;
  accountPreRank: AccountPreRank;
  companyType: string | null;
  reason: string;
  oneSentenceCompanySummary: string | null;
  evidenceSnapshotJson: unknown;
  hardGateResultsJson: unknown;
  confidenceBreakdownJson: unknown;
  dataQualityJson: unknown;
  inputFingerprint: string;
  icpRulesHash: string;
  scoringSource: typeof SCORE_HV0_SCORING_SOURCE | typeof SCORE_HV0_RULES_V2_SCORING_SOURCE;
  scoringVersion: typeof SCORE_HV0_SCORING_VERSION | typeof SCORE_HV0_RULES_V2_SCORING_VERSION;
};

export type PersistHardRuleAssessmentResult = {
  assessmentId: string;
  reusedExistingAssessment: boolean;
  previousAssessmentId: string | null;
};

export type MapAssessmentToPersistenceInput = {
  scoringInput: ScoreHv0ScoringInput;
  assessment: IcpAssessment;
};

export type MapRulesV2AssessmentToPersistenceInput = {
  scoringInput: ScoreHv0ScoringInput & { icpRules: IcpVersionRulesV2 };
  assessment: IcpRulesV2Assessment;
};
