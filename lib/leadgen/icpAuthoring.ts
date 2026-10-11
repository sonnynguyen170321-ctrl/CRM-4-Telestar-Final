import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import { getIcpTemplateV2 } from "@telestar/core-scoring/rules/icpTemplatesV2";
import { emptyIcpRulesV2 } from "@telestar/core-scoring/rules/emptyIcpRulesV2";
import { validateIcpVersionRulesV2 } from "@telestar/core-scoring/rules/schema-v2";

import type { IcpVersionRulesV2 } from "@telestar/core-scoring/rules/schema-v2";

import {
  managerSimplificationNotes,
  normalizeManagerRules,
} from "@/lib/leadgen/icpManagerRules";
export {
  managerSimplificationNotes,
  normalizeManagerRules,
} from "@/lib/leadgen/icpManagerRules";
import { prisma } from "@/lib/prisma";

export class IcpAuthoringError extends Error {
  constructor(
    public readonly code:
      | "not_found"
      | "draft_conflict"
      | "published_immutable"
      | "simplification_required"
      | "invalid_rules"
      | "review_pending"
      | "not_pending",
    message: string,
  ) {
    super(message);
    this.name = "IcpAuthoringError";
  }
}

export function validateManagerRules(rulesJson: unknown, requireConstraint = false) {
  let rules: ReturnType<typeof validateIcpVersionRulesV2>;
  try {
    rules = validateIcpVersionRulesV2(rulesJson);
  } catch {
    throw new IcpAuthoringError("invalid_rules", "ICP rules are invalid");
  }

  const size = rules.size;
  if (
    size.minEmployees != null &&
    size.maxEmployees != null &&
    size.minEmployees > size.maxEmployees
  ) {
    throw new IcpAuthoringError(
      "invalid_rules",
      "Minimum employees cannot be greater than maximum employees",
    );
  }

  const hasCompanyConstraint =
    rules.geography.targetCountries.length > 0 ||
    rules.geography.excludedCountries.length > 0 ||
    rules.industry.targetIndustries.length > 0 ||
    rules.industry.subIndustries.length > 0 ||
    rules.industry.excludedIndustries.length > 0 ||
    size.minEmployees != null ||
    size.maxEmployees != null ||
    size.sizeBands.length > 0 ||
    rules.companyType.allow.length > 0 ||
    rules.companyType.deny.length > 0;
  const hasPersonaConstraint =
    rules.persona.titleAllowlist.length > 0 ||
    rules.persona.titleDenylist.length > 0 ||
    rules.persona.departmentAllowlist.length > 0 ||
    rules.persona.seniorityExclusions.length > 0 ||
    Boolean(rules.persona.seniorityFloor);
  const hasTerminalRule =
    rules.disqualifiers.genericEmailContact.disqualify ||
    rules.disqualifiers.onePersonCompany.disqualify ||
    rules.disqualifiers.websiteOffline.disqualify ||
    rules.disqualifiers.competitorDenylist.length > 0;

  if (
    requireConstraint &&
    !hasCompanyConstraint &&
    !hasPersonaConstraint &&
    !hasTerminalRule
  ) {
    throw new IcpAuthoringError(
      "invalid_rules",
      "Add at least one ICP must-have or exclusion before publishing",
    );
  }

  return rules;
}

/**
 * The profiles a caller may see: every library ICP, plus the custom ICPs owned by `customOwnerIds`
 * (the caller's own and their chain's; `lib/leadgen/icpAccess.ts#visibleCustomOwnerIds`).
 */
