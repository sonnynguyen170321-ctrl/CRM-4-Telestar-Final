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
