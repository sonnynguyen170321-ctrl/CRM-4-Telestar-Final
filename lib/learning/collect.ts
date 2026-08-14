import { prisma } from '@/lib/prisma';
import { versionActiveAt } from '@/lib/playbooks/versions';
import { recordOutcomeSignal, type SignalDirection, type SignalKind } from './signals';

/**
 * Turn what the CRM already recorded into durable outcome signals (Phase 10).
 *
 * ## Why this reads rather than hooks
 *
 * The obvious design is to fire a signal from the reply chokepoint, the meeting service and the
 * leadgen qualifier. That spreads Phase 10 across code owned by other parts of the system, and
 * every one of those call sites becomes a place a future edit can silently stop producing
 * evidence. Reading the rows those services already write is idempotent, needs no cooperation,
 * and cannot break the path it observes: **AI down must never mean CRM down**, and learning is
 * the most optional thing in the product.
 *
 * The two signals with no CRM row behind them — a draft being accepted or rewritten — are
 * recorded at the moment they happen, by the SDR's own action, in `lib/learning/draftOutcome.ts`.
 *
 * Every signal is attributed to the playbook version that was in force when the outcome happened,
 * via the Phase 4 activation window. That is what makes "did the new policy do better" a question
 * with an answer.
 */

export interface CollectionResult {
  scanned: number;
  recorded: number;
  byKind: Record<string, number>;
}

/** How far back a collection pass looks. Older outcomes were collected by an earlier pass. */
const LOOKBACK_DAYS = 90;

