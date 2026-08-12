import { prisma } from '@/lib/prisma';

/**
 * What AI cost, read from the ledger that already records it (Revenue AI Phase 1 → Phase 9).
 *
 * `AiCall` is the only place spend is recorded — one row per provider round trip, written by
 * `lib/ai/usage.ts`. This module aggregates it and nothing else: it does not estimate, does not
 * re-price and does not keep a running total of its own. If a number here looks wrong, the row it
 * came from is on disk.
 *
 * **It lives outside `lib/ai/` deliberately.** There is no provider call here, no model, no key —
 * only arithmetic over a table the CRM owns. Filing it under `lib/ai/` would make every management
 * surface that reports cost look like a module the CRM depends on the AI layer for, and
 * `tests/ai-optional.test.ts` would be right to fail the build for it. Same correction as
 * `lib/ai/scoring.ts` → `lib/leads/scoring.ts` in Phase 1.
 *
 * **Server-only.** It touches Prisma, so no `"use client"` module may import it, directly or
 * transitively (ARCHITECTURE §10).
 *
 * ## Why attribution is best-effort
 *
 * `AiCall.leadId` carries no foreign key on purpose — an accounting record must outlive an
 * archived lead. So spend is attributed to a campaign by joining through whatever leads still
 * exist, and anything unattributable is reported as its own line rather than being silently
 * dropped or spread across campaigns it may not belong to.
 */

export interface CampaignSpend {
  campaignId: string | null;
  campaignName: string;
  clientName: string | null;
  usd: number;
  calls: number;
  /** Meetings booked in the same window, for cost per meeting at campaign level. */
  meetings: number;
}

export interface AiSpendSummary {
  windowStart: Date;
  windowEnd: Date;
  totalUsd: number;
  totalCalls: number;
  failedCalls: number;
  /** Search/fetch credits — the research half of the bill, which is not token-priced. */
  searchCredits: number;
  byCampaign: CampaignSpend[];
  /** Spend that could not be tied to a campaign. Reported, never redistributed. */
  unattributedUsd: number;
}

export async function getAiSpend(
  tenantId: string,
  windowStart: Date,
  windowEnd: Date
): Promise<AiSpendSummary> {
  const calls = await prisma.aiCall.findMany({
    where: { tenantId, createdAt: { gte: windowStart, lte: windowEnd } },
    select: { leadId: true, estimatedCostUsd: true, searchCredits: true, status: true },
    take: 20_000,
  });

  let totalUsd = 0;
  let searchCredits = 0;
  let failedCalls = 0;
  const usdByLead = new Map<string, number>();
  const callsByLead = new Map<string, number>();
  let unattributedUsd = 0;

  for (const call of calls) {
    const usd = call.estimatedCostUsd ? Number(call.estimatedCostUsd) : 0;
    totalUsd += usd;
    searchCredits += call.searchCredits ?? 0;
    if (call.status !== 'ok') failedCalls += 1;

    if (call.leadId) {
      usdByLead.set(call.leadId, (usdByLead.get(call.leadId) ?? 0) + usd);
      callsByLead.set(call.leadId, (callsByLead.get(call.leadId) ?? 0) + 1);
    } else {
      unattributedUsd += usd;
    }
  }

  const leadIds = [...usdByLead.keys()];
  const leads = leadIds.length
    ? await prisma.lead.findMany({
        where: { id: { in: leadIds } },
        select: {
          id: true,
          campaignId: true,
          campaign: { select: { id: true, name: true, client: { select: { name: true } } } },
        },
      })
    : [];
  const leadCampaign = new Map(leads.map((l) => [l.id, l.campaign]));

  const byCampaign = new Map<string, CampaignSpend>();
  for (const [leadId, usd] of usdByLead) {
    const campaign = leadCampaign.get(leadId);
    if (!campaign) {
      // The lead is gone (archived away or deleted) but the spend happened. Keep it visible.
      unattributedUsd += usd;
      continue;
    }
    const entry = byCampaign.get(campaign.id) ?? {
      campaignId: campaign.id,
      campaignName: campaign.name,
      clientName: campaign.client?.name ?? null,
      usd: 0,
      calls: 0,
      meetings: 0,
    };
    entry.usd += usd;
    entry.calls += callsByLead.get(leadId) ?? 0;
    byCampaign.set(campaign.id, entry);
  }

  const campaignIds = [...byCampaign.keys()];
  if (campaignIds.length > 0) {
    const meetings = await prisma.meeting.groupBy({
      by: ['campaignId'],
      where: { campaignId: { in: campaignIds }, createdAt: { gte: windowStart, lte: windowEnd } },
      _count: { _all: true },
    });
    for (const m of meetings) {
      const entry = byCampaign.get(m.campaignId);
      if (entry) entry.meetings = m._count._all;
    }
  }

  return {
    windowStart,
    windowEnd,
    totalUsd: round(totalUsd),
    totalCalls: calls.length,
    failedCalls,
    searchCredits,
    byCampaign: [...byCampaign.values()]
      .map((c) => ({ ...c, usd: round(c.usd) }))
      .sort((a, b) => b.usd - a.usd),
    unattributedUsd: round(unattributedUsd),
  };
}

/**
 * Cost per meeting.
 *
 * Null rather than zero or infinity when there are no meetings: "we spent $40 and booked nothing"
 * is a different statement from "each meeting cost $0", and a dashboard that renders the second
 * when it means the first is lying by rounding.
 */
export function costPerMeeting(usd: number, meetings: number): number | null {
  if (meetings <= 0) return null;
  return round(usd / meetings);
}

const round = (n: number) => Math.round(n * 100) / 100;
