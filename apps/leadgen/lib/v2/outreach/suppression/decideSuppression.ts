import { extractDomainIdentifier, normalizeEmailIdentifier } from "./normalizeIdentifier";

// O2: pure suppression decision over candidate rows. Separated from the DB query
// so it is fully testable without a database. An entry suppresses when it is
// active (not soft-deleted, not expired) and its normalized identifier matches the
// target email (EMAIL) or its domain (DOMAIN). Org scoping is done by the query.

export type SuppressionIdentifierType = "EMAIL" | "DOMAIN" | "PHONE" | "LINKEDIN" | "CONTACT_ID" | "COMPANY_ID";

export type SuppressionCandidateRow = {
  id: string;
  identifierType: SuppressionIdentifierType;
  identifierValueNormalized: string;
  suppressionType: string; // V2SuppressionType (UNSUBSCRIBE|BOUNCE|BLACKLIST|MANUAL|TENANT_LEVEL|GLOBAL)
  scopeType?: string | null;
  deletedAt?: Date | string | null;
  expiresAt?: Date | string | null;
};

export type SuppressionMatch = {
  entryId: string;
  identifierType: SuppressionIdentifierType;
  suppressionType: string;
  matchedOn: "email" | "domain";
};

function isActive(row: SuppressionCandidateRow, now: Date): boolean {
  if (row.deletedAt) {
    return false;
  }
  if (row.expiresAt) {
    const expires = row.expiresAt instanceof Date ? row.expiresAt : new Date(row.expiresAt);
    if (!Number.isNaN(expires.getTime()) && expires.getTime() <= now.getTime()) {
      return false;
    }
  }
  return true;
}

export function decideSuppression(
  candidates: readonly SuppressionCandidateRow[],
  input: { email: string | null | undefined; now?: Date }
): SuppressionMatch | null {
  const now = input.now ?? new Date();
  const email = normalizeEmailIdentifier(input.email);
  const domain = extractDomainIdentifier(input.email);

  if (!email) {
    return null;
  }

  for (const row of candidates) {
    if (!isActive(row, now)) {
      continue;
    }
    if (row.identifierType === "EMAIL" && row.identifierValueNormalized === email) {
      return { entryId: row.id, identifierType: "EMAIL", suppressionType: row.suppressionType, matchedOn: "email" };
    }
    if (
      row.identifierType === "DOMAIN" &&
      domain !== null &&
      row.identifierValueNormalized === domain
    ) {
      return { entryId: row.id, identifierType: "DOMAIN", suppressionType: row.suppressionType, matchedOn: "domain" };
    }
  }

  return null;
}

// Redacted descriptor for logs/audit — never includes the full email (Invariant 9/10).
export function redactEmail(email: string | null | undefined): string {
  const value = normalizeEmailIdentifier(email);
  if (!value) {
    return "<no-email>";
  }
  const [local, domain] = value.split("@");
  const head = local.slice(0, 1);
  return `${head}***@${domain ?? "?"}`;
}
