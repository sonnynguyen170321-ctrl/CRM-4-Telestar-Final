import { getSdrActivityUpload } from "@/lib/server/activityRecaps/persistence";
import { errorResponse, ok, serverError } from "@/lib/server/api/responses";
import { syncManagerReviewItemsForActivityUpload } from "@/lib/server/managerReview/managerReviewItems";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const upload = await getSdrActivityUpload(id);
    if (!upload) {
      return errorResponse("Activity recap not found.", 404);
    }

    const summary = await syncManagerReviewItemsForActivityUpload(id);
    return ok(summary);
  } catch (error) {
    return serverError(error);
  }
}
