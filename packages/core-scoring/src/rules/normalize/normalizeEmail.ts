import { extractEmailDomain, isGenericEmailDomain } from "../dictionaries/genericEmail";

// SC2: raw contact email -> { domain, isGeneric }. Powers the Gmail disqualifier. Pure.

export type NormalizedEmail = {
  emailDomain: string | null;
  isGenericEmail: boolean;
};

export function normalizeEmail(
  email: string | undefined | null
): NormalizedEmail {
  const domain = extractEmailDomain(email ?? "");

  return {
    emailDomain: domain,
    isGenericEmail: domain !== null && isGenericEmailDomain(domain),
  };
}
