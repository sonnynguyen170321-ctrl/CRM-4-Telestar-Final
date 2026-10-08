import { prisma } from '@/lib/prisma';

/**
 * Which ICP a lead's verdict is measured against, and whether that is still the one that applies.
 *
 * Reported 2026-10-08: "the drawer is biased to the Telestar ICP; each campaign has a different
 * ICP." The engine itself reads only the rules it is handed. The bias came from what it is handed,
 * none of which the drawer said:
 *
 *   - a campaign with no ICP of its own is scored against the company default (Telestar);
 *   - giving a campaign its own ICP does not rescore its leads, so their verdicts stay on whatever
 *     they were scored against before;
 *   - a campaign can still point at an ICP version that has since been archived.
 *
 * This answers those three questions for the drawer. It decides nothing about scoring.
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
  /** Where `applies` comes from: the campaign's own ICP, or the company default because it has none. */
  source: 'campaign' | 'default' | 'none';
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

  // The same order as `resolveIcpVersionId` (lib/leadgen/scorePoolItem.ts): the campaign's own
  // version, else the newest published version of the default profile.
  const campaign = campaignId
    ? await prisma.campaign.findFirst({
        where: { id: campaignId, tenantId },
        select: { icpVersion: { select: REF_SELECT } },
      })
    : null;
  let applies = toRef(campaign?.icpVersion);
  let source: LeadIcpContext['source'] = applies ? 'campaign' : 'none';

  if (!applies) {
    const fallback = await prisma.icpVersion.findFirst({
      where: { tenantId, status: 'published', icpProfile: { isDefault: true } },
      orderBy: { versionNumber: 'desc' },
      select: REF_SELECT,
    });
    applies = toRef(fallback);
    if (applies) source = 'default';
  }

  const outdated = Boolean(scoredVersionId && applies && scoredVersionId !== applies.versionId);
  const scoredWith = outdated
    ? toRef(await prisma.icpVersion.findFirst({ where: { id: scoredVersionId!, tenantId }, select: REF_SELECT }))
    : null;

  return { applies, source, scoredWith, outdated };
}

/** "TeleStar ICP v2" */
export function icpLabel(ref: IcpRef): string {
  return `${ref.profileName} v${ref.versionNumber}`;
}

/** The sentences the drawer shows under the verdict. Pure, so the wording is tested. */
export function describeIcpContext(context: LeadIcpContext): { line: string; warning: string | null } {
  if (!context.applies) {
    return { line: 'No ICP applies to this lead: its campaign has none and there is no company default.', warning: null };
  }
  const label = icpLabel(context.applies);
  const line =
    context.source === 'campaign'
      ? `Scored against this campaign's ICP: ${label}.`
      : `This campaign has no ICP of its own, so it is scored against the company default: ${label}.`;

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
