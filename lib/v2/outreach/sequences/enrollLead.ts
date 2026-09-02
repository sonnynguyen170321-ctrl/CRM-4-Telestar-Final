import "server-only";

import { enqueueV2Job } from "../../jobs/enqueueJob";
import type { V2JobDatabase } from "../../jobs/types";

// Enrollment creation (Apollo-style "add to sequence"). Validates the sequence is
// publishable+ACTIVE, the lead resolves to a contact with a real email, and the
// sender is active; then inserts a single V2SequenceEnrollment and kicks the first
// SEQUENCE_STEP_EXECUTE. Idempotent on the unique (org, sequence, lead) — a repeat
// enroll is a no-op that reports the existing status (Invariant 6). No send happens
// here: the step handler enqueues EMAIL_SEND, which passes the suppression gate
// (Invariant 10) before any provider call. Tenant-scoped throughout (Invariant 5).

export type EnrollLeadInput = {
  organizationId: string;
  sequenceId: string;
  leadAssignmentId: string;
  contactId?: string | null;
  senderAccountId: string;
  enrolledByUserId?: string | null;
};

export type EnrollSkipCode =
  | "SEQUENCE_NOT_ACTIVE"
  | "SEQUENCE_EMPTY"
  | "LEAD_NOT_FOUND"
  | "SENDER_NOT_ACTIVE"
  | "NO_CONTACT"
  | "NO_CONTACT_EMAIL"
  | "ALREADY_ENROLLED";

export type EnrollLeadResult =
  | { enrolled: true; enrollmentId: string }
  | { enrolled: false; code: EnrollSkipCode; reason: string; enrollmentId?: string; existingStatus?: string };

const SKIP_REASONS: Record<EnrollSkipCode, string> = {
  SEQUENCE_NOT_ACTIVE: "Sequence is not published (must be ACTIVE).",
  SEQUENCE_EMPTY: "Sequence has no steps.",
  LEAD_NOT_FOUND: "Lead assignment not found or inactive.",
  SENDER_NOT_ACTIVE: "Sender account is not active.",
  NO_CONTACT: "Lead has no contact to email.",
  NO_CONTACT_EMAIL: "Contact has no valid email address.",
  ALREADY_ENROLLED: "Lead is already enrolled in this sequence.",
};

export async function enrollLead(
  db: V2JobDatabase,
  input: EnrollLeadInput
): Promise<EnrollLeadResult> {
  const org = input.organizationId;

  // 1. Sequence must be ACTIVE (published) and own at least one step.
  const [sequence] = await db.$queryRaw<Array<{ status: string; firstOrdinal: number | null }>>`
    SELECT
      s."status"::text AS "status",
      (SELECT MIN(st."ordinal") FROM "V2SequenceStep" st
         WHERE st."sequenceId" = s."id" AND st."organizationId" = ${org}) AS "firstOrdinal"
    FROM "V2Sequence" s
    WHERE s."id" = ${input.sequenceId} AND s."organizationId" = ${org} AND s."deletedAt" IS NULL
    LIMIT 1`;
  if (!sequence) return skip("SEQUENCE_NOT_ACTIVE");
  if (sequence.status !== "ACTIVE") return skip("SEQUENCE_NOT_ACTIVE");
  if (sequence.firstOrdinal == null) return skip("SEQUENCE_EMPTY");
  const firstOrdinal = Number(sequence.firstOrdinal);

  // 2. Lead must be active; resolve the contact (explicit input wins, else the lead's).
  const [lead] = await db.$queryRaw<Array<{ contactId: string | null }>>`
    SELECT "contactId"
    FROM "V2LeadAssignment"
    WHERE "id" = ${input.leadAssignmentId} AND "organizationId" = ${org}
      AND "deletedAt" IS NULL AND "status" = 'ACTIVE'
    LIMIT 1`;
  if (!lead) return skip("LEAD_NOT_FOUND");
  const contactId = input.contactId ?? lead.contactId;
  if (!contactId) return skip("NO_CONTACT");

  // 3. Contact must have a valid EMAIL identifier (the actual recipient).
  const [email] = await db.$queryRaw<Array<{ normalizedValue: string }>>`
    SELECT "normalizedValue"
    FROM "V2ContactIdentifier"
    WHERE "contactId" = ${contactId} AND "organizationId" = ${org}
      AND "type" = 'EMAIL' AND "isValid" = true
    ORDER BY "createdAt" ASC
    LIMIT 1`;
  if (!email) return skip("NO_CONTACT_EMAIL");

  // 4. Sender must be active.
  const [sender] = await db.$queryRaw<Array<{ status: string }>>`
    SELECT "status"::text AS "status"
    FROM "V2SenderAccount"
    WHERE "id" = ${input.senderAccountId} AND "organizationId" = ${org}
    LIMIT 1`;
  if (!sender || sender.status !== "ACTIVE") return skip("SENDER_NOT_ACTIVE");

  // 5. Insert the enrollment. ON CONFLICT DO NOTHING on (org, sequence, lead) makes
  // re-enroll a no-op; RETURNING tells us whether *this* call created the row.
  const enrollmentId = `enr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const inserted = await db.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "V2SequenceEnrollment"
      ("id", "organizationId", "sequenceId", "leadAssignmentId", "contactId", "senderAccountId",
       "status", "currentStepOrdinal", "nextStepAt", "enrolledByUserId", "createdAt", "updatedAt")
    VALUES (${enrollmentId}, ${org}, ${input.sequenceId}, ${input.leadAssignmentId}, ${contactId},
       ${input.senderAccountId}, 'ACTIVE', ${firstOrdinal}, CURRENT_TIMESTAMP, ${input.enrolledByUserId ?? null},
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("organizationId", "sequenceId", "leadAssignmentId") DO NOTHING
    RETURNING "id"`;

  if (!inserted[0]) {
    // Conflict: already enrolled — report the existing status, don't double-kick.
    const [existing] = await db.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT "id", "status"::text AS "status"
      FROM "V2SequenceEnrollment"
      WHERE "organizationId" = ${org} AND "sequenceId" = ${input.sequenceId}
        AND "leadAssignmentId" = ${input.leadAssignmentId}
      LIMIT 1`;
    return {
      enrolled: false,
      code: "ALREADY_ENROLLED",
      reason: SKIP_REASONS.ALREADY_ENROLLED,
      enrollmentId: existing?.id,
      existingStatus: existing?.status,
    };
  }

  // 6. Kick the first step. Idempotency key carries the ordinal so each step gets
  // exactly one job, but progression to the next ordinal yields a fresh job.
  await enqueueV2Job(db, {
    organizationId: org,
    jobType: "SEQUENCE_STEP_EXECUTE",
    sourceType: "SEQUENCE_ENROLLMENT",
    sourceId: enrollmentId,
    idempotencyKey: `seq-step-exec:${enrollmentId}:${firstOrdinal}`,
    payload: { schemaVersion: "v2.sequence-step.v1", enrollmentId },
    createdByUserId: input.enrolledByUserId ?? null,
  });

  return { enrolled: true, enrollmentId };
}

function skip(code: EnrollSkipCode): EnrollLeadResult {
  return { enrolled: false, code, reason: SKIP_REASONS[code] };
}
