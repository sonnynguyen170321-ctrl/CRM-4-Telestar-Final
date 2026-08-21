import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, getVisibleUserIds } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';
import { evaluateReengagementEligibility } from '@/lib/prospects/reengagement';

/**
 * The escape hatch for whoever is presenting.
 *
 * One request that answers "what is this prospect's actual state" without opening a database
 * client mid-demo: operating state, enrollment, current task, work orders, agent actions,
 * approvals, reply classification, job runs and the latest activity.
 *
 * Read-only, tenant-scoped by the session, and deliberately unstyled — a debugging tool, not a
 * customer surface.
 *
 * Restricted to the demo tenant, like `demo/inbound-reply`, so a debugging escape hatch cannot
 * be pointed at a real client's prospects. It previously had no such restriction and was the
 * only route under `demo/` readable against a live tenant (TEL-P1-029).
 *
 * Scoped to what the caller may already see, because refusing a lead only on tenant is
 * capability authorization, not object authorization: it let one SDR read another SDR's
 * prospect, including agent actions, approvals and reply classification.
 */
const DEMO_TENANT_ID = 'demo-telestar';

export async function GET(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  if (user.tenantId !== DEMO_TENANT_ID) {
    return NextResponse.json({ error: 'Available in the demo tenant only' }, { status: 403 });
  }

  const leadId = req.nextUrl.searchParams.get('leadId');
  if (!leadId) return NextResponse.json({ error: 'leadId is required' }, { status: 400 });

  try {
    const tenantId = user.tenantId as string;
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true, tenantId: true, assignedToId: true,
        firstName: true, lastName: true, company: true,
        operatingState: true, operatingStateAt: true, stage: true,
        sequenceId: true, sequenceStep: true, sequenceStatus: true, nextTaskDue: true,
      },
    });
    if (!lead || lead.tenantId !== tenantId) {
      return NextResponse.json({ error: 'Prospect not found' }, { status: 404 });
    }

    // Object authorization. `null` means unrestricted (director); anyone else may only
    // diagnose a prospect they could already see. Same 404 as a missing lead, so this does not
    // become an oracle for which lead ids exist.
    const visibleUserIds = await getVisibleUserIds(user);
    if (visibleUserIds !== null && !visibleUserIds.includes(lead.assignedToId)) {
      return NextResponse.json({ error: 'Prospect not found' }, { status: 404 });
    }

    const [
      enrollments,
      tasks,
      workOrders,
      actions,
      approvals,
      inbound,
      jobRuns,
      activities,
      transitions,
      outbound,
      stepCopy,
      draft,
      poolItem,
      evidence,
    ] = await Promise.all([
        prisma.sequenceEnrollment.findMany({
          where: { tenantId, leadId },
          orderBy: { startedAt: 'desc' },
          select: {
            id: true, sequenceId: true, status: true, currentStep: true, occupancyKey: true,
            pausedReason: true, nextActionAt: true, lastTransitionAt: true, lastEvaluatedAt: true,
          },
        }),
        prisma.task.findMany({
          where: { tenantId, leadId },
          orderBy: { dueDate: 'desc' },
          take: 10,
          select: {
            id: true, type: true, status: true, dueDate: true, lockedAt: true,
            sequenceStep: true, priority: true, title: true,
          },
        }),
        prisma.workOrder.findMany({
          where: { tenantId, leadId },
          orderBy: { createdAt: 'desc' },
          select: { id: true, type: true, status: true, pausedReason: true, activatedAt: true, completedAt: true },
        }),
        prisma.agentAction.findMany({
          where: { tenantId, leadId },
          orderBy: { createdAt: 'desc' },
          take: 15,
          select: { id: true, tool: true, capability: true, status: true, createdAt: true },
        }),
        prisma.agentApprovalRequest.findMany({
          where: { tenantId, leadId },
          orderBy: { createdAt: 'desc' },
          select: { id: true, capability: true, toolName: true, status: true, requiredLevel: true },
        }),
        prisma.inboundMessage.findMany({
          where: { tenantId, leadId },
          orderBy: { date: 'desc' },
          take: 10,
          select: {
            providerMessageId: true, date: true, subject: true, isReply: true,
            replyClass: true, replyKind: true, replyConfidence: true, classificationSource: true,
          },
        }),
        prisma.jobRun.findMany({
          where: { tenantId },
          orderBy: { enqueuedAt: 'desc' },
          take: 10,
          select: { id: true, jobName: true, status: true, attempts: true, enqueuedAt: true, failedReason: true },
        }),
        prisma.activity.findMany({
          where: { tenantId, leadId },
          orderBy: { createdAt: 'desc' },
          take: 15,
          select: { createdAt: true, type: true, description: true },
        }),
        prisma.prospectTransition.findMany({
          where: { tenantId, leadId },
          orderBy: { createdAt: 'desc' },
          select: { kind: true, fromState: true, toState: true, status: true, createdAt: true },
        }),
        // The send record. `subject`/`body` are included deliberately: the one question a
        // personalized cadence has to answer is whether the words a human approved are the words
        // that went out, and no other surface exposes what was actually rendered.
        prisma.outboundMessage.findMany({
          where: { tenantId, leadId },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true, status: true, subject: true, body: true, to: true, templateId: true,
            abVariantId: true, sequenceId: true, sequenceStepOrder: true, sentAt: true,
            repliedAt: true, bouncedAt: true, createdAt: true,
          },
        }),
        // Approved per-occurrence copy, so "durable before executable" is observable rather than
        // inferred from the message that happened to be sent.
        prisma.sequenceStepCopy.findMany({
          where: { tenantId, enrollment: { leadId } },
          orderBy: { stepOrder: 'asc' },
          select: {
            id: true, enrollmentId: true, stepOrder: true, subject: true, body: true,
            aiGenerated: true, approvedById: true, approvedAt: true, citedEvidenceIds: true,
          },
        }),
        prisma.sequenceDraftRecord.findUnique({
          where: { tenantId_leadId: { tenantId, leadId } },
          select: {
            id: true, channel: true, steps: true, grounded: true, groundingReason: true,
            aiGenerated: true, citedEvidenceIds: true, workOrderId: true, updatedAt: true,
          },
        }),
        // Where this prospect came from. Null for a lead that never went through the pool.
        prisma.leadPoolItem.findFirst({
          where: { tenantId, convertedLeadId: leadId },
          select: {
            id: true, status: true, qualification: true, sourceType: true, sourceName: true,
            assignedCampaignId: true, assignedSdrId: true, qualifiedById: true, qualifiedAt: true,
            convertedLeadId: true, createdAt: true, updatedAt: true,
          },
        }),
        prisma.companySignal.findMany({
          where: { tenantId, account: { leads: { some: { id: leadId } } } },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { id: true, signalType: true, summary: true, sourceUrl: true, observedAt: true },
        }),
      ]);

    const eligibility = await evaluateReengagementEligibility({ tenantId, leadId });

    return NextResponse.json({
      lead,
      enrollments,
      tasks,
      workOrders,
      agentActions: actions,
      approvals,
      inboundMessages: inbound,
      jobRuns,
      activities,
      transitions,
      outboundMessages: outbound,
      stepCopy,
      sequenceDraft: draft,
      poolItem,
      evidence,
      reengagementEligibility: eligibility,
    });
  } catch (err) {
    return handleApiError('api/demo/diagnostics GET', err);
  }
}
