import { errorResponse, ok, serverError } from "@/lib/server/api/responses";
import { processDueAiJobs } from "@/lib/server/ai/companyAiJobs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const configuredSecret = process.env.AI_JOB_PROCESS_SECRET?.trim();

    if (!configuredSecret) {
      return errorResponse("AI job process secret is not configured.", 500);
    }

    const providedSecret = request.headers.get("x-ai-job-secret")?.trim();

    if (!providedSecret) {
      return errorResponse("AI job process secret is required.", 401);
    }

    if (providedSecret !== configuredSecret) {
      return errorResponse("AI job process secret is invalid.", 403);
    }

    const body = (await request.json().catch(() => ({}))) as {
      uploadJobId?: string;
    };
    const uploadJobId = body.uploadJobId?.trim() || undefined;

    return ok(await processDueAiJobs({ uploadJobId }));
  } catch (error) {
    return serverError(error);
  }
}
