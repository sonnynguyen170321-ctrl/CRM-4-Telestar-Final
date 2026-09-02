import { z } from "zod";

import {
  getEffectiveAiStatus,
  updateAiRuntimeSetting,
} from "@/lib/server/ai/runtimeSettings";
import {
  errorResponse,
  serverError,
  validationError,
} from "@/lib/server/api/responses";

export const runtime = "nodejs";

const aiSettingsSchema = z.object({
  enabled: z.boolean(),
  scoringMode: z.enum(["uncertain_only", "all_companies"]),
  maxRowsPerUpload: z.number().int().min(1).max(5000),
});

export async function GET() {
  try {
    return Response.json(await getEffectiveAiStatus());
  } catch (error) {
    return serverError(error);
  }
}

export async function PUT(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body.", 400);
  }

  const parsed = aiSettingsSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  try {
    const result = await updateAiRuntimeSetting(parsed.data);

    return Response.json({
      data: result.status,
    });
  } catch (error) {
    return serverError(error);
  }
}
