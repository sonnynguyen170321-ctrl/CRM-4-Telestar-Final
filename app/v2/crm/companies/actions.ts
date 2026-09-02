"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/v2/tenant";
import { enqueueEnrichmentExecution } from "@/lib/v2/company-intelligence/runtime/enqueueEnrichment";
import { enqueueCompanyEnrichmentJob } from "@/lib/v2/company-intelligence";
import { nextForcedResearchVersion } from "@/lib/v2/company-intelligence/pipelineVersion";
import { createRuntimeRun } from "@/lib/v2/runtime/runtimeStore";
import { drainIfNoWorker } from "@/lib/v2/jobs/drainIfNoWorker";
import { invalidateOrgFacets } from "@/lib/v2/bullmq/facetCache";
import type { V2JobDatabase } from "@/lib/v2/jobs/types";

// On-demand company intelligence is descriptive only. It refreshes research/profile data
// and must not create or score LeadAssignments from the Companies workspace.
export async function extractCompanyIntelligenceAction(formData: FormData) {
  let context;
  try {
    context = await requirePermission("score.enqueue");
  } catch {
    return;
  }
  const companyId = (formData.get("companyId")?.toString() ?? "").trim();
  if (!companyId) return;

  const maxRows = await prisma.$queryRawUnsafe<Array<{ max: number | null }>>(
    `SELECT MAX("researchVersion")::int AS "max" FROM "V2CompanyIntelligenceProfile"
      WHERE "organizationId" = $1 AND "companyId" = $2`,
    context.organizationId,
    companyId
  );
  const researchVersion = nextForcedResearchVersion(maxRows[0]?.max ?? null);

  const db = prisma as unknown as V2JobDatabase;
  const dispatch = await enqueueEnrichmentExecution(db, {
    organizationId: context.organizationId,
    companyId,
    researchVersion,
    createdByUserId: context.userId,
  });

  if (dispatch.mode === "db") {
    await drainIfNoWorker(db, { organizationId: context.organizationId, jobType: "COMPANY_ENRICHMENT", max: 3 });
  } else {
    await waitForProfileVersion(context.organizationId, companyId, researchVersion, 45_000);
  }

  // Deep D2: the company's intelligence profile changed → invalidate cached company aggregates/filters
  // so the refreshed page recomputes fresh rather than serving stale TTL data.
  await invalidateOrgFacets(context.organizationId);
  revalidatePath("/v2/crm/companies");
}

// Bulk on-demand enrichment: enqueue a fresh research version for every selected company.
// This is an intelligence refresh only; Add to Leads is the explicit pipeline boundary.
export type BulkExtractState = { ok: boolean; count: number; ts: number; runId: string | null };

export async function extractCompanyIntelligenceBulkAction(
  _prev: BulkExtractState | null,
  formData: FormData
): Promise<BulkExtractState> {
  let context;
  try {
    context = await requirePermission("score.enqueue");
  } catch {
    return { ok: false, count: 0, ts: Date.now(), runId: null };
  }
  const raw = (formData.get("companyIds")?.toString() ?? "").trim();
  const companyIds = Array.from(new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))).slice(0, 200);
  if (companyIds.length === 0) return { ok: false, count: 0, ts: Date.now(), runId: null };

  const db = prisma as unknown as V2JobDatabase;
  const maxRows = await prisma.$queryRawUnsafe<Array<{ companyId: string; max: number | null }>>(
    `SELECT "companyId", MAX("researchVersion")::int AS "max" FROM "V2CompanyIntelligenceProfile"
      WHERE "organizationId" = $1 AND "companyId" = ANY($2::text[]) GROUP BY "companyId"`,
    context.organizationId,
    companyIds
  );
  const maxByCompany = new Map(maxRows.map((r) => [r.companyId, r.max]));

  // Always create a runtime run + route through the drainable COMPANY_ENRICHMENT V2Job scoped to
  // the run (sourceId = runId). This makes the bulk enrichment self-drivable from the page (the
  // process route drains + reconciles the run counter) AND worker-drainable — no worker required
  // for the bar to advance 1→N, matching the research runtime.
  const runId = await createRuntimeRun({
    organizationId: context.organizationId,
    runType: "ENRICHMENT",
    totalUnits: companyIds.length,
    createdByUserId: context.userId,
    configJson: { companyIds, source: "companies.intelligence" },
  });

  for (const companyId of companyIds) {
    const researchVersion = nextForcedResearchVersion(maxByCompany.get(companyId) ?? null);
    await enqueueCompanyEnrichmentJob(db, {
      organizationId: context.organizationId,
      companyId,
      researchVersion,
      createdByUserId: context.userId,
      source: { sourceType: "MANUAL", sourceId: runId },
    });
  }

  // Drain the first unit inline so results appear immediately; the self-driving bar drains the rest.
  try {
    await drainIfNoWorker(db, { organizationId: context.organizationId, jobType: "COMPANY_ENRICHMENT", sourceType: "MANUAL", sourceId: runId, max: 1 });
  } catch { /* the bar's process loop takes over */ }

  revalidatePath("/v2/crm/companies");
  return { ok: true, count: companyIds.length, ts: Date.now(), runId };
}

export type AddCompaniesToLeadsState = {
  ok: boolean;
  count: number;
  created: number;
  existing: number;
  ts: number;
  message: string | null;
};

type TargetIcpRow = { icpVersionId: string; projectId: string };
type CompanyIdRow = { id: string };
type LeadAssignmentIdRow = { id: string };

