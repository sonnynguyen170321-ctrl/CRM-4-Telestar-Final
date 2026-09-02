import { z } from "zod";

import {
  errorResponse,
  ok,
  serverError,
  validationError,
} from "@/lib/server/api/responses";
import {
  getManagerReviewItem,
  updateManagerReviewItem,
} from "@/lib/server/managerReview/managerReviewItems";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const updateReviewSchema = z.object({
  status: z.enum(["open", "reviewed", "needs_follow_up", "dismissed"]).optional(),
  managerNote: z.string().nullable().optional(),
  nextAction: z.string().nullable().optional(),
  reviewedBy: z.string().nullable().optional(),
});

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const item = await getManagerReviewItem(id);
    if (!item) {
      return errorResponse("Manager review item not found.", 404);
    }

    return ok(item);
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const parsed = updateReviewSchema.safeParse(await request.json());
    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const item = await updateManagerReviewItem(id, parsed.data);
    if (!item) {
      return errorResponse("Manager review item not found.", 404);
    }

    return ok(item);
  } catch (error) {
    return serverError(error);
  }
}
