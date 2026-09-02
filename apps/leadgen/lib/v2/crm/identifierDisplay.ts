// Display mapping for a contact identifier's validity. The drawers previously branched on
// "VERIFIED"/"LIKELY"/"UNVERIFIED" — values that are NOT in the V2ContactIdentifierValidityStatus
// enum (VALID|INVALID|BOUNCED|SUPPRESSED|UNKNOWN|NOT_FOUND|PRIVATE), so every real value fell through
// to the neutral style and the "verified" chips never rendered. One source of truth for both drawers.

export type IdentifierTone = "good" | "bad" | "neutral";

export type IdentifierValidityDisplay = { label: string; tone: IdentifierTone; note: string };

const EMAIL_VALIDITY_DISPLAY: Record<string, IdentifierValidityDisplay> = {
  VALID: { label: "Valid", tone: "good", note: "Deliverable" },
  INVALID: { label: "Invalid", tone: "bad", note: "Undeliverable" },
  BOUNCED: { label: "Bounced", tone: "bad", note: "Hard bounced" },
  SUPPRESSED: { label: "Suppressed", tone: "bad", note: "Suppressed" },
  UNKNOWN: { label: "Unknown", tone: "neutral", note: "Unverified" },
  NOT_FOUND: { label: "Not found", tone: "neutral", note: "No address found" },
  PRIVATE: { label: "Private", tone: "neutral", note: "Private / gated" },
};

/** Describe an identifier validityStatus for the UI; unknown/legacy values degrade to neutral. */
export function describeIdentifierValidity(validityStatus: string | null | undefined): IdentifierValidityDisplay {
  return EMAIL_VALIDITY_DISPLAY[String(validityStatus ?? "").toUpperCase()] ?? EMAIL_VALIDITY_DISPLAY.UNKNOWN;
}
