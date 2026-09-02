import "server-only";

import type { PrismaClient } from "@/app/generated/prisma/client";
import { decideSuppression, type SuppressionCandidateRow } from "./decideSuppression";
import { extractDomainIdentifier, normalizeEmailIdentifier } from "./normalizeIdentifier";

export type BatchEmailCheckStatus =
  | "valid"
  | "suppressed"
  | "invalid"
  | "duplicate"
  | "missing";

export type BatchEmailCheckRow = {
  rowNumber: number;
  emailRaw: string;
  normalizedEmail: string | null;
  domain: string | null;
  status: BatchEmailCheckStatus;
  reason: string;
  suppressionType: string | null;
  suppressionMatchedOn: "email" | "domain" | null;
  contactIdentifierStatus: string | null;
  leadAssignmentId: string | null;
};

export type BatchEmailCheckSummary = Record<BatchEmailCheckStatus, number> & {
  total: number;
};

type ParsedRow = Record<string, string>;
type BatchDb = Pick<PrismaClient, "v2SuppressionEntry" | "v2ContactIdentifier">;

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const VALIDITY_BLOCKERS = new Set(["INVALID", "BOUNCED", "SUPPRESSED"]);

export function guessEmailColumn(headers: readonly string[]) {
  const exact = headers.find((header) => normalizeHeader(header) === "email");
  if (exact) return exact;
  return headers.find((header) => normalizeHeader(header).includes("email")) ?? null;
}

export function guessLeadAssignmentColumn(headers: readonly string[]) {
  const candidates = new Set(["leadassignmentid", "leadid", "v2leadassignmentid"]);
  return headers.find((header) => candidates.has(normalizeHeader(header))) ?? null;
}

export function summarizeBatchEmailRows(rows: readonly BatchEmailCheckRow[]): BatchEmailCheckSummary {
  const summary: BatchEmailCheckSummary = {
    total: rows.length,
    valid: 0,
    suppressed: 0,
    invalid: 0,
    duplicate: 0,
    missing: 0,
  };
  for (const row of rows) {
    summary[row.status]++;
  }
  return summary;
}

export async function checkBatchEmails(
  db: BatchDb,
  input: {
    organizationId: string;
    rows: readonly ParsedRow[];
    emailColumn: string;
    leadAssignmentColumn?: string | null;
    now?: Date;
  }
) {
  const now = input.now ?? new Date();
  const drafts = input.rows.map((row, index) => {
    const emailRaw = row[input.emailColumn]?.trim() ?? "";
    const normalizedEmail = normalizeEmailIdentifier(emailRaw);
    return {
      row,
      rowNumber: index + 2,
      emailRaw,
      normalizedEmail,
      domain: extractDomainIdentifier(normalizedEmail),
      leadAssignmentId: normalizeId(row[input.leadAssignmentColumn ?? ""] ?? null),
    };
  });
  const emails = Array.from(new Set(drafts.map((row) => row.normalizedEmail).filter(Boolean))) as string[];
  const domains = Array.from(new Set(drafts.map((row) => row.domain).filter(Boolean))) as string[];

  const [suppressions, identifiers] = await Promise.all([
    db.v2SuppressionEntry.findMany({
      where: {
        organizationId: input.organizationId,
        deletedAt: null,
        identifierType: { in: ["EMAIL", "DOMAIN"] },
        OR: [
          { identifierType: "EMAIL", identifierValueNormalized: { in: emails.length ? emails : ["__none__"] } },
          { identifierType: "DOMAIN", identifierValueNormalized: { in: domains.length ? domains : ["__none__"] } },
        ],
      },
      select: {
        id: true,
        identifierType: true,
        identifierValueNormalized: true,
        suppressionType: true,
        scopeType: true,
        deletedAt: true,
        expiresAt: true,
      },
    }),
    db.v2ContactIdentifier.findMany({
      where: {
        organizationId: input.organizationId,
        type: "EMAIL",
        normalizedValue: { in: emails.length ? emails : ["__none__"] },
      },
      select: {
        normalizedValue: true,
        isValid: true,
        validityStatus: true,
      },
    }),
  ]);

  const candidates = suppressions as unknown as SuppressionCandidateRow[];
  const identifierStatus = new Map<string, string>();
  for (const identifier of identifiers) {
    if (!identifier.isValid || VALIDITY_BLOCKERS.has(identifier.validityStatus)) {
      identifierStatus.set(identifier.normalizedValue, identifier.validityStatus);
    }
  }

  const seen = new Set<string>();
  return drafts.map((draft): BatchEmailCheckRow => {
    if (!draft.emailRaw) {
      return rowResult(draft, "missing", "No email in selected column.", null, null);
    }
    if (!draft.normalizedEmail || !EMAIL_RE.test(draft.normalizedEmail)) {
      return rowResult(draft, "invalid", "Email syntax is invalid.", null, null);
    }
    if (seen.has(draft.normalizedEmail)) {
      return rowResult(draft, "duplicate", "Duplicate email in this batch.", null, null);
    }
    seen.add(draft.normalizedEmail);
    const knownInvalid = identifierStatus.get(draft.normalizedEmail);
    if (knownInvalid) {
      return rowResult(draft, "invalid", "Existing contact identifier is " + knownInvalid + ".", null, knownInvalid);
    }
    const suppression = decideSuppression(candidates, { email: draft.normalizedEmail, now });
    if (suppression) {
      return rowResult(
        draft,
        "suppressed",
        "Matched " + suppression.suppressionType + " suppression on " + suppression.matchedOn + ".",
        suppression,
        null
      );
    }
    return rowResult(draft, "valid", "Ready for campaign enrollment checks.", null, null);
  });
}

function rowResult(
  draft: {
    rowNumber: number;
    emailRaw: string;
    normalizedEmail: string | null;
    domain: string | null;
    leadAssignmentId: string | null;
  },
  status: BatchEmailCheckStatus,
  reason: string,
  suppression: ReturnType<typeof decideSuppression>,
  contactIdentifierStatus: string | null
): BatchEmailCheckRow {
  return {
    rowNumber: draft.rowNumber,
    emailRaw: draft.emailRaw,
    normalizedEmail: draft.normalizedEmail,
    domain: draft.domain,
    status,
    reason,
    suppressionType: suppression?.suppressionType ?? null,
    suppressionMatchedOn: suppression?.matchedOn ?? null,
    contactIdentifierStatus,
    leadAssignmentId: draft.leadAssignmentId,
  };
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeId(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}
