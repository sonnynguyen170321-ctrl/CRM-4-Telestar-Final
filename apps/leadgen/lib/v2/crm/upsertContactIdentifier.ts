import { randomBytes } from "node:crypto";

import { normalizePhoneIdentifier } from "@/lib/v2/identity/phone";
import { isGenericEmailDomain } from "@/lib/v2/scoring/rules/dictionaries/genericEmail";

// The single writer for V2ContactIdentifier rows. Ingestion, research promotion, and manual enrich
// previously each had their own path: ingestion INSERTed raw (no normalization, isGeneric/isValid
// hardcoded, wrong "cnt_" id prefix, no source); research/enrich upserted via the Prisma client but
// forgot to update isValid on the update branch. This unifies all three so an identifier is written
// the same way regardless of origin. Takes only a raw-SQL db handle ({$queryRaw,$executeRaw}) so it
// works for both the Prisma client (research/enrich) and the job DB handle (ingestion), inside or
// outside a transaction. Pure of prisma import → unit-testable with a fake db.

type SqlTag = <T = unknown>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T>;
export type IdentifierDb = { $queryRaw: SqlTag; $executeRaw: SqlTag };

export type ContactIdentifierType = "EMAIL" | "PHONE" | "LINKEDIN";
export type ContactIdentifierValidity =
  | "VALID" | "INVALID" | "BOUNCED" | "SUPPRESSED" | "UNKNOWN" | "NOT_FOUND" | "PRIVATE";

// A status in this set (or a format that won't normalize) means the address/number must not be sent to.
const INVALID_STATUSES = new Set<ContactIdentifierValidity>(["INVALID", "BOUNCED", "SUPPRESSED", "NOT_FOUND"]);

export type UpsertContactIdentifierInput = {
  organizationId: string;
  contactId: string;
  type: ContactIdentifierType;
  rawValue: string;
  /** Defaults to UNKNOWN. `isValid` is derived from this AND the format check. */
  validityStatus?: ContactIdentifierValidity;
  /** Override; defaults to isGenericEmailDomain for EMAIL, false otherwise. */
  isGeneric?: boolean;
  source: string;
  /** ISO country used to normalize a bare national phone number (e.g. the company's country). */
  defaultPhoneCountry?: string | null;
};

export type UpsertContactIdentifierResult = {
  id: string;
  normalizedValue: string;
  isValid: boolean;
  validityStatus: ContactIdentifierValidity;
};

function normalizeForType(
  type: ContactIdentifierType,
  raw: string,
  defaultPhoneCountry?: string | null
): { normalizedValue: string | null; formatValid: boolean } {
  const cleaned = String(raw ?? "").trim();
  if (!cleaned) return { normalizedValue: null, formatValid: false };

  if (type === "EMAIL") {
    const email = cleaned.toLowerCase();
    return { normalizedValue: email, formatValid: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) };
  }
  if (type === "PHONE") {
    const parsed = normalizePhoneIdentifier(cleaned, (defaultPhoneCountry ?? undefined) as never);
    // Keep an un-normalizable number visible (marked invalid) rather than dropping it.
    return { normalizedValue: parsed.e164 ?? cleaned, formatValid: parsed.isValid };
  }
  return { normalizedValue: cleaned, formatValid: true }; // LINKEDIN: caller owns validity
}

/**
 * Upsert one contact identifier. Returns null only when the value is empty/unusable. Idempotent on
 * (org, contact, type, normalizedValue): existing rows are updated (status/isValid/isGeneric), else a
 * new `ci_`-prefixed row is inserted. `isValid` is true only when the format normalizes AND the status
 * is not a blocking one — so an undeliverable email or a malformed phone is stored but not sendable.
 */
export async function upsertContactIdentifier(
  db: IdentifierDb,
  input: UpsertContactIdentifierInput
): Promise<UpsertContactIdentifierResult | null> {
  const { normalizedValue, formatValid } = normalizeForType(input.type, input.rawValue, input.defaultPhoneCountry);
  if (!normalizedValue) return null;

  const validityStatus: ContactIdentifierValidity = input.validityStatus ?? "UNKNOWN";
  const isValid = formatValid && !INVALID_STATUSES.has(validityStatus);
  const isGeneric = input.isGeneric ?? (input.type === "EMAIL" ? isGenericEmailDomain(normalizedValue) : false);

  // Single idempotent upsert on the (org, type, normalizedValue, contactId) unique index — no
  // SELECT-then-write race. On conflict, refresh the mutable validity fields; keep the original
  // rawValue/source/createdAt. RETURNING yields the existing row's id when the insert was a no-op.
  const id = `ci_${randomBytes(8).toString("hex")}`;
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "V2ContactIdentifier" (
      "id", "organizationId", "contactId", "type", "normalizedValue", "rawValue",
      "isGeneric", "isValid", "validityStatus", "source", "createdAt", "updatedAt"
    ) VALUES (
      ${id}, ${input.organizationId}, ${input.contactId},
      ${input.type}::"V2ContactIdentifierType", ${normalizedValue}, ${input.rawValue},
      ${isGeneric}, ${isValid}, ${validityStatus}::"V2ContactIdentifierValidityStatus",
      ${input.source}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("organizationId", "type", "normalizedValue", "contactId")
    DO UPDATE SET
      "validityStatus" = EXCLUDED."validityStatus",
      "isValid" = EXCLUDED."isValid",
      "isGeneric" = EXCLUDED."isGeneric",
      "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "id"
  `;
  return { id: rows[0]?.id ?? id, normalizedValue, isValid, validityStatus };
}

/** Map an uploaded email-validation cell (deliverable/undeliverable/risky/unknown) to the enum. */
export function csvEmailValidationToStatus(raw: string | null | undefined): ContactIdentifierValidity {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "deliverable" || v === "valid") return "VALID";
  if (v === "undeliverable" || v === "invalid") return "INVALID";
  // risky / unknown / anything else → unverified but not a hard block
  return "UNKNOWN";
}
