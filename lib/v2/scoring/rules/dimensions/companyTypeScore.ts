import type { DimensionResult, NormalizedScoringEvidence } from "../evidence";
import type { IcpVersionRulesV2 } from "../schema-v2";

// SC2: company-type dimension. allow/deny lists over CompanyTypeV2.
// The services/consulting conditional exception lives in the terminal gate. Pure.

export function companyTypeScore(
  evidence: NormalizedScoringEvidence,
  rules: IcpVersionRulesV2
): DimensionResult {
  const { companyType } = rules;
  const type = evidence.company.companyType;
  const hasConstraint = companyType.allow.length > 0 || companyType.deny.length > 0;

  if (!hasConstraint) {
    return { dimension: "companyType", score: 70, hits: [], missingEvidence: [] };
  }

  if (companyType.deny.includes(type)) {
    return {
      dimension: "companyType",
      score: 0,
      hits: [{ id: "company_type_denied", label: `Company type denied (${type})`, reasonCode: "target_company_type_mismatch" }],
      missingEvidence: [],
    };
  }

  if (type === "UNKNOWN") {
    return {
      dimension: "companyType",
      score: 50,
      hits: [],
      missingEvidence: ["company_type_unknown"],
    };
  }

  if (companyType.allow.length === 0 || companyType.allow.includes(type)) {
    return {
      dimension: "companyType",
      score: 100,
      hits: [{ id: "company_type_match", label: `Target company type (${type})`, reasonCode: "target_company_type_match" }],
      missingEvidence: [],
    };
  }

  return {
    dimension: "companyType",
    score: 25,
    hits: [{ id: "company_type_off_target", label: `Off-target company type (${type})`, reasonCode: "target_company_type_mismatch" }],
    missingEvidence: [],
  };
}
