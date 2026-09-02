// Company and contact identity: normalisation, canonical domains, Vietnamese legal forms, dedupe keys.
//
// Shared by the CRM (repository root) and apps/leadgen. It is pure — the only runtime dependency is
// `libphonenumber-js` — so it can resolve identity for two applications whose schemas disagree
// (Tenant/Account/Contact here, V2Organization/V2Company/V2Contact there). Anything that reads or
// writes a database belongs in an app adapter, never here; the lint rule for `packages/**` enforces it.

export type {
  IdentityCompanyCandidate,
  IdentityContactCandidate,
  IdentityResolutionCandidates,
  IdentityResolutionContext,
  IdentityResolutionInput,
  IdentityResolutionKind,
  IdentityResolutionReason,
  IdentityResolutionResult,
  NormalizedIdentityRow,
} from "./types";

export {
  isGenericEmail,
  isPublicEmailDomain,
  normalizeCompanyName,
  normalizeIdentityDomain,
  normalizeIdentityText,
  resolveIdentity,
} from "./resolveIdentity";

export { normalizePhoneIdentifier, countryNameToIso, type NormalizedPhone } from "./phone";
export { foldAscii, isVietnameseSurnameFirst, splitPersonName, VN_SURNAMES } from "./personName";
