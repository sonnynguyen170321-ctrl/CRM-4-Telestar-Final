import "server-only";

import { prisma } from "@/lib/server/prisma";
import type { ComposeTemplateStatus } from "@/lib/v2/outreach/templates/templateFields";

export type ComposeTemplateSummary = {
  id: string;
  name: string;
  description: string | null;
  subjectTemplate: string;
  bodyTemplate: string;
  requiredVariables: string[];
  category: string | null;
  status: ComposeTemplateStatus;
  usageCount: number;
  lastUsedAt: string | null;
  version: number;
  updatedAt: string;
};

export type TemplatePreviewLead = {
  id: string;
  label: string;
  email: string | null;
  companyName: string;
  contactName: string | null;
};

type TemplateRow = Omit<ComposeTemplateSummary, "requiredVariables" | "lastUsedAt" | "updatedAt"> & {
  requiredVariablesJson: unknown;
  lastUsedAt: Date | string | null;
  updatedAt: Date | string;
};

export async function queryComposeTemplates(
  organizationId: string,
  filters: { status?: ComposeTemplateStatus | "ALL"; q?: string; category?: string } = {}
): Promise<ComposeTemplateSummary[]> {
  const where: string[] = ['"organizationId" = $1', '"deletedAt" IS NULL'];
  const params: unknown[] = [organizationId];
  if (filters.status && filters.status !== "ALL") {
    params.push(filters.status);
    where.push(`"status" = $${params.length}::"V2MessageTemplateStatus"`);
  }
  if (filters.q?.trim()) {
    params.push(`%${escapeLike(filters.q.trim())}%`);
    where.push(`("name" ILIKE $${params.length} OR COALESCE("description", '') ILIKE $${params.length} OR COALESCE("category", '') ILIKE $${params.length})`);
  }
  if (filters.category?.trim()) {
    params.push(filters.category.trim());
    where.push(`"category" = $${params.length}`);
  }

  const rows = await prisma.$queryRawUnsafe<TemplateRow[]>(
    `SELECT "id", "name", "description", COALESCE("subjectTemplate", '') AS "subjectTemplate",
            COALESCE("bodyTemplate", '') AS "bodyTemplate", "requiredVariablesJson", "category",
            "status"::text AS "status", "usageCount", "lastUsedAt", "version", "updatedAt"
     FROM "V2MessageTemplate"
     WHERE ${where.join(" AND ")}
     ORDER BY CASE "status" WHEN 'ACTIVE' THEN 0 WHEN 'DRAFT' THEN 1 ELSE 2 END,
              "updatedAt" DESC
     LIMIT 100`,
    ...params
  );
  return rows.map(normalizeTemplateRow);
}

export async function queryComposeTemplateDetail(
  organizationId: string,
  templateId: string | null | undefined
): Promise<ComposeTemplateSummary | null> {
  if (!templateId) return null;
  const rows = await prisma.$queryRawUnsafe<TemplateRow[]>(
    `SELECT "id", "name", "description", COALESCE("subjectTemplate", '') AS "subjectTemplate",
            COALESCE("bodyTemplate", '') AS "bodyTemplate", "requiredVariablesJson", "category",
            "status"::text AS "status", "usageCount", "lastUsedAt", "version", "updatedAt"
     FROM "V2MessageTemplate"
     WHERE "organizationId" = $1 AND "id" = $2 AND "deletedAt" IS NULL
     LIMIT 1`,
    organizationId,
    templateId
  );
  return rows[0] ? normalizeTemplateRow(rows[0]) : null;
}

export async function queryTemplatePreviewLeads(organizationId: string): Promise<TemplatePreviewLead[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    companyName: string;
    contactName: string | null;
    email: string | null;
  }>>(
    `SELECT la."id", company."name" AS "companyName", contact."fullName" AS "contactName", email."value" AS "email"
     FROM "V2LeadAssignment" la
     INNER JOIN "V2Company" company ON company."id" = la."companyId" AND company."organizationId" = la."organizationId" AND company."deletedAt" IS NULL
     LEFT JOIN "V2Contact" contact ON contact."id" = la."contactId" AND contact."organizationId" = la."organizationId" AND contact."deletedAt" IS NULL
     LEFT JOIN LATERAL (
       SELECT ci."normalizedValue" AS "value"
       FROM "V2ContactIdentifier" ci
       WHERE ci."contactId" = contact."id" AND ci."type" = 'EMAIL' AND ci."isValid" = true
       ORDER BY ci."createdAt" ASC LIMIT 1
     ) email ON true
     WHERE la."organizationId" = $1 AND la."deletedAt" IS NULL AND la."status" = 'ACTIVE'
     ORDER BY CASE WHEN email."value" IS NULL THEN 1 ELSE 0 END, la."updatedAt" DESC
     LIMIT 30`,
    organizationId
  );
  return rows.map((row) => ({
    id: row.id,
    companyName: row.companyName,
    contactName: row.contactName,
    email: row.email,
    label: `${row.contactName ?? "Company contact"} at ${row.companyName}`,
  }));
}

export async function markTemplateUsed(organizationId: string, templateId: string | null | undefined): Promise<void> {
  if (!templateId) return;
  await prisma.$executeRawUnsafe(
    `UPDATE "V2MessageTemplate"
     SET "usageCount" = "usageCount" + 1, "lastUsedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
     WHERE "organizationId" = $1 AND "id" = $2 AND "deletedAt" IS NULL`,
    organizationId,
    templateId
  );
}

function normalizeTemplateRow(row: TemplateRow): ComposeTemplateSummary {
  return {
    ...row,
    requiredVariables: toStringArray(row.requiredVariablesJson),
    usageCount: Number(row.usageCount ?? 0),
    version: Number(row.version ?? 1),
    lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt).toISOString() : null,
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
