"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { parseCsvFile } from "@/lib/csv";
import { prisma } from "@/lib/server/prisma";
import { launchCampaign } from "@/lib/v2/outreach/campaigns/campaignRuntime";
import {
  checkBatchEmails,
  guessEmailColumn,
  guessLeadAssignmentColumn,
  summarizeBatchEmailRows,
  type BatchEmailCheckRow,
  type BatchEmailCheckSummary,
} from "@/lib/v2/outreach/suppression/batchEmailCheck";
import { requirePermission } from "@/lib/v2/tenant";

const MAX_BATCH_ROWS = 5000;

export type BatchEmailCheckState = {
  status: "idle" | "success" | "error";
  errors: string[];
  fileName: string | null;
  headers: string[];
  emailColumn: string | null;
  leadAssignmentColumn: string | null;
  checkedAt: string | null;
  summary: BatchEmailCheckSummary | null;
  rows: BatchEmailCheckRow[];
};

export type BatchCampaignSyncState = {
  status: "idle" | "success" | "error";
  message: string | null;
  errors: string[];
};

export async function checkBatchEmailsAction(
  _prev: BatchEmailCheckState,
  formData: FormData
): Promise<BatchEmailCheckState> {
  const context = await requirePermission("outreach.admin");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return errorState(["Upload a CSV file first."]);
  }
  const parsed = await parseCsvFile(file);
  if (parsed.errors.length > 0) {
    return errorState(parsed.errors, parsed.fileName);
  }
  if (parsed.rowCount > MAX_BATCH_ROWS) {
    return errorState([`Batch is limited to ${MAX_BATCH_ROWS.toLocaleString()} rows for this UI action.`], parsed.fileName);
  }
  const requestedEmailColumn = stringValue(formData.get("emailColumn"));
  const emailColumn =
    requestedEmailColumn && parsed.headers.includes(requestedEmailColumn)
      ? requestedEmailColumn
      : guessEmailColumn(parsed.headers);
  if (!emailColumn) {
    return errorState(["CSV needs an email column, or a header containing 'email'."], parsed.fileName, parsed.headers);
  }
  const leadAssignmentColumn = guessLeadAssignmentColumn(parsed.headers);
  const rows = await checkBatchEmails(prisma, {
    organizationId: context.organizationId,
    rows: parsed.rows,
    emailColumn,
    leadAssignmentColumn,
  });
  return {
    status: "success",
    errors: [],
    fileName: parsed.fileName,
    headers: parsed.headers,
    emailColumn,
    leadAssignmentColumn,
    checkedAt: new Date().toISOString(),
    summary: summarizeBatchEmailRows(rows),
    rows,
  };
}

export async function syncBatchToCampaignAction(
  _prev: BatchCampaignSyncState,
  formData: FormData
): Promise<BatchCampaignSyncState> {
  const context = await requirePermission("outreach.admin");
  const campaignId = stringValue(formData.get("campaignId"));
  if (!campaignId) {
    return { status: "error", message: null, errors: ["Choose a draft campaign."] };
  }
  const leadIds = Array.from(
    new Set(formData.getAll("leadAssignmentId").map((value) => stringValue(value)).filter((value): value is string => Boolean(value)))
  );
  if (leadIds.length === 0) {
    return {
      status: "error",
      message: null,
      errors: ["No valid rows with leadAssignmentId were available to sync."],
    };
  }
  const result = await launchCampaign(prisma, {
    organizationId: context.organizationId,
    campaignId,
    actorUserId: context.userId,
    idempotencyKey: "suppression-batch:" + randomUUID(),
    selections: leadIds.map((leadAssignmentId) => ({ leadAssignmentId })),
  });
  revalidatePath("/v2/outreach/suppression");
  revalidatePath("/v2/outreach/campaigns/" + campaignId);
  if (!result.launched) {
    return {
      status: "error",
      message: null,
      errors: result.blockers.map((blocker) => blocker.message),
    };
  }
  return {
    status: "success",
    message: result.alreadyActive
      ? "Campaign is already active; no draft launch was performed."
      : `Synced ${result.enrolled.toLocaleString()} rows; ${result.existing.toLocaleString()} were already enrolled.`,
    errors: [],
  };
}

function errorState(errors: string[], fileName: string | null = null, headers: string[] = []): BatchEmailCheckState {
  return {
    status: "error",
    errors,
    fileName,
    headers,
    emailColumn: null,
    leadAssignmentColumn: null,
    checkedAt: null,
    summary: null,
    rows: [],
  };
}

function stringValue(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}