export async function addCompaniesToLeadsAction(
  _prev: AddCompaniesToLeadsState | null,
  formData: FormData
): Promise<AddCompaniesToLeadsState> {
  let context;
  try {
    context = await requirePermission("score.enqueue");
  } catch {
    return emptyAddState("You cannot add companies to leads.");
  }

  const companyIds = splitCsv(formData.get("companyIds")?.toString()).slice(0, 200);
  const targetIcpVersionId = (formData.get("targetIcpVersionId")?.toString() ?? "").trim();
  if (companyIds.length === 0) return emptyAddState("Select at least one company.");
  if (!targetIcpVersionId) return emptyAddState("Pick one published ICP.");

  const targetRows = await prisma.$queryRawUnsafe<TargetIcpRow[]>(
    `SELECT icp."id" AS "icpVersionId", project."id" AS "projectId"
      FROM "V2ICPVersion" icp
      INNER JOIN "V2ICPProfile" profile
        ON profile."id" = icp."icpProfileId"
        AND profile."organizationId" = icp."organizationId"
        AND profile."status" = 'ACTIVE'
      INNER JOIN "V2Offer" offer
        ON offer."id" = profile."offerId"
        AND offer."organizationId" = icp."organizationId"
        AND offer."status" = 'ACTIVE'
      INNER JOIN "V2Project" project
        ON project."id" = offer."projectId"
        AND project."organizationId" = icp."organizationId"
        AND project."status" = 'ACTIVE'
      WHERE icp."organizationId" = $1
        AND icp."id" = $2
        AND icp."status" = 'PUBLISHED'
      LIMIT 1`,
    context.organizationId,
    targetIcpVersionId
  );
  const target = targetRows[0];
  if (!target) return emptyAddState("Selected ICP is not published or no longer available.");

  const companies = await prisma.$queryRawUnsafe<CompanyIdRow[]>(
    `SELECT "id"
      FROM "V2Company"
      WHERE "organizationId" = $1
        AND "id" = ANY($2::text[])
        AND "status" = 'ACTIVE'
        AND "deletedAt" IS NULL`,
    context.organizationId,
    companyIds
  );

  let created = 0;
  let existing = 0;
  for (const company of companies) {
    const ensured = await ensureExplicitCompanyLeadAssignment({
      organizationId: context.organizationId,
      companyId: company.id,
      projectId: target.projectId,
      icpVersionId: target.icpVersionId,
    });
    if (ensured.action === "created") created += 1;
    else existing += 1;
  }

  // Deep D2: leads were just created synchronously → the cached company aggregates ("in leads"
  // counts), lead facets, and filter/context options are now stale. Invalidate the org's read-model
  // keys so the revalidatePath re-render below recomputes fresh instead of serving up to 5 min of TTL.
  if (created > 0) await invalidateOrgFacets(context.organizationId);

  revalidatePath("/v2/crm/companies");
  revalidatePath("/v2/workspace/leads");
  return {
    ok: companies.length > 0,
    count: companies.length,
    created,
    existing,
    ts: Date.now(),
    message: companies.length > 0 ? null : "No active companies matched this selection.",
  };
}

async function waitForProfileVersion(
  organizationId: string,
  companyId: string,
  researchVersion: number,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT "id" FROM "V2CompanyIntelligenceProfile"
        WHERE "organizationId"=$1 AND "companyId"=$2 AND "researchVersion"=$3 LIMIT 1`,
      organizationId,
      companyId,
      researchVersion
    );
    if (rows[0]) return;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

function splitCsv(value: string | undefined): string[] {
  return Array.from(
    new Set((value ?? "").split(",").map((s) => s.trim()).filter(Boolean))
  ).slice(0, 500);
}

function emptyAddState(message: string): AddCompaniesToLeadsState {
  return { ok: false, count: 0, created: 0, existing: 0, ts: Date.now(), message };
}

async function ensureExplicitCompanyLeadAssignment(input: {
  organizationId: string;
  projectId: string;
  icpVersionId: string;
  companyId: string;
}): Promise<{ id: string; action: "created" | "existing" }> {
  const existing = await selectActiveCompanyLeadAssignment(input);
  if (existing) return { id: existing, action: "existing" };

  const created = await prisma.$queryRawUnsafe<LeadAssignmentIdRow[]>(
    `INSERT INTO "V2LeadAssignment"
       ("id", "organizationId", "projectId", "icpVersionId", "companyId", "contactId",
        "assignmentLevel", "workflowStatus", "status", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, NULL, 'COMPANY'::"V2LeadAssignmentLevel", 'NEW', 'ACTIVE',
             CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     RETURNING "id"`,
    `lead_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    input.organizationId,
    input.projectId,
    input.icpVersionId,
    input.companyId
  );

  return { id: created[0].id, action: "created" };
}

async function selectActiveCompanyLeadAssignment(input: {
  organizationId: string;
  projectId: string;
  icpVersionId: string;
  companyId: string;
}): Promise<string | null> {
  const rows = await prisma.$queryRawUnsafe<LeadAssignmentIdRow[]>(
    `SELECT "id"
      FROM "V2LeadAssignment"
      WHERE "organizationId" = $1
        AND "projectId" = $2
        AND "icpVersionId" = $3
        AND "companyId" = $4
        AND "contactId" IS NULL
        AND "assignmentLevel" = 'COMPANY'
        AND "status" = 'ACTIVE'
        AND "deletedAt" IS NULL
      LIMIT 1`,
    input.organizationId,
    input.projectId,
    input.icpVersionId,
    input.companyId
  );
  return rows[0]?.id ?? null;
}
