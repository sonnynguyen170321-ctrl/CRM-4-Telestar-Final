import { assignDeterministicVariant } from "./variantAssignment";
import { renderCampaignTemplate } from "./rendering";
import type { V2EnrollmentRenderSnapshotV1 } from "./types";

export type CampaignMessageVariant = {
  id: string;
  weight: number;
  subjectTemplate: string | null;
  bodyTemplate: string | null;
  requiredVariables: string[];
};

export async function prepareCampaignStepMessage(input: {
  organizationId: string;
  campaignId: string;
  enrollmentId: string;
  stepId: string;
  snapshot: V2EnrollmentRenderSnapshotV1;
  variants: readonly CampaignMessageVariant[];
  fallbackSubjectTemplate?: string | null;
  fallbackBodyTemplate?: string | null;
  previousSubject?: string | null;
}): Promise<{ variantId: string | null; subject: string; body: string }> {
  const selected =
    input.variants.length > 0
      ? assignDeterministicVariant({
          organizationId: input.organizationId,
          campaignId: input.campaignId,
          enrollmentId: input.enrollmentId,
          stepId: input.stepId,
          variants: input.variants,
        })
      : null;
  const variant = selected
    ? input.variants.find((item) => item.id === selected.id) ?? null
    : null;
  const context = {
    ...input.snapshot.mergeData.custom,
    ...input.snapshot.mergeData.predefined,
    custom: input.snapshot.mergeData.custom,
  };
  const seed = [
    input.organizationId,
    input.campaignId,
    input.enrollmentId,
    input.stepId,
    variant?.id ?? "legacy",
  ].join(":");
  const subjectTemplate =
    variant?.subjectTemplate ?? input.fallbackSubjectTemplate ?? "";
  const bodyTemplate =
    variant?.bodyTemplate ?? input.fallbackBodyTemplate ?? "";
  const renderedSubject = await renderCampaignTemplate({
    template: subjectTemplate,
    context,
    requiredVariables: variant?.requiredVariables ?? [],
    seed: seed + ":subject",
  });
  const body = await renderCampaignTemplate({
    template: bodyTemplate,
    context,
    requiredVariables: variant?.requiredVariables ?? [],
    seed: seed + ":body",
  });
  return {
    variantId: variant?.id ?? null,
    subject: renderedSubject.trim() || input.previousSubject?.trim() || "",
    body,
  };
}

export function parseEnrollmentSnapshot(
  value: unknown,
  fallback: { recipientEmail: string; timezone: string; context: Record<string, unknown> }
): V2EnrollmentRenderSnapshotV1 {
  if (value && typeof value === "object") {
    const snapshot = value as Partial<V2EnrollmentRenderSnapshotV1>;
    if (
      snapshot.schemaVersion === "v2.enrollment-snapshot.v1" &&
      typeof snapshot.recipientEmail === "string" &&
      typeof snapshot.timezone === "string" &&
      snapshot.mergeData &&
      typeof snapshot.mergeData === "object"
    ) {
      return snapshot as V2EnrollmentRenderSnapshotV1;
    }
  }
  return {
    schemaVersion: "v2.enrollment-snapshot.v1",
    recipientEmail: fallback.recipientEmail,
    timezone: fallback.timezone,
    mergeData: {
      schemaVersion: "v2.outreach-profile.v1",
      predefined: Object.fromEntries(
        Object.entries(fallback.context).map(([key, item]) => [
          key,
          typeof item === "string" ? item : item == null ? null : String(item),
        ])
      ),
      custom: {},
    },
  };
}