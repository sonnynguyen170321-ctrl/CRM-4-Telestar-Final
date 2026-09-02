import {
  deleteSdrActivityUpload,
  getSdrActivityUpload,
} from "@/lib/server/activityRecaps/persistence";
import { errorResponse, ok, serverError } from "@/lib/server/api/responses";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const upload = await getSdrActivityUpload(id);

    if (!upload) {
      return errorResponse("Activity recap not found.", 404);
    }

    return ok(upload);
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const upload = await getSdrActivityUpload(id);

    if (!upload) {
      return errorResponse("Activity recap not found.", 404);
    }

    await deleteSdrActivityUpload(id);
    return ok({ id });
  } catch (error) {
    return serverError(error);
  }
}

