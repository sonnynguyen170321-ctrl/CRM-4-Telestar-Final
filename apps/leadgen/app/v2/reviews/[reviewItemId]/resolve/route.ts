import { NextResponse, type NextRequest } from "next/server";

import {
  isManagerReviewResolutionType,
  queryReviewItem,
  resolveReviewItem,
} from "@/lib/v2/manager-review";
import { requirePermission, V2TenantError } from "@/lib/v2/tenant";

type RouteContext = {
  params: Promise<unknown>;
};

const MAX_NOTE_LENGTH = 1000;

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const tenantContext = await requirePermission("manager_review.decide");
    const reviewItemId = getReviewItemId(await context.params);
    const input = await parseResolveInput(request);

    if (!reviewItemId?.trim() || !input.ok) {
      return resolveJson(
        {
          ok: false,
          code: "INVALID_RESOLVE_INPUT",
          message: "Invalid review resolution input.",
        },
        400
      );
    }

    if (!isManagerReviewResolutionType(input.resolutionType)) {
      return resolveJson(
        {
          ok: false,
          code: "INVALID_RESOLUTION_TYPE",
          message: "Invalid resolution type.",
        },
        400
      );
    }

    const result = await resolveReviewItem({
      organizationId: tenantContext.organizationId,
      actorUserId: tenantContext.userId,
      membershipId: tenantContext.membershipId,
      reviewItemId: reviewItemId.trim(),
      resolutionType: input.resolutionType,
      resolutionNote: input.resolutionNote,
      source: "CRM_UI",
    });

    if (result.kind === "resolved") {
      return resolveJson({
        ok: true,
        code: "REVIEW_ITEM_RESOLVED",
        status: result.item.status,
        resolutionType: result.item.resolutionType,
        resolvedAt: result.item.resolvedAt,
      });
    }

    if (result.kind === "not_found") {
      return resolveJson(
        {
          ok: false,
          code: "REVIEW_ITEM_NOT_FOUND",
          message: "Review item was not found.",
        },
        404
      );
    }

    // Idempotency (M1 exit proof): a duplicate resolve on an already-terminal
    // item is a no-op SUCCESS, not an error. The runtime rejects the second
    // transition (so no second update/audit is written — Invariant 4/6); we
    // translate that into a no-op success only when the item is already in a
    // terminal state.
    if (result.kind === "invalid" && result.code === "INVALID_TRANSITION") {
      const existing = await queryReviewItem({
        organizationId: tenantContext.organizationId,
        reviewItemId: reviewItemId.trim(),
      });

      if (existing && isTerminalStatus(existing.item.status)) {
        return resolveJson({
          ok: true,
          code: "REVIEW_ITEM_ALREADY_RESOLVED",
          status: existing.item.status,
          resolutionType: existing.item.resolutionType,
          resolvedAt: existing.item.resolvedAt,
          noop: true,
        });
      }

      return resolveJson(
        {
          ok: false,
          code: "INVALID_TRANSITION",
          message: result.message,
        },
        409
      );
    }

    return resolveJson(
      {
        ok: false,
        code: result.code,
        message: result.message,
      },
      400
    );
  } catch (error) {
    if (error instanceof V2TenantError) {
      return resolveJson(
        {
          ok: false,
          code: error.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN",
          message:
            error.code === "UNAUTHENTICATED"
              ? "Authentication is required."
              : "You do not have permission to resolve review items.",
        },
        error.code === "UNAUTHENTICATED" ? 401 : 403
      );
    }

    console.error("V2 review resolution failed", error);

    return resolveJson(
      {
        ok: false,
        code: "REVIEW_RESOLUTION_FAILED",
        message: "Review resolution failed.",
      },
      500
    );
  }
}

async function parseResolveInput(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return { ok: false as const };
  }

  if (!body || typeof body !== "object") {
    return { ok: false as const };
  }

  const raw = body as { resolutionType?: unknown; resolutionNote?: unknown };

  if (typeof raw.resolutionType !== "string") {
    return { ok: false as const };
  }

  const resolutionNote = normalizeNote(raw.resolutionNote);

  if (resolutionNote === undefined) {
    return { ok: false as const };
  }

  return {
    ok: true as const,
    resolutionType: raw.resolutionType,
    resolutionNote,
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

function isTerminalStatus(status: string) {
  return status === "RESOLVED" || status === "DISMISSED" || status === "ARCHIVED";
}

function getReviewItemId(params: unknown) {
  if (!params || typeof params !== "object") {
    return undefined;
  }

  const value = (params as { reviewItemId?: unknown }).reviewItemId;

  return typeof value === "string" ? value : undefined;
}

function resolveJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}
