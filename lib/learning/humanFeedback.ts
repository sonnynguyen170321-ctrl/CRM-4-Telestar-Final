import { prisma } from '@/lib/prisma';
import { versionActiveAt } from '@/lib/playbooks/versions';
import {
  DRAFT_ACCEPTED_THRESHOLD, draftRetention, recordOutcomeSignal,
} from './signals';
import type { OutcomeSignal } from '@prisma/client';

/**
 * The two signals no CRM row produces on its own (Phase 10).
 *
 * "Did the rep use the draft" and "was this research any good" are judgements only the human in
 * front of the screen can make, so they are recorded at the moment the human makes them rather
 * than inferred later. Both are deliberately cheap actions in the UI — a rep who has to fill in a
 * form to give feedback gives none.
 *
 * Neither writes anything a prospect can see. This module records observations; it does not send,
 * enroll or change policy.
 */

export interface DraftOutcomeInput {
  tenantId: string;
  leadId: string;
  userId: string;
  /** What AI suggested. */
  draft: string;
  /** What the rep actually intends to send. */
  sent: string;
  /** Distinguishes one draft decision from the next on the same prospect. */
  occurrenceKey: string;
}

/**
 * Record whether an AI draft survived contact with the rep.
 *
 * The retention measure is deterministic and reproducible — a manager reading a proposal built on
 * these signals can recompute it. A model scoring its own draft would be the least trustworthy
 * number in the chain.
 */
export async function recordDraftOutcome(input: DraftOutcomeInput): Promise<OutcomeSignal> {
  const retention = draftRetention(input.draft, input.sent);
  const accepted = retention >= DRAFT_ACCEPTED_THRESHOLD;

  const lead = await prisma.lead.findFirst({
    where: { id: input.leadId, tenantId: input.tenantId },
    select: { campaignId: true, sequenceId: true },
  });

  return recordOutcomeSignal({
    tenantId: input.tenantId,
    signalKey: `draft:${input.leadId}:${input.occurrenceKey}`,
    kind: accepted ? 'draft_accepted' : 'draft_edited',
    // A rewritten draft is a negative signal about the guidance, not about the rep.
    direction: accepted ? 1 : -1,
    occurredAt: new Date(),
    leadId: input.leadId,
    campaignId: lead?.campaignId ?? null,
    sequenceId: lead?.sequenceId ?? null,
    playbookVersionId: await activeVersionFor(input.tenantId, lead?.campaignId ?? null),
    actorUserId: input.userId,
    detail: accepted
      ? 'A suggested reply was sent essentially as written.'
      : 'A suggested reply was substantially rewritten before sending.',
    metadata: { retention },
  });
}

export interface ResearchFeedbackInput {
  tenantId: string;
  leadId: string;
  userId: string;
  /** The evidence row the human is judging. */
  evidenceKey: string;
  reason?: string | null;
}

/** A human says the research behind an outreach was not worth using. */
export async function recordResearchIrrelevant(input: ResearchFeedbackInput): Promise<OutcomeSignal> {
  const lead = await prisma.lead.findFirst({
    where: { id: input.leadId, tenantId: input.tenantId },
    select: { campaignId: true, sequenceId: true },
  });

  return recordOutcomeSignal({
    tenantId: input.tenantId,
    signalKey: `research-irrelevant:${input.leadId}:${input.evidenceKey}`,
    kind: 'research_irrelevant',
    direction: -1,
    occurredAt: new Date(),
    leadId: input.leadId,
    campaignId: lead?.campaignId ?? null,
    sequenceId: lead?.sequenceId ?? null,
    playbookVersionId: await activeVersionFor(input.tenantId, lead?.campaignId ?? null),
    actorUserId: input.userId,
    detail: input.reason?.trim()
      ? `Research marked not useful: ${input.reason.trim().slice(0, 400)}`
      : 'Research evidence marked not useful by the rep working the prospect.',
  });
}

async function activeVersionFor(tenantId: string, campaignId: string | null): Promise<string | null> {
  if (!campaignId) return null;
  const playbook = await prisma.campaignPlaybook.findUnique({
    where: { campaignId },
    select: { id: true },
  });
  if (!playbook) return null;
  const version = await versionActiveAt(playbook.id, tenantId, new Date());
  return version?.id ?? null;
}
