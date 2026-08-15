import { prisma } from '@/lib/prisma';
import type { WorkOrder } from '@prisma/client';
import { assessLaunchEligibility } from '@/lib/prospects/outreach';
import { isPersonalizationEnabled, type ApprovedStepCopy } from '@/lib/sequences/stepCopy';
import type { WorkOrderType } from './types';
import type { PlannedToolCall } from './execution';

/**
 * What each kind of work order actually does (Phase 7, extended by Phase 8a).
 *
 * This function **only returns planned tool calls**. It executes nothing, writes no evidence
 * and calls no provider. Execution goes through the one path there is:
 *
 * ```text
 * planWorkOrderSteps → executeWorkOrder → executeAgentAction → registered tool → domain service
 * ```
 *
 * ## Which types are planned, and which are still empty
 *
 * | Type | Planned since | What it plans |
 * |---|---|---|
 * | `research_batch` | Phase 7 | account + contact research |
 * | `prospect_batch` | Phase 8a | research, then a lead-quality assessment |
 * | `lead_quality_analysis` | Phase 8a | research when evidence is missing, then the assessment |
 * | `sequence_design` | Phase 8a | research when evidence is missing, then a grounded draft |
 * | `outreach_launch` | Phase 8a | enrollment into the campaign's active sequence |
 * | `followup`, `reengagement`, `reply_review` | — | `[]`, deliberately: 8b and 8d |
 * | `campaign_analysis` | — | `[]`, deliberately: no 8a acceptance requirement needs it |
 *
 * The empty ones are empty on purpose. A planner that returned "something reasonable" for a
 * type whose behaviour has not been designed would ship autonomous prospect work under a phase
 * whose scope excludes it — the same reasoning that kept Phase 6 from planning at all.
 *
 * ## Why research is conditional outside `research_batch`
 *
 * Re-running research that is already cached and fresh would be a paid call to learn what the
 * database already knows. The claim protocol would coalesce it, but the cheapest provider call
 * is the one not planned. `hasFreshResearch` reads the same cache rows the engine writes.
 */
export async function planWorkOrderSteps(order: WorkOrder): Promise<PlannedToolCall[]> {
  switch (order.type as WorkOrderType) {
    case 'research_batch':
      return planResearch(order, { force: true });
    case 'prospect_batch':
      return planProspectBatch(order);
    case 'lead_quality_analysis':
      return planLeadQualityAnalysis(order);
    case 'sequence_design':
      return planSequenceDesign(order);
    case 'outreach_launch':
      return planOutreachLaunch(order);
    default:
      return [];
  }
}

interface ResearchTargets {
  accountId: string | null;
  contactId: string | null;
}

/** The lead's account/contact links, only when the lead belongs to the order's tenant. */
async function resolveTargets(order: WorkOrder): Promise<ResearchTargets> {
  if (!order.leadId) return { accountId: null, contactId: null };

  const lead = await prisma.lead.findUnique({
    where: { id: order.leadId },
    select: { tenantId: true, accountId: true, contactId: true },
  });
  if (!lead || lead.tenantId !== order.tenantId) return { accountId: null, contactId: null };

  return { accountId: lead.accountId, contactId: lead.contactId };
}

async function planResearch(
  order: WorkOrder,
  options: { force: boolean }
): Promise<PlannedToolCall[]> {
  const { accountId, contactId } = await resolveTargets(order);
  const steps: PlannedToolCall[] = [];

  if (accountId && (options.force || !(await hasFreshAccountResearch(order.tenantId, accountId)))) {
    steps.push({ toolName: 'research_account', args: { accountId, depth: 'standard' } });
  }
  if (contactId && (options.force || !(await hasFreshContactResearch(order.tenantId, contactId)))) {
    steps.push({ toolName: 'research_contact', args: { contactId, depth: 'standard' } });
  }

  return steps;
}

async function planProspectBatch(order: WorkOrder): Promise<PlannedToolCall[]> {
  if (!order.leadId) return [];
  return [
    ...(await planResearch(order, { force: false })),
    { toolName: 'evaluate_lead_quality', args: { leadId: order.leadId } },
  ];
}

async function planLeadQualityAnalysis(order: WorkOrder): Promise<PlannedToolCall[]> {
  if (!order.leadId) return [];
  return [
    ...(await planResearch(order, { force: false })),
    { toolName: 'evaluate_lead_quality', args: { leadId: order.leadId } },
  ];
}

async function planSequenceDesign(order: WorkOrder): Promise<PlannedToolCall[]> {
  if (!order.leadId) return [];
  return [
    ...(await planResearch(order, { force: false })),
    { toolName: 'draft_sequence', args: { leadId: order.leadId, channel: 'email' } },
  ];
}

