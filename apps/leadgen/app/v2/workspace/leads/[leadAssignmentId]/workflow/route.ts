import { NextResponse, type NextRequest } from "next/server";

import {
  updateLeadWorkflowStatus,
  V2_LEAD_WORKFLOW_STATUSES,
  type V2LeadWorkflowStatusValue,
} from "@/lib/v2/crm";
import { requirePermission, V2TenantError } from "@/lib/v2/tenant";

type RouteContext = {
  params: Promise<unknown>;
};

const WORKFLOW_STATUS_SET = new Set<string>(V2_LEAD_WORKFLOW_STATUSES);
const MAX_NOTE_LENGTH = 500;

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const tenantContext = await requirePermission("workflow.update");
    const leadAssignmentId = getLeadAssignmentId(await context.params);
    const input = await parseWorkflowInput(request);

    if (!leadAssignmentId?.trim() || !input.ok) {
      return workflowJson(
        {
          ok: false,
          code: "INVALID_WORKFLOW_UPDATE_INPUT",
          message: "Invalid workflow update input.",
        },
        400
      );
    }

    if (!isWorkflowStatus(input.nextStatus)) {
      return workflowJson(
        {
          ok: false,
          code: "INVALID_WORKFLOW_STATUS",
          message: "Invalid workflow status.",
        },
        400
      );
    }

    if (!isWorkflowStatus(input.previousStatus)) {
      return workflowJson(
        {
          ok: false,
          code: "INVALID_WORKFLOW_UPDATE_INPUT",
          message: "Invalid workflow update input.",
        },
        400
      );
    }

    const result = await updateLeadWorkflowStatus({
      organizationId: tenantContext.organizationId,
      actorUserId: tenantContext.userId,
      membershipId: tenantContext.membershipId,
      leadAssignmentId: leadAssignmentId.trim(),
      previousStatus: input.previousStatus,
      nextStatus: input.nextStatus,
      note: input.note,
      source: "CRM_UI",
    });

    if (result.kind === "not_found") {
      return workflowJson(
        {
          ok: false,
          code: "LEAD_ASSIGNMENT_NOT_FOUND",
          message: "Lead assignment was not found.",
        },
        404
      );
    }

    if (result.kind === "stale") {
      return workflowJson(
        {
          ok: false,
          code: "STALE_WORKFLOW_STATUS",
          message: "Workflow status changed since this drawer was loaded.",
          currentStatus: result.currentStatus,
        },
        409
      );
    }

    return workflowJson({
      ok: true,
      code: "WORKFLOW_STATUS_UPDATED",
      workflowStatus: result.workflowStatus,
    });
  } catch (error) {
    if (error instanceof V2TenantError) {
      return workflowJson(
        {
          ok: false,
          code: error.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN",
          message:
            error.code === "UNAUTHENTICATED"
              ? "Authentication is required."
              : "You do not have permission to update this workflow.",
        },
        error.code === "UNAUTHENTICATED" ? 401 : 403
      );
    }

    console.error("V2 workflow update failed", error);

    return workflowJson(
      {
        ok: false,
        code: "WORKFLOW_UPDATE_FAILED",
        message: "Workflow update failed.",
      },
      500
    );
  }
}

async function parseWorkflowInput(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return { ok: false as const };
  }

  if (!body || typeof body !== "object") {
    return { ok: false as const };
  }

  const raw = body as {
    previousStatus?: unknown;
    nextStatus?: unknown;
    note?: unknown;
  };

  if (
    typeof raw.previousStatus !== "string" ||
    typeof raw.nextStatus !== "string"
  ) {
    return { ok: false as const };
  }

  const note = normalizeNote(raw.note);

  if (note === undefined) {
    return { ok: false as const };
  }

  return {
    ok: true as const,
    previousStatus: raw.previousStatus,
    nextStatus: raw.nextStatus,
    note,
  };
}

function normalizeNote(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim().slice(0, MAX_NOTE_LENGTH);

  return trimmed || null;
}

function isWorkflowStatus(value: string): value is V2LeadWorkflowStatusValue {
  return WORKFLOW_STATUS_SET.has(value);
}

function getLeadAssignmentId(params: unknown) {
  if (!params || typeof params !== "object") {
    return undefined;
  }

  const value = (params as { leadAssignmentId?: unknown }).leadAssignmentId;

  return typeof value === "string" ? value : undefined;
}

function workflowJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}