export async function listIcpProfiles(
  tenantId: string,
  /** Whose custom ICPs to include. Omit for all (the caller already authorized). */
  customOwnerIds?: string[],
) {
  const customFilter: Prisma.IcpProfileWhereInput | null = customOwnerIds
    ? { kind: "custom", ownerUserId: { in: customOwnerIds } }
    : null;
  const profiles = await prisma.icpProfile.findMany({
    where: {
      tenantId,
      ...(customFilter ? { OR: [{ kind: "library" }, customFilter] } : {}),
    },
    orderBy: [{ isDefault: "desc" }, { kind: "asc" }, { updatedAt: "desc" }],
    take: 200,
    select: {
      id: true,
      name: true,
      description: true,
      isDefault: true,
      kind: true,
      ownerUserId: true,
      owner: { select: { id: true, firstName: true, lastName: true } },
      updatedAt: true,
      _count: { select: { campaigns: true } },
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 20,
        select: {
          id: true,
          versionNumber: true,
          status: true,
          rulesJson: true,
          publishedAt: true,
          submittedAt: true,
          submittedById: true,
          reviewedAt: true,
          reviewNote: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });
  return profiles;
}

export async function createIcpProfile(input: {
  tenantId: string;
  name: string;
  description?: string | null;
  templateId?: string;
  isDefault?: boolean;
  /** `library` (default) is shared and managed; `custom` belongs to `ownerUserId`. */
  kind?: "library" | "custom";
  ownerUserId?: string | null;
  /** Start from these rules instead of the template / empty set (a copy of a library ICP, a prefill). */
  rules?: IcpVersionRulesV2;
}) {
  const kind = input.kind ?? "library";
  const template = input.templateId
    ? getIcpTemplateV2(input.templateId)
    : null;
  if (input.templateId && !template) {
    throw new IcpAuthoringError("invalid_rules", "Unknown ICP template");
  }

  const rules = normalizeManagerRules(
    input.rules ??
      (template
        ? template.build(randomUUID())
        : emptyIcpRulesV2(randomUUID(), input.name)),
  );

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // Only library ICPs can be the template; a custom ICP never is, and does not count
          // towards "the first library ICP becomes the default".
          const profileCount = await tx.icpProfile.count({
            where: { tenantId: input.tenantId, kind: "library" },
          });
          const makeDefault =
            kind === "library" && (input.isDefault === true || profileCount === 0);
          if (makeDefault) {
            await tx.icpProfile.updateMany({
              where: { tenantId: input.tenantId, isDefault: true },
              data: { isDefault: false },
            });
          }

          const profile = await tx.icpProfile.create({
            data: {
              tenantId: input.tenantId,
              name: input.name,
              description: input.description || null,
              isDefault: makeDefault,
              kind,
              ownerUserId: kind === "custom" ? (input.ownerUserId ?? null) : null,
            },
            select: { id: true, name: true, isDefault: true, kind: true, ownerUserId: true },
          });
          const version = await tx.icpVersion.create({
            data: {
              tenantId: input.tenantId,
              icpProfileId: profile.id,
              versionNumber: 1,
              status: "draft",
              rulesJson: rules as unknown as Prisma.InputJsonValue,
            },
            select: {
              id: true,
              versionNumber: true,
              status: true,
              updatedAt: true,
            },
          });

          return { profile, version };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      lastError = error;
      if ((error as { code?: string } | null)?.code !== "P2034") throw error;
    }
  }
  throw lastError;
}
export async function cloneIcpVersionAsDraft(input: {
  tenantId: string;
  sourceVersionId: string;
  acknowledgeSimplification?: boolean;
}) {
  const source = await prisma.icpVersion.findFirst({
    where: { id: input.sourceVersionId, tenantId: input.tenantId },
    select: {
      id: true,
      icpProfileId: true,
      versionNumber: true,
      status: true,
      rulesJson: true,
    },
  });
  if (!source) throw new IcpAuthoringError("not_found", "ICP version not found");
  if (source.status === "draft") return source;

  const existingDraft = await prisma.icpVersion.findFirst({
    where: {
      tenantId: input.tenantId,
      icpProfileId: source.icpProfileId,
      status: "draft",
    },
    orderBy: { versionNumber: "desc" },
  });
  if (existingDraft) return existingDraft;
  await assertNoVersionInReview(input.tenantId, source.icpProfileId);

  const simplificationNotes = managerSimplificationNotes(source.rulesJson);
  if (simplificationNotes.length && !input.acknowledgeSimplification) {
    throw new IcpAuthoringError(
      "simplification_required",
      `Confirm simplification: ${simplificationNotes.join("; ")}`,
    );
  }
  const rules = normalizeManagerRules(source.rulesJson);
  const latest = await prisma.icpVersion.findFirst({
    where: { tenantId: input.tenantId, icpProfileId: source.icpProfileId },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });

  try {
    return await prisma.icpVersion.create({
      data: {
        tenantId: input.tenantId,
        icpProfileId: source.icpProfileId,
        versionNumber: (latest?.versionNumber ?? source.versionNumber) + 1,
        status: "draft",
        rulesJson: rules as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if ((error as { code?: string } | null)?.code !== "P2002") throw error;
    const winner = await prisma.icpVersion.findFirst({
      where: {
        tenantId: input.tenantId,
        icpProfileId: source.icpProfileId,
        status: "draft",
      },
      orderBy: { versionNumber: "desc" },
    });
    if (!winner) throw error;
    return winner;
  }
}

export async function saveIcpDraft(input: {
  tenantId: string;
  versionId: string;
  expectedUpdatedAt: string;
  rulesJson: unknown;
  acknowledgeSimplification?: boolean;
}) {
  const sourceRules = validateManagerRules(input.rulesJson);
  const simplificationNotes = managerSimplificationNotes(sourceRules);
  if (simplificationNotes.length && !input.acknowledgeSimplification) {
    throw new IcpAuthoringError(
      "simplification_required",
      `Confirm simplification: ${simplificationNotes.join("; ")}`,
    );
  }
  const rules = validateManagerRules(normalizeManagerRules(sourceRules));

  const current = await prisma.icpVersion.findFirst({
    where: { id: input.versionId, tenantId: input.tenantId },
    select: { id: true, status: true },
  });
  if (!current) throw new IcpAuthoringError("not_found", "ICP draft not found");
  if (current.status === "pending_review") {
    throw new IcpAuthoringError(
      "review_pending",
      "This version is waiting for review and cannot be edited. Withdraw it or wait for the decision.",
    );
  }
  if (current.status !== "draft") {
    throw new IcpAuthoringError(
      "published_immutable",
      "Published ICP versions cannot be edited",
    );
  }

  const result = await prisma.icpVersion.updateMany({
    where: {
      id: input.versionId,
      tenantId: input.tenantId,
      status: "draft",
      updatedAt: new Date(input.expectedUpdatedAt),
    },
    data: { rulesJson: rules as unknown as Prisma.InputJsonValue },
  });
  if (result.count !== 1) {
    throw new IcpAuthoringError(
      "draft_conflict",
      "This draft changed in another session. Reload before saving.",
    );
  }

  return prisma.icpVersion.findFirstOrThrow({
    where: { id: input.versionId, tenantId: input.tenantId },
  });
}

export async function publishIcpDraft(input: {
  tenantId: string;
  versionId: string;
  expectedUpdatedAt: string;
}) {
  const current = await prisma.icpVersion.findFirst({
    where: { id: input.versionId, tenantId: input.tenantId },
    select: {
      id: true,
      icpProfileId: true,
      status: true,
      rulesJson: true,
      updatedAt: true,
    },
  });
  if (!current) throw new IcpAuthoringError("not_found", "ICP draft not found");
  if (current.status === "published") return current;
  if (current.status !== "draft") {
    throw new IcpAuthoringError("published_immutable", "Only drafts can be published");
  }
  const simplificationNotes = managerSimplificationNotes(current.rulesJson);
  if (simplificationNotes.length) {
    throw new IcpAuthoringError(
      "simplification_required",
      "Save and confirm legacy-rule simplification before publishing",
    );
  }
  const rules = validateManagerRules(current.rulesJson, true);

  return prisma.$transaction(async (tx) => {
    await tx.icpVersion.updateMany({
      where: {
        tenantId: input.tenantId,
        icpProfileId: current.icpProfileId,
        status: "published",
        id: { not: current.id },
      },
      data: { status: "archived" },
    });
    const result = await tx.icpVersion.updateMany({
      where: {
        id: current.id,
        tenantId: input.tenantId,
        status: "draft",
        updatedAt: new Date(input.expectedUpdatedAt),
      },
      data: {
        status: "published",
        publishedAt: new Date(),
        rulesJson: rules as unknown as Prisma.InputJsonValue,
      },
    });
    if (result.count !== 1) {
      throw new IcpAuthoringError(
        "draft_conflict",
        "This draft changed in another session. Reload before publishing.",
      );
    }
    return tx.icpVersion.findFirstOrThrow({
      where: { id: current.id, tenantId: input.tenantId },
    });
  });
}

/**
 * Point a campaign at an ICP, or clear it (`icpVersionId: null`).
 *
 * The campaign follows the chosen version's PROFILE (`icpProfileId`): it scores against that
 * profile's newest published version from now on, so publishing a new version needs no re-pointing.
 * `icpVersionId` is still written, as history and for the previous image. Clearing both leaves the
 * campaign with no ICP: its leads are not scored (there is no default fallback).
 */
export async function assignCampaignIcp(input: {
  tenantId: string;
  campaignId: string;
  icpVersionId: string | null;
}) {
  const [campaign, version] = await Promise.all([
    prisma.campaign.findFirst({
      where: { id: input.campaignId, tenantId: input.tenantId },
      select: { id: true, icpVersionId: true, icpProfileId: true },
    }),
    input.icpVersionId === null
      ? Promise.resolve(null)
      : prisma.icpVersion.findFirst({
          where: {
            id: input.icpVersionId,
            tenantId: input.tenantId,
            status: "published",
          },
          select: { id: true, icpProfileId: true },
        }),
  ]);
  if (!campaign) throw new IcpAuthoringError("not_found", "Campaign not found");
  if (input.icpVersionId !== null && !version) {
    throw new IcpAuthoringError(
      "not_found",
      "Published ICP version not found",
    );
  }
  const next = {
    icpVersionId: version?.id ?? null,
    icpProfileId: version?.icpProfileId ?? null,
  };
  if (
    campaign.icpVersionId === next.icpVersionId &&
    campaign.icpProfileId === next.icpProfileId
  ) {
    return { id: campaign.id, icpVersionId: campaign.icpVersionId };
  }

  return prisma.campaign.update({
    where: { id: campaign.id },
    data: next,
    select: { id: true, icpVersionId: true, icpProfileId: true },
  });
}

/**
 * A profile has at most one version open at a time: a draft, or one waiting for review. Editing a
 * published version while another is in review would fork the rules the reviewer is approving.
 */
export async function assertNoVersionInReview(tenantId: string, icpProfileId: string) {
  const pending = await prisma.icpVersion.findFirst({
    where: { tenantId, icpProfileId, status: "pending_review" },
    select: { id: true },
  });
  if (pending) {
    throw new IcpAuthoringError(
      "review_pending",
      "A version of this ICP is waiting for review. Withdraw it or wait for the decision before editing.",
    );
  }
}
