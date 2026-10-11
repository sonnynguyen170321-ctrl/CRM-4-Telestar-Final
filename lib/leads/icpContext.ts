import { resolveCampaignIcp, type IcpNotScoredReason } from '@/lib/leadgen/scorePoolItem';
import { prisma } from '@/lib/prisma';

/**
 * Which ICP a lead's verdict is measured against, and whether that is still the one that applies.
 *
 * Reported 2026-10-08: "the drawer is biased to the Telestar ICP; each campaign has a different
 * ICP." The cause was a silent fallback: a campaign with no ICP was scored against the company
 * default. Owner decision 2026-10-10: no fallback. A campaign scores against its own ICP profile
 * (its newest published version) or not at all, and this says which, using the same resolver the
 * scorer uses (`resolveCampaignIcp`) so the drawer cannot disagree with the engine.
 *
 * It decides nothing about scoring.
 */

export type IcpRef = {
  versionId: string;
  profileName: string;
  versionNumber: number;
  status: string;
};

export type LeadIcpContext = {
  /** The ICP this lead would be scored against today. */
  applies: IcpRef | null;
  /** Where `applies` comes from: the campaign's own ICP, or nothing (there is no default for leads). */
  source: 'campaign' | 'none';
  /** Why nothing applies; null when something does. */
  reason: IcpNotScoredReason | null;
  /** Set when the campaign has a profile but it has no published version to score with. */
  profileName: string | null;
  /** The ICP the shown verdict was produced with, when it is not the one that applies now. */
  scoredWith: IcpRef | null;
  /** The verdict was produced with a different ICP than the one that applies now. */
  outdated: boolean;
};

const REF_SELECT = { id: true, versionNumber: true, status: true, icpProfile: { select: { name: true } } } as const;

type RefRow = { id: string; versionNumber: number; status: string; icpProfile: { name: string } | null };

function toRef(row: RefRow | null | undefined): IcpRef | null {
  if (!row) return null;
  return { versionId: row.id, profileName: row.icpProfile?.name ?? 'ICP', versionNumber: row.versionNumber, status: row.status };
}

export async function loadLeadIcpContext(input: {
  tenantId: string;
  campaignId: string | null;
  /** `Lead.icpVersionId`: the version the current verdict was scored with. */
  scoredVersionId: string | null;
}): Promise<LeadIcpContext> {
  const { tenantId, campaignId, scoredVersionId } = input;

  const resolution = await resolveCampaignIcp(tenantId, campaignId);
  let applies: IcpRef | null = null;
  let profileName: string | null = null;
  if (resolution.ok) {
    applies = toRef(await prisma.icpVersion.findFirst({ where: { id: resolution.icpVersionId, tenantId }, select: REF_SELECT }));
  } else if (resolution.icpProfileId) {
    profileName = (await prisma.icpProfile.findFirst({ where: { id: resolution.icpProfileId, tenantId }, select: { name: true } }))?.name ?? null;
  }

  const outdated = Boolean(scoredVersionId && applies && scoredVersionId !== applies.versionId);
  const scoredWith = outdated
    ? toRef(await prisma.icpVersion.findFirst({ where: { id: scoredVersionId!, tenantId }, select: REF_SELECT }))
    : null;

  return {
    applies,
    source: applies ? 'campaign' : 'none',
    reason: resolution.ok ? null : resolution.reason,
    profileName,
    scoredWith,
    outdated,
  };
}

/** "TeleStar ICP v2" */
export function icpLabel(ref: IcpRef): string {
  return `${ref.profileName} v${ref.versionNumber}`;
}

/** The sentences the drawer shows under the verdict. Pure, so the wording is tested. */
export function describeIcpContext(context: LeadIcpContext): { line: string; warning: string | null } {
  if (!context.applies) {
    if (context.reason === 'icp_has_no_published_version') {
      const name = context.profileName ? `"${context.profileName}" ` : '';
      return { line: `This campaign's ICP ${name}has no published version, so this lead is not scored — publish one.`, warning: null };
    }
    return { line: 'This campaign has no ICP — set one.', warning: null };
  }
  const label = icpLabel(context.applies);
  const line = `Scored against this campaign's ICP: ${label}.`;

  if (context.outdated) {
    const before = context.scoredWith ? icpLabel(context.scoredWith) : 'an earlier ICP';
    return {
      line,
      warning: `This verdict came from ${before}, not ${label}. It changes only when the lead is scored again.`,
    };
  }
  if (context.applies.status === 'archived') {
    return { line, warning: `${label} has been archived. Ask a manager to give this campaign a current ICP.` };
  }
  return { line, warning: null };
}
