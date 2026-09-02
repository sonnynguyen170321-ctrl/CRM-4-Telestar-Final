import "server-only";

import { recordAuditEvent } from "@/lib/v2/audit";

import type { V2LeadWorkflowStatusValue } from "./types";

export type UpdateLeadWorkflowStatusInput = {
  organizationId: string;
  actorUserId: string;
  membershipId: string;
  leadAssignmentId: string;
  previousStatus: V2LeadWorkflowStatusValue;
  nextStatus: V2LeadWorkflowStatusValue;
  note?: string | null;
  source: "CRM_UI";
};

export type UpdateLeadWorkflowStatusResult =
  | {
      kind: "updated";
      workflowStatus: V2LeadWorkflowStatusValue;
    }
  | {
      kind: "not_found";
    }
  | {
      kind: "stale";
      currentStatus: V2LeadWorkflowStatusValue;
    };

type WorkflowStatusRow = {
  workflowStatus: V2LeadWorkflowStatusValue;
};

export type WorkflowStatusDb = {
  $transaction<T>(
    callback: (tx: WorkflowStatusTransactionDb) => Promise<T>
  ): Promise<T>;
};

export type WorkflowStatusTransactionDb = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

export async function updateLeadWorkflowStatus(
  input: UpdateLeadWorkflowStatusInput,
  db?: WorkflowStatusDb
): Promise<UpdateLeadWorkflowStatusResult> {
  const activeDb = db ?? (await getDefaultDb());

  return activeDb.$transaction(async (tx) => {
    const lockedRows = await tx.$queryRawUnsafe<WorkflowStatusRow[]>(
      `
        SELECT "workflowStatus"::text AS "workflowStatus"
        FROM "V2LeadAssignment"
        WHERE "id" = $1
          AND "organizationId" = $2
          AND "status" = 'ACTIVE'
          AND "deletedAt" IS NULL
        FOR UPDATE
      `,
      input.leadAssignmentId,
      input.organizationId
    );
    const locked = lockedRows[0];

    if (!locked) {
      return { kind: "not_found" };
    }

    if (locked.workflowStatus !== input.previousStatus) {
      return {
        kind: "stale",
        currentStatus: locked.workflowStatus,
      };
    }

    const updatedRows = await tx.$queryRawUnsafe<WorkflowStatusRow[]>(
      `
        UPDATE "V2LeadAssignment"
        SET
          "workflowStatus" = $1::"V2LeadWorkflowStatus",
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = $2
          AND "organizationId" = $3
          AND "status" = 'ACTIVE'
          AND "deletedAt" IS NULL
        RETURNING "workflowStatus"::text AS "workflowStatus"
      `,
      input.nextStatus,
      input.leadAssignmentId,
      input.organizationId
    );
    const updated = updatedRows[0];

    if (!updated) {
      return { kind: "not_found" };
    }

    await recordAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      eventType: "lead_assignment.workflow_status_changed",
      entityType: "V2LeadAssignment",
      entityId: input.leadAssignmentId,
      metadataJson: {
        previousStatus: input.previousStatus,
        nextStatus: input.nextStatus,
        source: input.source,
        membershipId: input.membershipId,
        ...(input.note ? { note: input.note } : {}),
      },
    });

    return {
      kind: "updated",
      workflowStatus: updated.workflowStatus,
    };
  });
}

async function getDefaultDb(): Promise<WorkflowStatusDb> {
  const { prisma } = await import("@/lib/server/prisma");

  return prisma;
}
