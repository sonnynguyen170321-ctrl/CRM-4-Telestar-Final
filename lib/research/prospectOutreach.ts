import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/auth';
import {
  markProspectResearching,
  markProspectReadyForOutreach,
} from '@/lib/prospects/prospecting';
import { draftSequenceForLead, type DraftChannel, type SequenceDraft } from './sequenceDrafts';

/**
 * Outreach preparation (Phase 8a) — drafting plus the readiness move that goes with it.
 *
 * It sits beside the drafting it orchestrates rather than in `lib/prospects/`, for the reason
 * stated in `sequenceDrafts.ts`: this path depends on `lib/ai`, and `lib/prospects/` is core
 * CRM that has to survive an AI outage. Its sibling `launchAIOutreach` has no AI dependency and
 * stays in `lib/prospects/outreach.ts` — that split is the invariant, not an accident of layout.
 *
 * Everything here is internal. Nothing reaches the prospect; activation is a separate,
 * approval-gated operation.
 */

export interface PrepareOutreachInput {
  tenantId: string;
  leadId: string;
  /** Idempotency identity for the transitions, and provenance for the audit trail. */
  workOrderId: string;
  actorUserId: string;
  channel?: DraftChannel;
  /** Provenance for the generation's AiCall row. */
  agentActionId?: string | null;
}

export interface PrepareOutreachResult {
  draft: SequenceDraft;
  /** The prospect's operating state after preparation. */
  state: string;
  /** True when the draft was grounded and the prospect advanced to `ready_for_outreach`. */
  readyForOutreach: boolean;
}

/**
 * Draft outreach and advance the prospect's readiness.
 *
 * An ungrounded draft does **not** advance the prospect. "Ready for outreach" claims there is
 * something real to say, and a draft with no evidence behind it is exactly the case a human
 * should look at before anything is launched.
 */
export async function prepareProspectOutreach(
  user: SessionUser,
  input: PrepareOutreachInput
): Promise<PrepareOutreachResult> {
  const lead = await prisma.lead.findUnique({
    where: { id: input.leadId },
    select: { tenantId: true, operatingState: true },
  });
  if (!lead || lead.tenantId !== input.tenantId) {
    throw new Error(`Lead ${input.leadId} not found in tenant ${input.tenantId}`);
  }

  // Authorization is the draft service's: it runs `canAccessLead` before reading anything and
  // throws if the caller may not touch this lead. Drafting first means an unauthorized caller
  // cannot move a prospect's state as a side effect of being refused.
  const draft = await draftSequenceForLead(user, {
    tenantId: input.tenantId,
    leadId: input.leadId,
    channel: input.channel,
    workOrderId: input.workOrderId,
    agentActionId: input.agentActionId,
  });

  if (lead.operatingState === 'unassigned') {
    await markProspectResearching({
      leadId: input.leadId,
      tenantId: input.tenantId,
      workOrderId: input.workOrderId,
      actorUserId: input.actorUserId,
    });
  }

  if (!draft.grounded) {
    const current = await prisma.lead.findUnique({
      where: { id: input.leadId },
      select: { operatingState: true },
    });
    return { draft, state: current?.operatingState ?? lead.operatingState, readyForOutreach: false };
  }

  const transition = await markProspectReadyForOutreach({
    leadId: input.leadId,
    tenantId: input.tenantId,
    workOrderId: input.workOrderId,
    actorUserId: input.actorUserId,
  });

  return { draft, state: transition.state, readyForOutreach: true };
}
