import { validateIcpVersionRulesV2 } from '@telestar/core-scoring/rules/schema-v2';
import { foldText } from '@telestar/core-scoring/rules/normalize/normalizeCountry';

import {
  assignCampaignIcp,
  cloneIcpVersionAsDraft,
  IcpAuthoringError,
  managerSimplificationNotes,
  publishIcpDraft,
  saveIcpDraft,
} from '@/lib/leadgen/icpAuthoring';
import { prisma } from '@/lib/prisma';

/**
 * Add accepted titles to an ICP and point campaigns at the result — through the same authoring path
 * the ICP builder uses (clone the published version, save the draft, publish, assign), so the old
 * version stays as it was and every lead scored under it keeps an honest record.
 *
 * Written for an operator script (owner request, 2026-10-07: add Managing Director, Owner,
 * President, Sales Director, CSO, VP Sales; move two campaigns off an archived version). Plans
 * first and writes nothing unless `apply` is set. Refuses rather than guesses: a profile with an
 * open draft (someone is mid-edit), rules the builder would have to simplify, or a campaign that
 * cannot be found are reported, not worked around.
 */
export type AllowlistUpdatePlan = {
  profileId: string;
  profileName: string;
  fromVersionId: string;
  fromVersionNumber: number;
  titlesToAdd: string[];
  titlesAlreadyThere: string[];
  campaignsToMove: Array<{ id: string; name: string; fromVersionId: string | null }>;
  /** Set once applied: the version the campaigns now use. */
  publishedVersionId?: string;
};

export class AllowlistUpdateError extends Error {}

const titleKey = (title: string) => foldText(title).replace(/[^a-z0-9]+/g, ' ').trim();

export async function updateIcpAllowlist(input: {
  tenantId: string;
  profileId: string;
  addTitles: string[];
  campaignIds?: string[];
  apply?: boolean;
}): Promise<AllowlistUpdatePlan> {
  const { tenantId } = input;
  const profile = await prisma.icpProfile.findFirst({ where: { id: input.profileId, tenantId }, select: { id: true, name: true } });
  if (!profile) throw new AllowlistUpdateError(`ICP profile ${input.profileId} not found`);

  const versions = await prisma.icpVersion.findMany({
    where: { tenantId, icpProfileId: profile.id, status: { in: ['published', 'draft'] } },
    select: { id: true, versionNumber: true, status: true, rulesJson: true },
  });
  const drafts = versions.filter((v) => v.status === 'draft');
  if (drafts.length) throw new AllowlistUpdateError(`"${profile.name}" has an open draft (v${drafts[0].versionNumber}); publish or discard it first`);
  const published = versions.filter((v) => v.status === 'published');
  if (published.length !== 1) throw new AllowlistUpdateError(`"${profile.name}" has ${published.length} published versions; expected exactly 1`);
  const source = published[0];
  if (managerSimplificationNotes(source.rulesJson).length) {
    throw new AllowlistUpdateError(`"${profile.name}" v${source.versionNumber} uses rules the ICP builder would simplify; edit it in the builder instead`);
  }

  const existing = validateIcpVersionRulesV2(source.rulesJson).persona.titleAllowlist;
  const seen = new Set(existing.map(titleKey));
  const titlesToAdd: string[] = [];
  const titlesAlreadyThere: string[] = [];
  for (const raw of input.addTitles) {
    const title = raw.trim();
    if (!title) continue;
    const key = titleKey(title);
    if (seen.has(key)) titlesAlreadyThere.push(title);
    else {
      seen.add(key);
      titlesToAdd.push(title);
    }
  }

  // The named campaigns, plus every campaign already on the version being replaced: publishing
  // archives it, and a campaign left behind would keep scoring against the old list.
  const requested = input.campaignIds ?? [];
  const campaigns = await prisma.campaign.findMany({
    where: { tenantId, OR: [{ id: { in: requested } }, ...(titlesToAdd.length ? [{ icpVersionId: source.id }] : [])] },
    select: { id: true, name: true, icpVersionId: true },
    orderBy: { name: 'asc' },
  });
  const missing = requested.filter((id) => !campaigns.some((c) => c.id === id));
  if (missing.length) throw new AllowlistUpdateError(`Campaign(s) not found: ${missing.join(', ')}`);

  const plan: AllowlistUpdatePlan = {
    profileId: profile.id,
    profileName: profile.name,
    fromVersionId: source.id,
    fromVersionNumber: source.versionNumber,
    titlesToAdd,
    titlesAlreadyThere,
    campaignsToMove: campaigns
      .filter((c) => titlesToAdd.length > 0 || c.icpVersionId !== source.id)
      .map((c) => ({ id: c.id, name: c.name, fromVersionId: c.icpVersionId })),
  };
  if (!input.apply) return plan;

  let targetVersionId = source.id;
  if (titlesToAdd.length) {
    const draft = await cloneIcpVersionAsDraft({ tenantId, sourceVersionId: source.id });
    const rules = validateIcpVersionRulesV2(draft.rulesJson);
    const { updatedAt } = await prisma.icpVersion.findFirstOrThrow({ where: { id: draft.id, tenantId }, select: { updatedAt: true } });
    const saved = await saveIcpDraft({
      tenantId,
      versionId: draft.id,
      expectedUpdatedAt: updatedAt.toISOString(),
      rulesJson: { ...rules, persona: { ...rules.persona, titleAllowlist: [...rules.persona.titleAllowlist, ...titlesToAdd] } },
    });
    const live = await publishIcpDraft({ tenantId, versionId: saved.id, expectedUpdatedAt: saved.updatedAt.toISOString() });
    targetVersionId = live.id;
  }
  for (const campaign of plan.campaignsToMove) {
    try {
      await assignCampaignIcp({ tenantId, campaignId: campaign.id, icpVersionId: targetVersionId });
    } catch (error) {
      if (error instanceof IcpAuthoringError) throw new AllowlistUpdateError(`Could not move "${campaign.name}": ${error.message}`);
      throw error;
    }
  }
  return { ...plan, publishedVersionId: targetVersionId };
}
