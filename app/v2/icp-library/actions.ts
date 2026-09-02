"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/v2/tenant/requireTenantContext";
import { prisma } from "@/lib/server/prisma";
import { enqueueIcpScoreJob } from "@/lib/v2/scoring/runtime/enqueueScoringJobs";
import {
  cloneIcpVersionAsDraft,
  cloneIcpVersionAsRulesV2Draft,
  publishIcpDraft,
  saveIcpDraftRules,
  deleteIcpDraft,
} from "@/lib/v2/icp/authoring";
import { createEmptyIcpProfile } from "@/lib/v2/product-tree/createProductTree";

// Surfaces whose Account/Project/ICP context dropdown is built from the published-ICP
// tree (getLeadContextOptions). Publishing / deleting / archiving an ICP changes that
// set, so these must be revalidated too — not just the ICP library page.
function revalidateIcpContextSurfaces() {
  revalidatePath("/v2/ingestion/uploads");
  revalidatePath("/v2/workspace/leads");
  revalidatePath("/v2/crm/companies");
}

export async function cloneIcpVersionAsDraftAction(formData: FormData) {
  const context = await requirePermission("product_tree.write");
  const sourceVersionId = formData.get("sourceVersionId")?.toString().trim();

  if (!sourceVersionId) return { error: "Source ICP version is required." };

  try {
    const result = await cloneIcpVersionAsDraft({
      organizationId: context.organizationId,
      sourceVersionId,
    });

    revalidatePath("/v2/icp-library");
    return { success: true, versionId: result.draftVersionId };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to clone ICP draft." };
  }
}

export async function upgradeIcpToRulesV2Action(formData: FormData) {
  const context = await requirePermission("product_tree.write");
  const sourceVersionId = formData.get("sourceVersionId")?.toString().trim();

  if (!sourceVersionId) return { error: "Source ICP version is required." };

  try {
    const result = await cloneIcpVersionAsRulesV2Draft({
      organizationId: context.organizationId,
      sourceVersionId,
    });

    revalidatePath("/v2/icp-library");
    return {
      success: true,
      versionId: result.draftVersionId,
      alreadyV2: result.alreadyV2,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Failed to upgrade ICP to rules-v2.",
    };
  }
}

export async function saveIcpDraftRulesAction(formData: FormData) {
  const context = await requirePermission("product_tree.write");
  const draftVersionId = formData.get("draftVersionId")?.toString().trim();
  const expectedVersionRaw = formData.get("expectedVersion")?.toString().trim();
  const rulesJsonRaw = formData.get("rulesJson")?.toString() ?? "";

  if (!draftVersionId) return { error: "Draft ICP version is required." };
  const expectedVersion = Number(expectedVersionRaw);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return { error: "Draft optimistic version is invalid." };
  }

  let rulesJson: unknown;
  try {
    rulesJson = JSON.parse(rulesJsonRaw);
  } catch {
    return { error: "Rules JSON is invalid." };
  }

  try {
    const result = await saveIcpDraftRules({
      organizationId: context.organizationId,
      draftVersionId,
      expectedVersion,
      rulesJson,
    });

    const version = await prisma.v2ICPVersion.findFirst({
      where: { id: draftVersionId, organizationId: context.organizationId, deletedAt: null },
      include: {
        icpProfile: {
          include: {
            offer: true
          }
        }
      }
    });

    if (version && version.status === "PUBLISHED" && version.icpProfile?.offer?.projectId) {
      await enqueueIcpScoreJob(prisma as unknown as Parameters<typeof enqueueIcpScoreJob>[0], {
        organizationId: context.organizationId,
        selection: {
          kind: "project_icp",
          projectId: version.icpProfile.offer.projectId,
          icpVersionId: version.id,
        },
        createdByUserId: context.userId,
        source: { sourceType: "MANUAL", sourceId: version.id },
      });
    }

    revalidatePath("/v2/icp-library");
    return { success: true, versionId: result.draftVersionId, optimisticVersion: result.optimisticVersion };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to save ICP draft." };
  }
}

export async function publishIcpDraftAction(formData: FormData) {
  const context = await requirePermission("product_tree.write");
  const draftVersionId = formData.get("draftVersionId")?.toString().trim();
  const expectedVersionRaw = formData.get("expectedVersion")?.toString().trim();

  if (!draftVersionId) return { error: "Draft ICP version is required." };
  const expectedVersion = Number(expectedVersionRaw);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return { error: "Draft optimistic version is invalid." };
  }

  try {
    const result = await publishIcpDraft({
      organizationId: context.organizationId,
      userId: context.userId,
      draftVersionId,
      expectedVersion,
    });

    revalidatePath("/v2/icp-library");
    revalidateIcpContextSurfaces();
    return { success: true, versionId: result.publishedVersionId, optimisticVersion: result.optimisticVersion };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to publish ICP draft." };
  }
}

export async function createEmptyIcpAction(formData: FormData) {
  const context = await requirePermission("product_tree.write");

  const offerId = formData.get("offerId")?.toString().trim();
  const name = formData.get("name")?.toString().trim();
  const description = formData.get("description")?.toString().trim();
  const templateId = formData.get("templateId")?.toString().trim() || undefined;

  if (!offerId) return { error: "Offer ID is required." };
  if (!name) return { error: "ICP name is required." };

  try {
    const { profile, version } = await createEmptyIcpProfile({
      organizationId: context.organizationId,
      userId: context.userId,
      offerId,
      name,
      description,
      templateId,
    });

    revalidatePath("/v2/icp-library");
    revalidatePath("/v2/offers/");
    return { success: true, profileId: profile.id, versionId: version.id };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to create ICP" };
  }
}

export async function deleteIcpDraftAction(formData: FormData) {
  const context = await requirePermission("product_tree.write");
  const draftVersionId = formData.get("draftVersionId")?.toString().trim();

  if (!draftVersionId) return { error: "Draft ICP version is required." };

  try {
    await deleteIcpDraft({
      organizationId: context.organizationId,
      draftVersionId,
    });

    revalidatePath("/v2/icp-library");
    revalidateIcpContextSurfaces();
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to delete ICP draft." };
  }
}

export async function archiveIcpProfileAction(formData: FormData) {
  const context = await requirePermission("product_tree.write");
  const icpProfileId = formData.get("icpProfileId")?.toString().trim();

  if (!icpProfileId) return { error: "ICP Profile ID is required." };

  try {
    const { prisma } = await import("@/lib/server/prisma");
    const updated = await prisma.$executeRawUnsafe(
      `
        UPDATE "V2ICPProfile"
        SET "status" = 'ARCHIVED',
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = $1
          AND "organizationId" = $2
          AND "status" = 'ACTIVE'
      `,
      icpProfileId,
      context.organizationId
    );

    if (updated !== 1) throw new Error("Could not delete ICP.");

    revalidatePath("/v2/icp-library");
    revalidateIcpContextSurfaces();
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to delete ICP." };
  }
}

