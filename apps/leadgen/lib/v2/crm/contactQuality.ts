import { isGenericEmailDomain } from "@telestar/core-scoring/rules/dictionaries/genericEmail";

// Deterministic contact-quality + LinkedIn-access assessment. No network, no scraping — a
// controlled reachability probe is an optional env-gated adapter (V2_LINKEDIN_PROBE_PROVIDER,
// OFF by default) whose result feeds validityStatus; this lib judges from the URL shape +
// whatever validityStatus was persisted. Pure so it runs in ingestion, scoring, and the UI.

export type LinkedInAccess =
  | "OK"          // person profile, no negative signal
  | "NOT_FOUND"   // probe/import marked 404
  | "PRIVATE"     // probe/import marked private
  | "MALFORMED"   // not a usable person-profile URL
  | "UNKNOWN"     // present but unverified
  | "NONE";       // no LinkedIn identifier at all

export type ContactQualityReason =
  | "NO_EMAIL"
  | "GENERIC_EMAIL"
  | "NO_LINKEDIN"
  | "LINKEDIN_NOT_FOUND"
  | "LINKEDIN_PRIVATE"
  | "LINKEDIN_MALFORMED"
  | "MISSING_TITLE";

export type ContactQuality = {
  linkedInAccess: LinkedInAccess;
  reasons: ContactQualityReason[];
  outreachReady: boolean; // has at least one usable channel (real email or reachable LinkedIn)
  personaReady: boolean;  // has a title to assess persona against
};

const PERSON_PATH_RE = /^\/(in|pub)\/[^/]+/i;
const NON_PERSON_PATH_RE = /^\/(company|school|showcase)\//i;

/** Judge a LinkedIn URL + any persisted validity into an access class. Pure. */
export function assessLinkedInAccess(input: {
  url: string | null | undefined;
  validityStatus?: string | null;
}): LinkedInAccess {
  const url = (input.url ?? "").trim();
  if (!url) return "NONE";

  // A persisted negative signal (from import column or a probe adapter) wins.
  const status = (input.validityStatus ?? "").toUpperCase();
  if (status === "NOT_FOUND") return "NOT_FOUND";
  if (status === "PRIVATE") return "PRIVATE";

  let host: string;
  let pathname: string;
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    host = parsed.hostname.toLowerCase();
    pathname = parsed.pathname;
  } catch {
    return "MALFORMED";
  }
  if (!host.endsWith("linkedin.com")) return "MALFORMED";
  if (NON_PERSON_PATH_RE.test(pathname)) return "MALFORMED"; // company page is not a person
  if (!PERSON_PATH_RE.test(pathname)) return "MALFORMED";

  if (status === "INVALID") return "MALFORMED";
  return "OK";
}

// Role/shared mailbox local-parts — a "generic contact" the user wants filtered, distinct
// from a generic free-email DOMAIN (gmail etc). Both count as GENERIC_EMAIL.
const ROLE_LOCALPARTS = new Set([
  "info", "sales", "hello", "contact", "support", "admin", "team", "marketing", "hr",
  "careers", "jobs", "noreply", "no-reply", "office", "mail", "enquiries", "inquiries",
  "help", "billing", "accounts", "press", "media", "general",
]);

function isGenericEmail(email: string): boolean {
  if (isGenericEmailDomain(email)) return true;
  const local = email.split("@")[0]?.trim().toLowerCase();
  return local ? ROLE_LOCALPARTS.has(local) : false;
}

export type AssessContactQualityInput = {
  email: string | null | undefined;
  title: string | null | undefined;
  linkedInUrl: string | null | undefined;
  linkedInValidityStatus?: string | null;
};

