"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/v2/tenant/requireTenantContext";
import { decideCancel, decideRetry } from "@/lib/v2/jobs/ops/jobOps";

type JobRow = { id: string; status: string };

async function loadJob(organizationId: string, jobId: string): Promise<JobRow | null> {
  const { prisma } = await import("@/lib/server/prisma");
  const rows = await prisma.$queryRawUnsafe<JobRow[]>(
    `SELECT "id", "status"::text AS "status" FROM "V2Job" WHERE "id" = $1 AND "organizationId" = $2`,
    jobId,
    organizationId
  );
  return rows[0] ?? null;
}

export async function retryJobAction(jobId: string) {
  const context = await requirePermission("product_tree.write");
  if (!jobId) return { error: "Job id is required." };
  const job = await loadJob(context.organizationId, jobId);
  if (!job) return { error: "Job not found." };

  const decision = decideRetry(job);
  if (!decision.ok) return { error: decision.reason };

  const { prisma } = await import("@/lib/server/prisma");
  await prisma.$executeRawUnsafe(
    `UPDATE "V2Job"
     SET "status" = 'QUEUED', "errorCode" = NULL, "errorMessage" = NULL, "nextAttemptAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "organizationId" = $2 AND "status" IN ('FAILED','RETRY_SCHEDULED','CANCELLED')`,
    jobId,
    context.organizationId
  );
  revalidatePath("/v2/ingestion/jobs");
  return { success: true };
}

export async function cancelJobAction(jobId: string) {
  const context = await requirePermission("product_tree.write");
  if (!jobId) return { error: "Job id is required." };
  const job = await loadJob(context.organizationId, jobId);
  if (!job) return { error: "Job not found." };

  const decision = decideCancel(job);
  if (!decision.ok) return { error: decision.reason };

  const { prisma } = await import("@/lib/server/prisma");
  await prisma.$executeRawUnsafe(
    `UPDATE "V2Job"
     SET "status" = 'CANCELLED', "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "organizationId" = $2 AND "status" IN ('QUEUED','RETRY_SCHEDULED')`,
    jobId,
    context.organizationId
  );
  revalidatePath("/v2/ingestion/jobs");
  return { success: true };
}
