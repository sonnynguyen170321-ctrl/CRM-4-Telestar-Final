import { errorResponse, ok, serverError } from "@/lib/server/api/responses";
import {
  getCompanyRecordDetail,
  hardDeleteCompanyRecord,
} from "@/lib/server/companyRecords/management";
import { prisma } from "@/lib/server/prisma";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const companyRecord = await getCompanyRecordDetail(id);

    if (!companyRecord) {
      return errorResponse("Company record not found.", 404);
    }

    return ok(companyRecord);
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const confirm = new URL(request.url).searchParams.get("confirm");

  if (confirm !== "DELETE") {
    return errorResponse("Hard delete requires confirm=DELETE.", 400);
  }

  try {
    const companyRecord = await prisma.companyRecord.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!companyRecord) {
      return errorResponse("Company record not found.", 404);
    }

    const result = await hardDeleteCompanyRecord(id);

    return ok(result);
  } catch (error) {
    return serverError(error);
  }
}