export function assessContactQuality(input: AssessContactQualityInput): ContactQuality {
  const reasons: ContactQualityReason[] = [];
  const email = (input.email ?? "").trim();
  const hasEmail = email.length > 0;
  const genericEmail = hasEmail && isGenericEmail(email);
  if (!hasEmail) reasons.push("NO_EMAIL");
  else if (genericEmail) reasons.push("GENERIC_EMAIL");

  const access = assessLinkedInAccess({ url: input.linkedInUrl, validityStatus: input.linkedInValidityStatus });
  if (access === "NONE") reasons.push("NO_LINKEDIN");
  else if (access === "NOT_FOUND") reasons.push("LINKEDIN_NOT_FOUND");
  else if (access === "PRIVATE") reasons.push("LINKEDIN_PRIVATE");
  else if (access === "MALFORMED") reasons.push("LINKEDIN_MALFORMED");

  const hasTitle = Boolean((input.title ?? "").trim());
  if (!hasTitle) reasons.push("MISSING_TITLE");

  // Usable channel = a real (non-generic) email OR a reachable LinkedIn.
  const usableEmail = hasEmail && !genericEmail;
  const usableLinkedIn = access === "OK";
  const outreachReady = usableEmail || usableLinkedIn;

  return { linkedInAccess: access, reasons, outreachReady, personaReady: hasTitle };
}


export type ContactabilityStatus = "ready" | "review" | "linkedin_only" | "company_phone" | "missing";

export type Contactability = {
  status: ContactabilityStatus;
  primaryChannel: "email" | "linkedin" | "phone" | "none";
  emailUsable: boolean;
  reasons: ContactQualityReason[];
};

export function deriveContactability(input: AssessContactQualityInput & {
  emailValidityStatus?: string | null;
  emailIsGeneric?: boolean | null;
  phone?: string | null | undefined;
}): Contactability {
  const email = (input.email ?? "").trim();
  const emailStatus = (input.emailValidityStatus ?? "").toUpperCase();
  const genericEmail = Boolean(input.emailIsGeneric) || (email ? isGenericEmail(email) : false);
  const emailUsable = Boolean(email) && !genericEmail && ["VERIFIED", "VALID"].includes(emailStatus);
  const quality = assessContactQuality(input);
  const hasPhone = Boolean((input.phone ?? "").trim());

  if (emailUsable) {
    return { status: "ready", primaryChannel: "email", emailUsable: true, reasons: quality.reasons };
  }
  if (email || quality.linkedInAccess === "OK") {
    return {
      status: quality.linkedInAccess === "OK" && !email ? "linkedin_only" : "review",
      primaryChannel: email ? "email" : "linkedin",
      emailUsable: false,
      reasons: quality.reasons,
    };
  }
  if (hasPhone) {
    return { status: "company_phone", primaryChannel: "phone", emailUsable: false, reasons: quality.reasons };
  }
  return { status: "missing", primaryChannel: "none", emailUsable: false, reasons: quality.reasons };
}

export function contactabilityLabel(status: ContactabilityStatus): string {
  switch (status) {
    case "ready": return "Ready";
    case "review": return "Review channel";
    case "linkedin_only": return "LinkedIn only";
    case "company_phone": return "Company phone";
    case "missing": return "Missing";
  }
}
const REASON_LABELS: Record<ContactQualityReason, string> = {
  NO_EMAIL: "No email",
  GENERIC_EMAIL: "Generic email",
  NO_LINKEDIN: "No LinkedIn",
  LINKEDIN_NOT_FOUND: "LinkedIn 404",
  LINKEDIN_PRIVATE: "LinkedIn private",
  LINKEDIN_MALFORMED: "Bad LinkedIn URL",
  MISSING_TITLE: "No title",
};

export function contactQualityReasonLabel(reason: ContactQualityReason): string {
  return REASON_LABELS[reason];
}

/** Bucket for the leads filter: accessible = OK; blocked = 404/private/malformed; missing = none. */
export function linkedInAccessBucket(access: LinkedInAccess): "accessible" | "blocked" | "missing" | "unknown" {
  if (access === "OK") return "accessible";
  if (access === "NONE") return "missing";
  if (access === "UNKNOWN") return "unknown";
  return "blocked";
}
