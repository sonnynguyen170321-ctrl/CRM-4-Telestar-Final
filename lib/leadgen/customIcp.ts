import { randomUUID } from "node:crypto";

import { emptyIcpRulesV2 } from "@telestar/core-scoring/rules/emptyIcpRulesV2";
import { getIcpTemplateV2 } from "@telestar/core-scoring/rules/icpTemplatesV2";
import type { IcpVersionRulesV2 } from "@telestar/core-scoring/rules/schema-v2";

import type { SessionUser } from "@/lib/auth";
import { applyRequirementPrefill, type PrefillRequirement } from "@/lib/leadgen/icpRequirementPrefill";
import { canViewProfile } from "@/lib/leadgen/icpAccess";
import {
  IcpAuthoringError,
  createIcpProfile,
  normalizeManagerRules,
} from "@/lib/leadgen/icpAuthoring";
import { prisma } from "@/lib/prisma";

/**
 * A personal ICP made for a campaign: from a template, as a copy of another ICP, or blank.
 *
 * It is created as a `custom` profile owned by the caller with one draft version. It scores nothing
 * until the draft is published (a team lead or manager) or approved (everyone else), so making one
 * is safe for any rep who can see the campaign.
 */

export type CustomIcpSource =
  | { source: "template"; templateId: string }
  | { source: "library"; sourceProfileId: string }
  | { source: "blank" };

/** `Base`, then `Base (2)`, `Base (3)`: profile names are unique per tenant. */
export async function uniqueIcpName(tenantId: string, base: string): Promise<string> {
  const trimmed = base.trim().slice(0, 100);
  const taken = new Set(
    (
      await prisma.icpProfile.findMany({
        where: { tenantId, name: { startsWith: trimmed } },
        select: { name: true },
        take: 200,
      })
    ).map((row) => row.name),
  );
  if (!taken.has(trimmed)) return trimmed;
  for (let n = 2; n < 500; n += 1) {
    const candidate = `${trimmed} (${n})`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${trimmed} (${Date.now()})`;
}

async function copySourceRules(
  tenantId: string,
  user: SessionUser,
  sourceProfileId: string,
): Promise<IcpVersionRulesV2> {
  const profile = await prisma.icpProfile.findFirst({
    where: { id: sourceProfileId, tenantId },
    select: {
      id: true,
      kind: true,
      ownerUserId: true,
      versions: {
        where: { status: "published" },
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: { rulesJson: true },
      },
    },
  });
  // Invisible and missing look the same to the caller.
  if (!profile || !(await canViewProfile(user, profile))) {
    throw new IcpAuthoringError("not_found", "ICP to copy not found");
  }
  const published = profile.versions[0];
  if (!published) {
    throw new IcpAuthoringError("invalid_rules", "That ICP has no published version to copy yet");
  }
  return normalizeManagerRules(published.rulesJson);
}

export async function createCustomIcp(input: {
  tenantId: string;
  user: SessionUser;
  name?: string;
  campaignId?: string | null;
  campaignName?: string | null;
  source: CustomIcpSource;
}) {
  const { tenantId, user } = input;

  let requirement: PrefillRequirement | null = null;
  if (input.campaignId) {
    requirement = await prisma.campaignLeadRequirement.findFirst({
      where: { tenantId, campaignId: input.campaignId },
      orderBy: { createdAt: "desc" },
      select: {
        targetTitles: true,
        targetCountries: true,
        targetIndustries: true,
        companySizeMin: true,
        companySizeMax: true,
      },
    });
  }

  const baseName =
    input.name?.trim() ||
    (input.campaignName ? `${input.campaignName} ICP` : `${user.firstName} ${user.lastName} ICP`.trim());

  let rules: IcpVersionRulesV2;
  if (input.source.source === "library") {
    // A copy keeps the source's rules exactly.
    rules = await copySourceRules(tenantId, user, input.source.sourceProfileId);
  } else {
    let start: IcpVersionRulesV2;
    if (input.source.source === "template") {
      const template = getIcpTemplateV2(input.source.templateId);
      if (!template) throw new IcpAuthoringError("invalid_rules", "Unknown ICP template");
      start = template.build(randomUUID());
    } else {
      start = emptyIcpRulesV2(randomUUID(), baseName);
    }
    // A template or blank ICP takes the client's brief, when the campaign has one.
    rules = applyRequirementPrefill(start, requirement);
  }

  for (let attempt = 0; ; attempt += 1) {
    const name = await uniqueIcpName(tenantId, baseName.length >= 2 ? baseName : "Custom ICP");
    try {
      return await createIcpProfile({
        tenantId,
        name,
        kind: "custom",
        ownerUserId: user.id,
        rules,
      });
    } catch (error) {
      // Lost a race for the name: take the next free one rather than failing the campaign.
      if ((error as { code?: string } | null)?.code === "P2002" && attempt < 3) continue;
      throw error;
    }
  }
}
