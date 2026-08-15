import { prisma } from '@/lib/prisma';
import {
  LEAD_QUALITY_INCLUDE,
  matchRequirement,
  type LeadForQuality,
  type RequirementMatch,
} from './qualification';

/**
 * ICP adherence — what share of delivered leads actually match the campaign requirement (Task 8).
 *
 * The Leadgen Manager's question is "are we delivering what the client asked for", and the
 * dashboard could previously only answer "how many did we deliver". Volume against a target is
 * not adherence: a campaign can be 100% fulfilled and 40% on-ICP, and the second number is the
 * one that arrives as a client complaint.
 *
 * ## It measures with the matcher, it does not reimplement it
 *
 * Every verdict comes from `matchRequirement`, the same function behind the per-lead assessment.
 * A percentage computed by a second implementation would eventually disagree with the assessment
 * displayed beside it, and nobody could say which was right. `CampaignLeadRequirement` is the ICP
 * — the playbook contract *rejects* an `icp` key — so there is exactly one definition to read.
 *
 * ## Missing data is never a match
 *
 * Four outcomes, and the distinction between the last two is the whole point:
 *
 * | Outcome | Meaning |
 * |---|---|
 * | `matched` | every configured criterion judged and met |
 * | `mismatched` | at least one criterion the lead demonstrably fails |
 * | `unknown` | nothing fails, but the CRM holds no value for some criterion |
 * | `unevaluated` | the delivered pool item never became a CRM lead, so nothing can be judged |
 *
 * Counting `unknown` as matched would inflate adherence exactly where the data is worst, which is
 * where a client is most likely to disagree. Counting it as mismatched would blame the leadgen
 * team for gaps in enrichment. It is reported as its own number, and the denominator says so.
 *
 * ## A requirement that asks for nothing penalises nobody
 *
 * A campaign with no criteria configured has nothing to adhere to. Its leads are not counted as
 * mismatches; the campaign reports `evaluated: 0` and `hasCriteria: false`, so a manager reads
 * "not measured" rather than "0%".
 */

export type IcpOutcome = 'matched' | 'mismatched' | 'unknown' | 'unevaluated';

export interface IcpMismatchReason {
  /** A criterion name as `matchRequirement` reports it: `title`, `country`, `requiredField:phone`. */
  criterion: string;
  count: number;
}

export interface CampaignIcpAdherence {
  campaignId: string;
  campaignName: string;
  requirementId: string | null;
  /** False when the requirement configures no criteria — nothing to measure against. */
  hasCriteria: boolean;
  /** Delivered pool items considered, whether or not they could be judged. */
  delivered: number;
  /** Delivered leads that could actually be judged. The denominator of `matchRate`. */
  evaluated: number;
  matched: number;
  mismatched: number;
  unknown: number;
  unevaluated: number;
  /** `matched / evaluated`, 0–100, rounded. Null when nothing was evaluable. */
  matchRate: number | null;
  /** Which criteria failed most often, worst first. */
  topMismatchReasons: IcpMismatchReason[];
}

export interface IcpAdherenceSummary {
  campaigns: CampaignIcpAdherence[];
  /** Tenant-wide rollup across campaigns that have criteria. */
  totals: {
    delivered: number;
    evaluated: number;
    matched: number;
    mismatched: number;
    unknown: number;
    unevaluated: number;
    matchRate: number | null;
    topMismatchReasons: IcpMismatchReason[];
  };
}

/** How many delivered items one campaign is measured over. Bounded so a report cannot run away. */
const MAX_ITEMS_PER_CAMPAIGN = 5_000;
const TOP_REASONS = 5;

