// The classification shapes verification scoring reads (owner report, 2026-10-08). Scoring was built in
// parallel with the classifier and mirrored its contract here; the contract now exists, so this module
// only re-exports it — one COMPANY_KINDS, one safeAlias, one shape — and nothing can drift.
export {
  COMPANY_KINDS,
  NOT_COMPANY_REASONS,
  type ClassificationConfidence,
  type ClassificationEvidence,
  type CompanyKind,
  type NotCompanyReason,
} from "./companyClassification";
export { safeAlias } from "./groundClassification";

import type { CompanyClassification } from "./companyClassification";

/** What scoring consumes: a grounded classification. */
export type CompanyClassificationInput = CompanyClassification;
