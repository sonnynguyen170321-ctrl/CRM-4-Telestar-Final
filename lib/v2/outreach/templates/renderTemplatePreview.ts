import "server-only";

import { prisma } from "@/lib/server/prisma";
import { buildSampleRenderContext } from "@/lib/v2/outreach/campaigns/mergeVariables";
import { CampaignRenderError, renderCampaignTemplate } from "@/lib/v2/outreach/campaigns/rendering";
import { normalizeEmailIdentifier } from "@/lib/v2/outreach/suppression/normalizeIdentifier";

type PreviewContext = Record<string, unknown>;

export type TemplatePreviewResult = {
  subject: { text: string; error: string | null };
  body: { text: string; error: string | null };
  source: "lead" | "sample";
};

export async function renderTemplatePreview(input: {
  organizationId: string;
  subjectTemplate: string;
  bodyTemplate: string;
  requiredVariables?: readonly string[];
  leadAssignmentId?: string | null;
}): Promise<TemplatePreviewResult | null> {
  const leadAssignmentId = input.leadAssignmentId?.trim();
  const context = leadAssignmentId
    ? await buildLeadRenderContext(input.organizationId, leadAssignmentId)
    : buildSampleRenderContext();
  if (!context) return null;

  const seed = `template-preview:${leadAssignmentId || "sample"}`;
  const [subject, body] = await Promise.all([
    renderField(input.subjectTemplate, context, input.requiredVariables ?? [], `${seed}:subject`),
    renderField(input.bodyTemplate, context, input.requiredVariables ?? [], `${seed}:body`),
  ]);
  return { subject, body, source: leadAssignmentId ? "lead" : "sample" };
}

async function renderField(
  template: string,
  context: PreviewContext,
  requiredVariables: readonly string[],
  seed: string
): Promise<{ text: string; error: string | null }> {
  if (!template.trim()) return { text: "", error: null };
  try {
    const text = await renderCampaignTemplate({ template, context, requiredVariables, seed });
    return { text, error: null };
  } catch (error) {
    if (error instanceof CampaignRenderError) return { text: "", error: error.message };
    return { text: "", error: error instanceof Error ? error.message : "Render failed." };
  }
}

export async function buildLeadRenderContext(
  organizationId: string,
  leadAssignmentId: string
): Promise<PreviewContext | null> {
  const assignment = await prisma.v2LeadAssignment.findFirst({
    where: {
      id: leadAssignmentId,
      organizationId,
      status: "ACTIVE",
      deletedAt: null,
      company: { status: "ACTIVE", deletedAt: null },
    },
    include: {
      contact: {
        include: {
          identifiers: {
            where: { type: "EMAIL", isValid: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
      company: true,
      project: true,
      icpVersion: { include: { icpProfile: true } },
    },
  });
  if (!assignment) return null;

  const profile = await prisma.v2LeadOutreachProfile.findFirst({
    where: { organizationId, leadAssignmentId, deletedAt: null },
  });
  const contact = assignment.contact;
  const stored = asMergeData(profile?.mergeDataJson);
  const email = normalizeEmailIdentifier(profile?.primaryEmailNormalized ?? contact?.identifiers[0]?.normalizedValue);
  const predefined = {
    email,
    first_name: contact?.firstName ?? "",
    last_name: contact?.lastName ?? "",
    name: contact?.fullName ?? "",
    contact: contact?.fullName ?? "",
    title: contact?.title ?? "",
    company: assignment.company.name,
    website: assignment.company.websiteUrl,
    domain: assignment.company.canonicalDomain,
    country: assignment.company.country,
    project: assignment.project.name,
    icp: assignment.icpVersion.icpProfile.name,
    ...stored.predefined,
  };
  return { ...stored.custom, ...predefined, custom: stored.custom };
}

function asMergeData(value: unknown): {
  predefined: Record<string, string | null>;
  custom: Record<string, string | number | boolean | null>;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { predefined: {}, custom: {} };
  }
  const record = value as Record<string, unknown>;
  return {
    predefined:
      record.predefined && typeof record.predefined === "object" && !Array.isArray(record.predefined)
        ? (record.predefined as Record<string, string | null>)
        : {},
    custom:
      record.custom && typeof record.custom === "object" && !Array.isArray(record.custom)
        ? (record.custom as Record<string, string | number | boolean | null>)
        : {},
  };
}
