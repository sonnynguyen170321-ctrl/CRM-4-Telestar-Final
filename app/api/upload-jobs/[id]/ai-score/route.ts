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

const explicitScopes: CompanyAiJobScope[] = [
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
      scope?: CompanyAiJobScope;
    };
    const scope = parseExplicitScope(body.scope);

    if (!scope) {
      return errorResponse("Invalid AI job scope.", 400);
    }

    const summary = await enqueueAiJobsForUpload(id, scope);

    return ok(summary);
  } catch (error) {
    return serverError(error);
  }
}

function parseExplicitScope(value: string | undefined) {
  // Compatibility route safety: default to uncertain_only to avoid accidental
  // provider quota burn. Broader scopes must be explicitly requested.
  if (!value) {
    return "uncertain_only";
  }

  return explicitScopes.includes(value as CompanyAiJobScope)
    ? (value as CompanyAiJobScope)
    : null;
}