export async function getIcpAdherence(
  tenantId: string,
  options: { campaignId?: string } = {}
): Promise<IcpAdherenceSummary> {
  const requirements = await prisma.campaignLeadRequirement.findMany({
    where: {
      tenantId,
      status: { in: ['open', 'fulfilled'] },
      ...(options.campaignId ? { campaignId: options.campaignId } : {}),
    },
    include: { campaign: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  });

  const campaigns: CampaignIcpAdherence[] = [];

  for (const req of requirements) {
    const hasCriteria =
      req.targetTitles.length > 0 ||
      req.targetIndustries.length > 0 ||
      req.targetCountries.length > 0 ||
      req.companySizeMin !== null ||
      req.companySizeMax !== null ||
      req.requiredFields.length > 0;

    // What "delivered" means: a pool item the leadgen floor assigned to this campaign. Its
    // `convertedLeadId` is the CRM lead it became, and a delivered item with none cannot be
    // judged — the firmographics the criteria read live on the lead's account and contact.
    const items = await prisma.leadPoolItem.findMany({
      where: { tenantId, assignedCampaignId: req.campaignId, status: 'assigned_to_campaign' },
      select: { id: true, convertedLeadId: true },
      take: MAX_ITEMS_PER_CAMPAIGN,
    });

    const row: CampaignIcpAdherence = {
      campaignId: req.campaignId,
      campaignName: req.campaign.name,
      requirementId: req.id,
      hasCriteria,
      delivered: items.length,
      evaluated: 0,
      matched: 0,
      mismatched: 0,
      unknown: 0,
      unevaluated: 0,
      matchRate: null,
      topMismatchReasons: [],
    };

    if (!hasCriteria || items.length === 0) {
      row.unevaluated = hasCriteria ? items.length : 0;
      campaigns.push(row);
      continue;
    }

    const leadIds = items.map((i) => i.convertedLeadId).filter((id): id is string => Boolean(id));
    row.unevaluated = items.length - leadIds.length;

    const leads = leadIds.length
      ? ((await prisma.lead.findMany({
          where: { id: { in: leadIds }, tenantId },
          include: LEAD_QUALITY_INCLUDE,
        })) as LeadForQuality[])
      : [];

    // A converted lead that no longer exists, or that belongs to another tenant, is unevaluable
    // rather than absent: the delivery happened and something has to account for it.
    row.unevaluated += leadIds.length - leads.length;

    const reasons = new Map<string, number>();

    for (const lead of leads) {
      const match = matchRequirement(lead, req);
      const verdict = classify(match);
      row[verdict] += 1;
      if (verdict === 'mismatched') {
        for (const criterion of match.unmet) {
          reasons.set(criterion, (reasons.get(criterion) ?? 0) + 1);
        }
      }
    }

    row.evaluated = row.matched + row.mismatched + row.unknown;
    row.matchRate = row.evaluated > 0 ? Math.round((row.matched / row.evaluated) * 100) : null;
    row.topMismatchReasons = rankReasons(reasons);

    campaigns.push(row);
  }

  return { campaigns, totals: rollUp(campaigns) };
}

/**
 * One requirement match becomes one outcome.
 *
 * `fullyMet` already encodes "judged and met with nothing unresolved", so the only decision left
 * is which kind of not-matched this is. Order matters: a lead that fails a criterion *and* has a
 * missing one is a mismatch, because the failure is knowable and the gap does not excuse it.
 */
function classify(match: RequirementMatch): 'matched' | 'mismatched' | 'unknown' {
  if (match.fullyMet) return 'matched';
  if (match.unmet.length > 0) return 'mismatched';
  return 'unknown';
}

function rankReasons(reasons: Map<string, number>): IcpMismatchReason[] {
  return [...reasons.entries()]
    .map(([criterion, count]) => ({ criterion, count }))
    .sort((a, b) => b.count - a.count || a.criterion.localeCompare(b.criterion))
    .slice(0, TOP_REASONS);
}

function rollUp(campaigns: CampaignIcpAdherence[]): IcpAdherenceSummary['totals'] {
  // Campaigns with no criteria are excluded from the rollup entirely. Folding their deliveries in
  // would drag a tenant-wide rate toward whatever share of campaigns simply have not configured
  // an ICP yet, which says nothing about lead quality.
  const measured = campaigns.filter((c) => c.hasCriteria);
  const totals = {
    delivered: 0,
    evaluated: 0,
    matched: 0,
    mismatched: 0,
    unknown: 0,
    unevaluated: 0,
    matchRate: null as number | null,
    topMismatchReasons: [] as IcpMismatchReason[],
  };

  const reasons = new Map<string, number>();
  for (const c of measured) {
    totals.delivered += c.delivered;
    totals.evaluated += c.evaluated;
    totals.matched += c.matched;
    totals.mismatched += c.mismatched;
    totals.unknown += c.unknown;
    totals.unevaluated += c.unevaluated;
    for (const reason of c.topMismatchReasons) {
      reasons.set(reason.criterion, (reasons.get(reason.criterion) ?? 0) + reason.count);
    }
  }

  totals.matchRate = totals.evaluated > 0 ? Math.round((totals.matched / totals.evaluated) * 100) : null;
  totals.topMismatchReasons = rankReasons(reasons);
  return totals;
}
