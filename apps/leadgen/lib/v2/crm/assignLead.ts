import "server-only";

import { recordAuditEvent } from "@/lib/v2/audit";

// M1 lead ownership: assign (or unassign) a LeadAssignment to an SDR. The unit is
// the LeadAssignment, never a global company (Invariant 2). Ownership is separate
// from workflowStatus and qualification (Invariant 3). Every write is tenant-scoped
// from the caller's session orgId (Invariant 5) and logged to V2AuditEvent, which
// the lead timeline already unions (so the assignment shows in history for free).

export type AssignLeadDbTx = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

export type AssignLeadDb = AssignLeadDbTx & {
  $transaction<T>(fn: (tx: AssignLeadDbTx) => Promise<T>): Promise<T>;
};

export type AssignLeadInput = {
  organizationId: string;
  actorUserId: string;
  leadAssignmentId: string;
  /** Target owner user id, or null to unassign. */
  ownerUserId: string | null;
};

export type AssignLeadResult =
  | { kind: "assigned"; ownerUserId: string | null }
  | { kind: "no_change" }
  | { kind: "not_found" }
  | { kind: "invalid_assignee" };

/** Pure decision: is this a real change vs a no-op? (Unit-testable, no I/O.) */
export function classifyAssignment(
  currentOwnerId: string | null,
  requestedOwnerId: string | null
): "assign" | "no_change" {
  return (currentOwnerId ?? null) === (requestedOwnerId ?? null) ? "no_change" : "assign";
}

/** Validate the target user is an ACTIVE member of this org (soft-FK integrity). */
async function isActiveOrgMember(
  tx: AssignLeadDbTx,
  organizationId: string,
  userId: string
): Promise<boolean> {
  const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT app_user."id"
       FROM "V2User" app_user
       INNER JOIN "V2OrganizationMembership" membership
         ON membership."userId" = app_user."id"
         AND membership."organizationId" = $1
         AND membership."status" = 'ACTIVE'
      WHERE app_user."id" = $2 AND app_user."status" = 'ACTIVE'
      LIMIT 1`,
    organizationId,
    userId
  );
  return Boolean(rows[0]);
}

export async function assignLead(
  db: AssignLeadDb,
  input: AssignLeadInput
): Promise<AssignLeadResult> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe<Array<{ ownerUserId: string | null }>>(
      `SELECT "ownerUserId" FROM "V2LeadAssignment"
        WHERE "id" = $1 AND "organizationId" = $2 AND "deletedAt" IS NULL
        LIMIT 1`,
      input.leadAssignmentId,
      input.organizationId
    );
    const current = rows[0];
    if (!current) return { kind: "not_found" };

    if (classifyAssignment(current.ownerUserId, input.ownerUserId) === "no_change") {
      return { kind: "no_change" };
    }

    if (input.ownerUserId && !(await isActiveOrgMember(tx, input.organizationId, input.ownerUserId))) {
      return { kind: "invalid_assignee" };
    }

    await tx.$queryRawUnsafe(
      `UPDATE "V2LeadAssignment"
          SET "ownerUserId" = $1,
              "assignedAt" = ${input.ownerUserId ? "CURRENT_TIMESTAMP" : "NULL"},
              "assignedByUserId" = $2,
              "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = $3 AND "organizationId" = $4 AND "deletedAt" IS NULL`,
      input.ownerUserId,
      input.ownerUserId ? input.actorUserId : null,
      input.leadAssignmentId,
      input.organizationId
    );

    await recordAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      eventType: input.ownerUserId ? "lead.assigned" : "lead.unassigned",
      entityType: "V2LeadAssignment",
      entityId: input.leadAssignmentId,
      metadataJson: { previousOwner: current.ownerUserId, nextOwner: input.ownerUserId },
    });

    return { kind: "assigned", ownerUserId: input.ownerUserId };
  });
}
