import { NextResponse, type NextRequest } from "next/server";

import {
  createFeedbackExample,
  isFeedbackDatasetSplit,
  isFeedbackFinalQualification,
  type FeedbackDatasetSplit,
  type FeedbackDb,
  type FeedbackFinalQualification,
} from "@/lib/v2/feedback";
import { prisma } from "@/lib/server/prisma";
import { hasPermission, requirePermission, V2TenantError } from "@/lib/v2/tenant";

const MAX_REASON_LENGTH = 2000;

export async function POST(request: NextRequest) {
  try {
    const tenantContext = await requirePermission("feedback.write");
    const input = await parseFeedbackInput(request);

    if (!input.ok) {
      return feedbackJson(
        {
          ok: false,
          code: "INVALID_FEEDBACK_INPUT",
          message: input.message ?? "Invalid feedback input.",
        },
        400
      );
    }

    // M4: tuning eligibility is manager-gated. Only a feedback.approve role may
    // pre-approve at capture; everyone else captures a PENDING example that a
    // manager approves separately. Prevents an SDR self-approving their own signal.
    const mayApprove = hasPermission(tenantContext.role, "feedback.approve");
    const approvedForLearning = mayApprove ? input.approvedForLearning : false;

    const result = await createFeedbackExample(
      {
        organizationId: tenantContext.organizationId,
        leadAssignmentId: input.leadAssignmentId,
        reviewedByUserId: tenantContext.userId,
        finalQualification: input.finalQualification,
        finalFitScore: input.finalFitScore,
        finalCompanyType: input.finalCompanyType,
        finalReason: input.finalReason,
        approvedForLearning,
        datasetSplit: approvedForLearning ? input.datasetSplit : "UNSPECIFIED",
        source: "manual_review",
      },
      prisma as unknown as FeedbackDb
    );

    if (result.kind === "created") {
      return feedbackJson({
        ok: true,
        code: "FEEDBACK_CAPTURED",
        feedbackId: result.example.id,
      });
    }

    if (result.kind === "duplicate") {
      // Idempotent: an exact duplicate is a no-op success.
      return feedbackJson({
        ok: true,
        code: "FEEDBACK_ALREADY_CAPTURED",
        feedbackId: result.example.id,
        noop: true,
      });
    }

    if (result.kind === "lead_not_found") {
      return feedbackJson(
        { ok: false, code: "LEAD_NOT_FOUND", message: result.message },
        404
      );
    }

    return feedbackJson(
      { ok: false, code: result.code, message: result.message },
      400
    );
  } catch (error) {
    if (error instanceof V2TenantError) {
      return feedbackJson(
        {
          ok: false,
          code: error.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN",
          message:
            error.code === "UNAUTHENTICATED"
              ? "Authentication is required."
              : "You do not have permission to capture feedback.",
        },
        error.code === "UNAUTHENTICATED" ? 401 : 403
      );
    }

    console.error("V2 feedback capture failed", error);

    return feedbackJson(
      { ok: false, code: "FEEDBACK_CAPTURE_FAILED", message: "Feedback capture failed." },
      500
    );
  }
}

type ParsedFeedbackInput =
  | {
      ok: true;
      leadAssignmentId: string;
      finalQualification: FeedbackFinalQualification;
      finalFitScore: number | null;
      finalCompanyType: string | null;
      finalReason: string | null;
      approvedForLearning: boolean;
      datasetSplit: FeedbackDatasetSplit;
    }
  | { ok: false; message?: string };

async function parseFeedbackInput(request: Request): Promise<ParsedFeedbackInput> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return { ok: false };
  }

  if (!body || typeof body !== "object") {
    return { ok: false };
  }

  const raw = body as Record<string, unknown>;

  if (typeof raw.leadAssignmentId !== "string" || !raw.leadAssignmentId.trim()) {
    return { ok: false, message: "leadAssignmentId is required." };
  }

  if (
    typeof raw.finalQualification !== "string" ||
    !isFeedbackFinalQualification(raw.finalQualification)
  ) {
    return { ok: false, message: "finalQualification is invalid." };
  }

  const finalFitScore = parseNullableInt(raw.finalFitScore);

  if (finalFitScore === "invalid") {
    return { ok: false, message: "finalFitScore must be an integer 0-100." };
  }

  const datasetSplit =
    typeof raw.datasetSplit === "string" && raw.datasetSplit
      ? raw.datasetSplit
      : "UNSPECIFIED";

  if (!isFeedbackDatasetSplit(datasetSplit)) {
    return { ok: false, message: "datasetSplit is invalid." };
  }

  return {
    ok: true,
    leadAssignmentId: raw.leadAssignmentId.trim(),
    finalQualification: raw.finalQualification,
    finalFitScore,
    finalCompanyType:
      typeof raw.finalCompanyType === "string" && raw.finalCompanyType.trim()
        ? raw.finalCompanyType.trim()
        : null,
    finalReason:
      typeof raw.finalReason === "string" && raw.finalReason.trim()
        ? raw.finalReason.trim().slice(0, MAX_REASON_LENGTH)
        : null,
    approvedForLearning: raw.approvedForLearning === true,
    datasetSplit,
  };
}

function parseNullableInt(value: unknown): number | null | "invalid" {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    return "invalid";
  }

  return parsed;
}

function feedbackJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}