export async function collectOutcomeSignals(
  tenantId: string,
  now: Date = new Date()
): Promise<CollectionResult> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
  const result: CollectionResult = { scanned: 0, recorded: 0, byKind: {} };

  const versionCache = new Map<string, string | null>();
  /**
   * Which policy was in force for this campaign when the outcome happened.
   *
   * Cached per campaign+day rather than per row: a campaign's active version changes at most a
   * handful of times, and asking the database once per reply would make collection O(replies) in
   * round trips for a value that is nearly constant.
   */
  const versionFor = async (campaignId: string | null, at: Date): Promise<string | null> => {
    if (!campaignId) return null;
    const key = `${campaignId}:${at.toISOString().slice(0, 10)}`;
    if (versionCache.has(key)) return versionCache.get(key) ?? null;

    const playbook = await prisma.campaignPlaybook.findUnique({
      where: { campaignId },
      select: { id: true },
    });
    const version = playbook ? await versionActiveAt(playbook.id, tenantId, at) : null;
    versionCache.set(key, version?.id ?? null);
    return version?.id ?? null;
  };

  /**
   * The A/B variant the prospect was answering, or null.
   *
   * The message they were replying to is the last one actually sent to them at or before the
   * outcome — `InboundMessage` carries no reference to the outbound it answers, and adding a
   * threading store to satisfy a report would be the second system this initiative keeps
   * refusing. Recency within the lead is the same correlation a human reading the thread would
   * make, and it degrades honestly: a send with no variant attributes to none, and a lead with no
   * variant-carrying send attributes to none rather than to a guess.
   *
   * This is a *read* of what the send path already recorded. Nothing here recomputes the
   * selection — a recomputed variant would be this pass's opinion, not what was sent.
   */
  const variantFor = async (leadId: string | null | undefined, at: Date): Promise<string | null> => {
    if (!leadId) return null;
    const send = await prisma.outboundMessage.findFirst({
      where: { tenantId, leadId, abVariantId: { not: null }, sentAt: { not: null, lte: at } },
      orderBy: { sentAt: 'desc' },
      select: { abVariantId: true },
    });
    return send?.abVariantId ?? null;
  };

  const record = async (
    kind: SignalKind,
    direction: SignalDirection,
    signalKey: string,
    occurredAt: Date,
    fields: {
      leadId?: string | null;
      campaignId?: string | null;
      sequenceId?: string | null;
      actorUserId?: string | null;
      detail: string;
      metadata?: Record<string, unknown>;
    }
  ) => {
    await recordOutcomeSignal({
      tenantId,
      signalKey,
      kind,
      direction,
      occurredAt,
      playbookVersionId: await versionFor(fields.campaignId ?? null, occurredAt),
      abVariantId: await variantFor(fields.leadId, occurredAt),
      ...fields,
    });
    result.recorded += 1;
    result.byKind[kind] = (result.byKind[kind] ?? 0) + 1;
  };

  // ─── replies the CRM classified as a sales conversation ───
  const replies = await prisma.inboundMessage.findMany({
    where: { tenantId, date: { gte: since }, replyClass: { in: ['A', 'C'] }, leadId: { not: null } },
    orderBy: { date: 'desc' },
    take: 2000,
    select: {
      id: true, date: true, replyClass: true, replyKind: true, leadId: true,
      lead: { select: { campaignId: true, sequenceId: true, operatingState: true } },
    },
  });
  result.scanned += replies.length;

  /**
   * When AI was handed a prospect back, per lead.
   *
   * A reply counts as a *re-engagement* reply when the prospect had already been handed back for
   * follow-up before it arrived. Reading the prospect's current state instead would be wrong in
   * both directions: a prospect who has since moved to a meeting would stop counting, and one who
   * happens to be sitting in an eligible state today would start counting for a reply that
   * predates it.
   */
  const handbacks = await prisma.prospectTransition.findMany({
    where: {
      tenantId,
      kind: { in: ['handback', 'ai_reengagement_started'] },
      leadId: { in: replies.map((r) => r.leadId!).filter(Boolean) },
    },
    select: { leadId: true, createdAt: true },
  });
  const firstHandback = new Map<string, Date>();
  for (const t of handbacks) {
    const seen = firstHandback.get(t.leadId);
    if (!seen || t.createdAt < seen) firstHandback.set(t.leadId, t.createdAt);
  }

  for (const reply of replies) {
    if (!reply.leadId || !reply.lead) continue;
    const shared = {
      leadId: reply.leadId,
      campaignId: reply.lead.campaignId,
      sequenceId: reply.lead.sequenceId,
    };

    if (reply.replyClass === 'C') {
      // A prospect who was re-engaged and answered is the strongest evidence the loop produces:
      // it says the follow-up was worth sending, which is exactly what a playbook decides.
      const handedBackAt = firstHandback.get(reply.leadId);
      const isReengagement = Boolean(handedBackAt && handedBackAt <= reply.date);
      await record(
        isReengagement ? 'reengagement_reply' : 'positive_reply',
        1,
        `reply:${reply.id}`,
        reply.date,
        { ...shared, detail: isReengagement ? 'A re-engagement follow-up produced a reply.' : 'The prospect replied and wanted to talk.' }
      );

      if (reply.replyKind === 'objection') {
        await record('objection_raised', 0, `objection:${reply.id}`, reply.date, {
          ...shared,
          detail: 'The prospect raised an objection rather than agreeing outright.',
        });
      }
    }

    if (reply.replyClass === 'A') {
      await record('lead_rejected', -1, `rejected-reply:${reply.id}`, reply.date, {
        ...shared,
        detail:
          reply.replyKind === 'unsubscribe'
            ? 'The prospect asked to stop being contacted.'
            : 'The prospect said no.',
      });
    }
  }

  // ─── meetings ───
  const meetings = await prisma.meeting.findMany({
    where: { tenantId, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: 1000,
    select: { id: true, createdAt: true, leadId: true, campaignId: true, sdrId: true, lead: { select: { sequenceId: true } } },
  });
  result.scanned += meetings.length;

  for (const meeting of meetings) {
    await record('meeting_booked', 1, `meeting:${meeting.id}`, meeting.createdAt, {
      leadId: meeting.leadId,
      campaignId: meeting.campaignId,
      sequenceId: meeting.lead?.sequenceId ?? null,
      actorUserId: meeting.sdrId,
      detail: 'A meeting was booked with this prospect.',
    });
  }

  // ─── supply the floor turned away ───
  const rejected = await prisma.leadPoolItem.findMany({
    where: { tenantId, status: 'disqualified', updatedAt: { gte: since }, disqualifiedReason: { not: null } },
    orderBy: { updatedAt: 'desc' },
    take: 1000,
    select: { id: true, updatedAt: true, disqualifiedReason: true, assignedCampaignId: true, convertedLeadId: true },
  });
  result.scanned += rejected.length;

  for (const item of rejected) {
    await record('lead_rejected', -1, `pool-rejected:${item.id}`, item.updatedAt, {
      leadId: item.convertedLeadId,
      campaignId: item.assignedCampaignId,
      detail: `A sourced contact was rejected: ${(item.disqualifiedReason ?? '').replace(/_/g, ' ')}.`,
      metadata: { reason: item.disqualifiedReason },
    });
  }

  return result;
}
