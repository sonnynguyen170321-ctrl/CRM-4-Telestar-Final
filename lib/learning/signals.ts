import { prisma } from '@/lib/prisma';
import type { OutcomeSignal, OutcomeSignalKind } from '@prisma/client';

/**
 * Durable outcome signals (Revenue AI Phase 10).
 *
 * The evidence layer. Everything a proposal later claims must point at rows written here, and
 * every row here is something that demonstrably happened in the CRM — a reply that arrived, a
 * meeting that was booked, a draft a rep used or rewrote. Nothing in this module produces an
 * opinion, a score or a model judgement.
 *
 * ## Idempotency is the whole design
 *
 * `signalKey` identifies the *occurrence*, not the write. Collection runs repeatedly — on demand
 * from a manager surface, and again the next time someone opens it — and a second pass over the
 * same reply must find the same row rather than doubling the support behind a proposal. A
 * proposal whose evidence count grows because someone refreshed a page is not evidence.
 */

export type SignalKind = OutcomeSignalKind;

/** What the signal says. Bounded to three values on purpose — this is not a score. */
export type SignalDirection = 1 | 0 | -1;

export interface RecordSignalInput {
  tenantId: string;
  signalKey: string;
  kind: SignalKind;
  direction: SignalDirection;
  occurredAt: Date;
  leadId?: string | null;
  campaignId?: string | null;
  sequenceId?: string | null;
  playbookVersionId?: string | null;
  /** The A/B variant the prospect was answering, when the outcome traces to one. */
  abVariantId?: string | null;
  actorUserId?: string | null;
  detail?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Record one observed outcome, once.
 *
 * The update branch deliberately refreshes only the descriptive fields. `signalKey`, `kind` and
 * `occurredAt` identify the occurrence and re-writing them would let a later pass silently
 * redefine what an already-cited piece of evidence was.
 */
export async function recordOutcomeSignal(input: RecordSignalInput): Promise<OutcomeSignal> {
  return prisma.outcomeSignal.upsert({
    where: { tenantId_signalKey: { tenantId: input.tenantId, signalKey: input.signalKey } },
    create: {
      tenantId: input.tenantId,
      signalKey: input.signalKey,
      kind: input.kind,
      direction: input.direction,
      occurredAt: input.occurredAt,
      leadId: input.leadId ?? null,
      campaignId: input.campaignId ?? null,
      sequenceId: input.sequenceId ?? null,
      playbookVersionId: input.playbookVersionId ?? null,
      abVariantId: input.abVariantId ?? null,
      actorUserId: input.actorUserId ?? null,
      detail: input.detail ?? null,
      metadata: (input.metadata ?? undefined) as never,
    },
    update: {
      detail: input.detail ?? null,
      playbookVersionId: input.playbookVersionId ?? null,
      // Refreshed with the other descriptive fields: an early pass can run before the send that
      // caused the outcome has been matched to it, and the attribution is not part of the row's
      // identity the way `signalKey`, `kind` and `occurredAt` are.
      abVariantId: input.abVariantId ?? null,
      metadata: (input.metadata ?? undefined) as never,
    },
  });
}

/**
 * How much of an AI draft survived to the message that was sent.
 *
 * Character-level similarity, not semantic: the question is "did the rep have to rewrite this",
 * and a cheap deterministic measure a person can reproduce beats a model judging its own work.
 * Returns 0..1 where 1 is byte-identical.
 */
export function draftRetention(draft: string, sent: string): number {
  const a = normalise(draft);
  const b = normalise(sent);
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  // Token overlap rather than edit distance: an SDR who reorders two sentences has not rewritten
  // the draft, and Levenshtein would say they had.
  const aTokens = new Set(a.split(' '));
  const bTokens = b.split(' ');
  let matched = 0;
  for (const token of bTokens) if (aTokens.has(token)) matched += 1;
  return Math.min(1, Math.round((matched / Math.max(aTokens.size, bTokens.length)) * 100) / 100);
}

/** Above this, the draft was used. Below it, the rep rewrote it and the draft was not good enough. */
export const DRAFT_ACCEPTED_THRESHOLD = 0.7;

const normalise = (text: string) =>
  text.toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').trim();
