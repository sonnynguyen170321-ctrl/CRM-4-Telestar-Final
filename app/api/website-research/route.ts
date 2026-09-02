import { z } from "zod";

import { ok, errorResponse, serverError } from "@/lib/server/api/responses";
import { checkWebsite } from "@/lib/server/websiteResearch/checkWebsite";

export const runtime = "nodejs";

const websiteResearchSchema = z.object({
  website: z.string().trim().min(1, "Website is required."),
});

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body.", 400);
  }

  const parsed = websiteResearchSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse(
      parsed.error.issues[0]?.message ?? "Invalid website research request.",
      400
    );
  }

  try {
    const result = await checkWebsite(parsed.data.website);
    return ok(result);
  } catch (error) {
    return serverError(error);
  }
}
