// SC1 reference dictionary: free / consumer (generic) email domains.
//
// Powers the TeleStar "prospect uses Gmail account" terminal disqualifier and any
// ICP that wants to reject contacts who only expose a personal mailbox.
// Versioned data — a change MUST bump GENERIC_EMAIL_DICTIONARY_VERSION.
// Pure data + pure helpers only.

// Lowercased apex domains. Business suites (e.g. a company on Google Workspace at
// its own domain) are NOT here — only mailboxes that prove nothing about the company.
export const GENERIC_EMAIL_DOMAINS: readonly string[] = [
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.co.in",
  "ymail.com",
  "rocketmail.com",
  "hotmail.com",
  "hotmail.co.uk",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.net",
  "gmx.de",
  "mail.com",
  "yandex.com",
  "yandex.ru",
  "zohomail.com",
  "fastmail.com",
  "tutanota.com",
  "qq.com",
  "163.com",
  "126.com",
  "naver.com",
  "hanmail.net",
  "daum.net",
];

const GENERIC_EMAIL_DOMAIN_SET: ReadonlySet<string> = new Set(
  GENERIC_EMAIL_DOMAINS
);

export const GENERIC_EMAIL_DICTIONARY_VERSION = "generic-email-v1";

/**
 * Extract the apex domain from an email or a bare domain, lowercased and trimmed.
 * Returns null when no plausible domain is present.
 */
export function extractEmailDomain(emailOrDomain: string): string | null {
  const raw = String(emailOrDomain ?? "").trim().toLowerCase();

  if (!raw) {
    return null;
  }

  const atIndex = raw.lastIndexOf("@");
  const domain = atIndex >= 0 ? raw.slice(atIndex + 1) : raw;
  const cleaned = domain.replace(/^@+/, "").replace(/\/+$/, "").trim();

  return cleaned.includes(".") ? cleaned : null;
}

/** True when the given email/domain belongs to a known free/consumer provider. */
export function isGenericEmailDomain(emailOrDomain: string): boolean {
  const domain = extractEmailDomain(emailOrDomain);

  return domain !== null && GENERIC_EMAIL_DOMAIN_SET.has(domain);
}
