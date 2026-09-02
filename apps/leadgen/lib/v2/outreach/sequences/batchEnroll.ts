import "server-only";

import type { V2JobDatabase } from "../../jobs/types";
import { enrollLead, type EnrollLeadResult, type EnrollSkipCode } from "./enrollLead";

// Batch "add to sequence" over a selection of leads. Sequential (not parallel) so
// the per-lead enroll stays inside one connection's transaction semantics and the
// idempotent unique (org, sequence, lead) is honoured deterministically. Returns a
// per-lead breakdown so the UI can show "12 enrolled, 3 already in, 1 no email".

export type BatchEnrollInput = {
  organizationId: string;
  sequenceId: string;
  senderAccountId: string;
  leadAssignmentIds: string[];
  enrolledByUserId?: string | null;
};

export type BatchEnrollItem = {
  leadAssignmentId: string;
  enrolled: boolean;
  code?: EnrollSkipCode;
  reason?: string;
  enrollmentId?: string;
};

export type BatchEnrollResult = {
  requested: number;
  enrolled: number;
  skipped: number;
  items: BatchEnrollItem[];
  skippedByCode: Partial<Record<EnrollSkipCode, number>>;
};

export async function batchEnroll(
  db: V2JobDatabase,
  input: BatchEnrollInput
): Promise<BatchEnrollResult> {
  const uniqueIds = Array.from(new Set(input.leadAssignmentIds.filter(Boolean)));
  const items: BatchEnrollItem[] = [];
  const skippedByCode: Partial<Record<EnrollSkipCode, number>> = {};
  let enrolled = 0;

  for (const leadAssignmentId of uniqueIds) {
    const result: EnrollLeadResult = await enrollLead(db, {
      organizationId: input.organizationId,
      sequenceId: input.sequenceId,
      senderAccountId: input.senderAccountId,
      leadAssignmentId,
      enrolledByUserId: input.enrolledByUserId,
    });

    if (result.enrolled) {
      enrolled++;
      items.push({ leadAssignmentId, enrolled: true, enrollmentId: result.enrollmentId });
    } else {
      skippedByCode[result.code] = (skippedByCode[result.code] ?? 0) + 1;
      items.push({
        leadAssignmentId,
        enrolled: false,
        code: result.code,
        reason: result.reason,
        enrollmentId: result.enrollmentId,
      });
    }
  }

  return {
    requested: uniqueIds.length,
    enrolled,
    skipped: uniqueIds.length - enrolled,
    items,
    skippedByCode,
  };
}
