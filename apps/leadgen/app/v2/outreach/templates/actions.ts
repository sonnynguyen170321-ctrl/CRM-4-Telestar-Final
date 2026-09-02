"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/server/prisma";
import { markTemplateUsed } from "@/lib/v2/outreach/templates/queryComposeTemplates";
import { normalizeTemplateStatus, parseRequiredVariables } from "@/lib/v2/outreach/templates/templateFields";
import { requirePermission } from "@/lib/v2/tenant";

export async function createTemplateAction(formData: FormData) {
  const context = await requirePermission("outreach.admin");
  const id = randomUUID();
  const values = readTemplateForm(formData);
  const name = values.name || fallbackName(values.subjectTemplate, "Untitled template");

  await prisma.$executeRawUnsafe(
    `INSERT INTO "V2MessageTemplate"
       ("id", "organizationId", "name", "description", "subjectTemplate", "bodyTemplate", "requiredVariablesJson", "category", "status", "createdByUserId", "updatedByUserId")
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::"V2MessageTemplateStatus", $10, $10)`,
    id,
    context.organizationId,
    name,
    values.description || null,
    values.subjectTemplate,
    values.bodyTemplate,
    JSON.stringify(values.requiredVariables),
    values.category || null,
    values.status,
    context.userId
  );
  revalidatePath("/v2/outreach/templates");
  redirect(`/v2/outreach/templates?templateId=${id}&notice=created`);
}

export async function saveTemplateAction(formData: FormData) {
  const context = await requirePermission("outreach.admin");
  const id = get(formData, "templateId");
  const version = Number(get(formData, "version") || "0");
  if (!id || !Number.isFinite(version) || version < 1) redirect("/v2/outreach/templates?notice=invalid");

  const values = readTemplateForm(formData);
  const changed = await prisma.$executeRawUnsafe(
    `UPDATE "V2MessageTemplate"
     SET "name" = $3, "description" = $4, "subjectTemplate" = $5, "bodyTemplate" = $6,
         "requiredVariablesJson" = $7::jsonb, "category" = $8, "status" = $9::"V2MessageTemplateStatus",
         "updatedByUserId" = $10, "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
     WHERE "organizationId" = $1 AND "id" = $2 AND "deletedAt" IS NULL AND "version" = $11`,
    context.organizationId,
    id,
    values.name || fallbackName(values.subjectTemplate, "Untitled template"),
    values.description || null,
    values.subjectTemplate,
    values.bodyTemplate,
    JSON.stringify(values.requiredVariables),
    values.category || null,
    values.status,
    context.userId,
    version
  );
  revalidatePath("/v2/outreach/templates");
  redirect(`/v2/outreach/templates?templateId=${id}&notice=${changed ? "saved" : "conflict"}`);
}

export async function restoreTemplateAction(formData: FormData) {
  const context = await requirePermission("outreach.admin");
  const id = get(formData, "templateId");
  if (!id) redirect("/v2/outreach/templates?notice=invalid");
  await prisma.$executeRawUnsafe(
    `UPDATE "V2MessageTemplate"
     SET "status" = 'ACTIVE'::"V2MessageTemplateStatus", "updatedByUserId" = $3,
         "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
     WHERE "organizationId" = $1 AND "id" = $2 AND "deletedAt" IS NULL AND "status" = 'ARCHIVED'`,
    context.organizationId,
    id,
    context.userId
  );
  revalidatePath("/v2/outreach/templates");
  redirect(`/v2/outreach/templates?templateId=${id}&notice=restored`);
}

export async function archiveTemplateAction(formData: FormData) {
  const context = await requirePermission("outreach.admin");
  const id = get(formData, "templateId");
  if (!id) redirect("/v2/outreach/templates?notice=invalid");
  await prisma.$executeRawUnsafe(
    `UPDATE "V2MessageTemplate"
     SET "status" = 'ARCHIVED'::"V2MessageTemplateStatus", "updatedByUserId" = $3,
         "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
     WHERE "organizationId" = $1 AND "id" = $2 AND "deletedAt" IS NULL`,
    context.organizationId,
    id,
    context.userId
  );
  revalidatePath("/v2/outreach/templates");
  redirect("/v2/outreach/templates?status=ARCHIVED&notice=archived");
}

export async function duplicateTemplateAction(formData: FormData) {
  const context = await requirePermission("outreach.admin");
  const id = get(formData, "templateId");
  if (!id) redirect("/v2/outreach/templates?notice=invalid");
  const newId = randomUUID();
  const changed = await prisma.$executeRawUnsafe(
    `INSERT INTO "V2MessageTemplate"
       ("id", "organizationId", "name", "description", "subjectTemplate", "bodyTemplate", "requiredVariablesJson", "category", "status", "createdByUserId", "updatedByUserId")
     SELECT $3, "organizationId", CONCAT("name", ' copy'), "description", "subjectTemplate", "bodyTemplate", "requiredVariablesJson", "category", 'DRAFT'::"V2MessageTemplateStatus", $4, $4
     FROM "V2MessageTemplate"
     WHERE "organizationId" = $1 AND "id" = $2 AND "deletedAt" IS NULL`,
    context.organizationId,
    id,
    newId,
    context.userId
  );
  revalidatePath("/v2/outreach/templates");
  redirect(changed ? `/v2/outreach/templates?templateId=${newId}&notice=duplicated` : "/v2/outreach/templates?notice=invalid");
}

export async function markTemplateUsedAction(formData: FormData) {
  const context = await requirePermission("workflow.update");
  await markTemplateUsed(context.organizationId, get(formData, "templateId"));
}

export async function saveComposeDraftAsTemplateAction(formData: FormData) {
  const context = await requirePermission("outreach.admin");
  const id = randomUUID();
  const subject = get(formData, "subject");
  const body = get(formData, "body");
  const companyName = get(formData, "companyName");
  const name = fallbackName(subject, companyName ? `${companyName} compose draft` : "Compose draft");

  await prisma.$executeRawUnsafe(
    `INSERT INTO "V2MessageTemplate"
       ("id", "organizationId", "name", "description", "subjectTemplate", "bodyTemplate", "requiredVariablesJson", "category", "status", "createdByUserId", "updatedByUserId")
     VALUES ($1, $2, $3, $4, $5, $6, '[]'::jsonb, 'Manual compose', 'DRAFT'::"V2MessageTemplateStatus", $7, $7)`,
    id,
    context.organizationId,
    name,
    "Saved from Smart Compose. Review required variables before activation.",
    subject,
    body,
    context.userId
  );
  revalidatePath("/v2/outreach/templates");
  redirect(`/v2/outreach/templates?templateId=${id}&notice=created`);
}

function readTemplateForm(formData: FormData) {
  return {
    name: get(formData, "name"),
    description: get(formData, "description"),
    subjectTemplate: get(formData, "subjectTemplate"),
    bodyTemplate: get(formData, "bodyTemplate"),
    requiredVariables: parseRequiredVariables(formData.get("requiredVariables")),
    category: get(formData, "category"),
    status: normalizeTemplateStatus(formData.get("status")),
  };
}

function get(formData: FormData, key: string): string {
  return (formData.get(key)?.toString() ?? "").trim();
}

function fallbackName(subject: string, fallback: string): string {
  const compact = subject.replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, 80) : fallback;
}