/**
 * Enrollment into the sequence the CRM already designates for this lead.
 *
 * **The agent does not choose which sequence a prospect receives.** `Lead.sequenceId` is that
 * choice, made by a human in the CRM, and this planner reads it. Two alternatives were
 * rejected: a payload column on `WorkOrder` would let whoever enqueued the job name any
 * sequence, and "the campaign's newest active sequence" would have the agent picking outreach
 * content by a heuristic nobody approved. `Sequence` carries no `campaignId`, so there is no
 * third CRM-authoritative answer to read.
 *
 * No designation means no step. An order with nothing to launch launches nothing.
 */
async function planOutreachLaunch(order: WorkOrder): Promise<PlannedToolCall[]> {
  if (!order.leadId) return [];

  const lead = await prisma.lead.findUnique({
    where: { id: order.leadId },
    select: { tenantId: true, sequenceId: true },
  });
  if (!lead || lead.tenantId !== order.tenantId || !lead.sequenceId) return [];

  const sequence = await prisma.sequence.findFirst({
    where: {
      id: lead.sequenceId,
      tenantId: order.tenantId,
      isActive: true,
      isArchived: false,
      steps: { some: {} },
    },
    select: { id: true },
  });
  if (!sequence) return [];

  // The launch's own gate, shared rather than re-implemented: a positive operating-state
  // allowlist plus the enrollment lifecycle, where `paused` counts as running. Planning a step
  // the launch would refuse only burns a tool call to learn what this already knows.
  const eligibility = await assessLaunchEligibility({
    tenantId: order.tenantId,
    leadId: order.leadId,
    sequenceId: sequence.id,
    workOrderId: order.id,
  });
  if (eligibility.mode === 'refused') return [];

  const approvedCopy = await approvedCopyForLaunch(order.tenantId, order.leadId, sequence.id);

  return [
    {
      toolName: 'enroll_lead_in_sequence',
      args: {
        leadId: order.leadId,
        sequenceId: sequence.id,
        ...(approvedCopy ? { approvedCopy } : {}),
      },
    },
  ];
}

/**
 * The stored draft, if it can stand as this cadence's approved copy — otherwise nothing.
 *
 * Reading, never generating: this function calls no provider, which is what lets the draft reach
 * the launch at all. `draftSequenceForLead` produced it under an earlier `sequence_design` order
 * and persisted it precisely so this read is possible.
 *
 * **All or nothing.** A draft that covers only some of the cadence's steps is not used at all.
 * Personalizing the steps that happen to line up and letting the rest fall back to their templates
 * would send a prospect a personalized opener and a generic follow-up, with nothing recording that
 * half the approval went unused — the silent substitution this whole path exists to prevent.
 */
async function approvedCopyForLaunch(
  tenantId: string,
  leadId: string,
  sequenceId: string
): Promise<ApprovedStepCopy[] | null> {
  // Writing personalized copy is opt-in per deployment. With it off, `launchAIOutreach` refuses a
  // launch that carries copy, so planning any here would turn every launch into a refusal.
  if (!isPersonalizationEnabled()) return null;

  const draft = await prisma.sequenceDraftRecord.findUnique({
    where: { tenantId_leadId: { tenantId, leadId } },
    select: { steps: true, aiGenerated: true },
  });
  if (!draft) return null;

  const steps = Array.isArray(draft.steps) ? (draft.steps as unknown as DraftStepShape[]) : [];
  if (steps.length === 0) return null;

  const cadence = await prisma.sequenceStep.findMany({
    where: { sequenceId, tenantId },
    select: { order: true, channel: true },
    orderBy: { order: 'asc' },
  });
  if (cadence.length !== steps.length) return null;

  const byOrder = new Map(steps.map((step) => [step.order, step]));
  const copy: ApprovedStepCopy[] = [];

  for (const step of cadence) {
    const drafted = byOrder.get(step.order);
    if (!drafted || drafted.channel !== step.channel || !drafted.body?.trim()) return null;

    copy.push({
      stepOrder: step.order,
      subject: drafted.subject ?? null,
      body: drafted.body,
      citedEvidenceIds: drafted.citedEvidenceIds ?? [],
      aiGenerated: draft.aiGenerated,
    });
  }

  return copy;
}

/** The persisted shape of a `SequenceDraftStep`, as it comes back out of the `steps` JSON column. */
interface DraftStepShape {
  order: number;
  channel: string;
  subject?: string | null;
  body: string;
  citedEvidenceIds?: string[];
}

async function hasFreshAccountResearch(tenantId: string, accountId: string): Promise<boolean> {
  const cache = await prisma.accountResearchCache.findUnique({
    where: { tenantId_accountId: { tenantId, accountId } },
    select: { status: true, expiresAt: true },
  });
  return isFresh(cache);
}

async function hasFreshContactResearch(tenantId: string, contactId: string): Promise<boolean> {
  const cache = await prisma.contactResearchCache.findUnique({
    where: { tenantId_contactId: { tenantId, contactId } },
    select: { status: true, expiresAt: true },
  });
  return isFresh(cache);
}

function isFresh(cache: { status: string; expiresAt: Date | null } | null): boolean {
  return !!cache && cache.status === 'completed' && !!cache.expiresAt && cache.expiresAt > new Date();
}
