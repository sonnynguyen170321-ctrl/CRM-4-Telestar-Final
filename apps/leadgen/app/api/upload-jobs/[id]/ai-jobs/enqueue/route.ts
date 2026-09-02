import { errorResponse, ok, serverError } from "@/lib/server/api/responses";
import {
  enqueueAiJobsForUpload,
  type CompanyAiJobScope,
} from "@/lib/server/ai/companyAiJobs";
import { prisma } from "@/lib/server/prisma";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const scopes: CompanyAiJobScope[] = [
  "uncertain_only",
  "qualified_and_uncertain",
  "all_active",
];

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const uploadJob = await prisma.uploadJob.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!uploadJob) {
      return errorResponse("Upload job not found.", 404);
    }

    const body = (await request.json().catch(() => ({}))) as {
      scope?: string;
      retryFailed?: boolean;
      retryScheduledNow?: boolean;
      maxRows?: number;
    };
    const scope = parseScope(body.scope);

    if (!scope) {
      return errorResponse("Invalid AI job scope.", 400);
    }

    return ok(
      await enqueueAiJobsForUpload(id, scope, {
        retryFailed: body.retryFailed === true,
        retryScheduledNow: body.retryScheduledNow === true,
        maxRows:
          typeof body.maxRows === "number" && Number.isInteger(body.maxRows)
            ? body.maxRows
            : undefined,
      })
    );
  } catch (error) {
    return serverError(error);
  }
}

function parseScope(value: string | undefined) {
  return scopes.includes(value as CompanyAiJobScope)
    ? (value as CompanyAiJobScope)
    : null;
}
