import { prisma } from '@/lib/prisma';

/**
 * A/B variant performance, derived from what was actually sent (Task 9).
 *
 * ## Why this reads `OutboundMessage` rather than `AbTestVariant.sentCount`
 *
 * The running counters are a cache with no reconciliation behind them: a send that failed after
 * the increment, a variant deleted and recreated, or a counter bumped by an earlier code path all
 * leave them wrong, and nothing detects it. `OutboundMessage.abVariantId` is written in the same
 * statement that records the send, so a variant's send count is a `COUNT(*)` over rows that
 * demonstrably exist. The counters stay because existing surfaces read them; nothing here does.
 *
 * ## A variant is not a playbook version
 *
 * These are two independent axes and the report keeps them apart. A playbook version is the
 * policy the cadence ran under; a variant is which of two wordings a prospect received under it.
 * Reporting one as a grain of the other would make "variant B wins" and "the new playbook wins"
 * the same sentence, and they answer different questions to different people.
 *
 * ## Sends before attribution existed are absent, not zero
 *
 * Nothing was backfilled — see the migration. A variant whose sends all predate
 * `20260816000000_outbound_variant_attribution` reports `sent: 0`, which is the honest reading of
 * "no send is attributable to it" and is why `sentCountLegacy` is carried alongside: a manager
 * comparing a variant with 0 attributed sends against one with 400 needs to see that the first
 * number is missing evidence rather than a failed variant.
 */

/** Outcome kinds that count as a variant's result, and how they are reported. */
const OUTCOME_KINDS = {
  positive_reply: 'positiveReplies',
  reengagement_reply: 'reengagementReplies',
  meeting_booked: 'meetings',
  lead_rejected: 'rejections',
  objection_raised: 'objections',
} as const;

type OutcomeField = (typeof OUTCOME_KINDS)[keyof typeof OUTCOME_KINDS];

export interface VariantPerformance {
  variantId: string;
  /** "A" | "B". */
  version: string;
  templateId: string;
  templateName: string | null;
  /** Sends attributed to this variant. Delivery, not attempts. */
  sent: number;
  delivered: number;
  bounced: number;
  /** Any inbound the CRM linked to this lead after the send — not yet a judgement of it. */
  replies: number;
  positiveReplies: number;
  reengagementReplies: number;
  meetings: number;
  rejections: number;
  objections: number;
  /** The unreconciled counter, for comparison only. See the note above. */
  sentCountLegacy: number;
}

export interface VariantReportInput {
  tenantId: string;
  /** Restrict to one template's pair. Omit for every variant in the tenant. */
  templateId?: string;
  /** Restrict to sends inside a window. Outcomes are matched through their send, not this range. */
  since?: Date;
  until?: Date;
}

/**
 * Per-variant sends and outcomes.
 *
 * Returned as a flat list rather than an A/B pair: a template may carry one variant, or a variant
 * may have been added later, and a shape that assumes exactly two would have to invent the
 * missing one.
 */
export async function variantPerformance(
  input: VariantReportInput
): Promise<VariantPerformance[]> {
  const variants = await prisma.abTestVariant.findMany({
    where: {
      tenantId: input.tenantId,
      ...(input.templateId ? { templateId: input.templateId } : {}),
    },
    select: {
      id: true,
      version: true,
      templateId: true,
      sentCount: true,
      template: { select: { name: true } },
    },
    orderBy: [{ templateId: 'asc' }, { version: 'asc' }],
  });
  if (variants.length === 0) return [];

  const variantIds = variants.map((v) => v.id);
  const sentWindow =
    input.since || input.until
      ? { sentAt: { ...(input.since ? { gte: input.since } : {}), ...(input.until ? { lte: input.until } : {}) } }
      : {};

  // Grouped in the database rather than counted in a loop: one variant pair on a busy campaign is
  // tens of thousands of rows, and a per-variant round trip would make the report O(variants) in
  // queries for a value a single GROUP BY already has.
  const sends = await prisma.outboundMessage.groupBy({
    by: ['abVariantId', 'status'],
    where: { tenantId: input.tenantId, abVariantId: { in: variantIds }, ...sentWindow },
    _count: { _all: true },
  });

  const replies = await prisma.outboundMessage.groupBy({
    by: ['abVariantId'],
    where: {
      tenantId: input.tenantId,
      abVariantId: { in: variantIds },
      repliedAt: { not: null },
      ...sentWindow,
    },
    _count: { _all: true },
  });

  const outcomes = await prisma.outcomeSignal.groupBy({
    by: ['abVariantId', 'kind'],
    where: {
      tenantId: input.tenantId,
      abVariantId: { in: variantIds },
      kind: { in: Object.keys(OUTCOME_KINDS) as Array<keyof typeof OUTCOME_KINDS> },
    },
    _count: { _all: true },
  });

  const rows = new Map<string, VariantPerformance>(
    variants.map((v) => [
      v.id,
      {
        variantId: v.id,
        version: v.version,
        templateId: v.templateId,
        templateName: v.template?.name ?? null,
        sent: 0,
        delivered: 0,
        bounced: 0,
        replies: 0,
        positiveReplies: 0,
        reengagementReplies: 0,
        meetings: 0,
        rejections: 0,
        objections: 0,
        sentCountLegacy: v.sentCount,
      },
    ])
  );

  for (const group of sends) {
    const row = group.abVariantId ? rows.get(group.abVariantId) : undefined;
    if (!row) continue;
    const count = group._count._all;
    // `sent` counts every attributed message including the ones that failed, because the
    // experiment did assign them a variant; `delivered` is the subset the provider accepted.
    row.sent += count;
    if (group.status === 'sent') row.delivered += count;
    if (group.status === 'bounced') row.bounced += count;
  }

  for (const group of replies) {
    const row = group.abVariantId ? rows.get(group.abVariantId) : undefined;
    if (row) row.replies += group._count._all;
  }

  for (const group of outcomes) {
    const row = group.abVariantId ? rows.get(group.abVariantId) : undefined;
    if (!row) continue;
    const field: OutcomeField | undefined = OUTCOME_KINDS[group.kind as keyof typeof OUTCOME_KINDS];
    if (field) row[field] += group._count._all;
  }

  return [...rows.values()];
}
