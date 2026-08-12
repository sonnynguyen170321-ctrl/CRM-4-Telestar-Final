import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
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
 */
export async function GET(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const leadId = req.nextUrl.searchParams.get('leadId');
  if (!leadId) return NextResponse.json({ error: 'leadId is required' }, { status: 400 });

  try {
    const tenantId = user.tenantId as string;
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true, tenantId: true, firstName: true, lastName: true, company: true,
        operatingState: true, operatingStateAt: true, stage: true,
        sequenceId: true, sequenceStep: true, sequenceStatus: true, nextTaskDue: true,
      },
    });
    if (!lead || lead.tenantId !== tenantId) {
      return NextResponse.json({ error: 'Prospect not found' }, { status: 404 });
    }

    const [enrollments, tasks, workOrders, actions, approvals, inbound, jobRuns, activities, transitions] =
      await Promise.all([
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
      reengagementEligibility: eligibility,
    });
  } catch (err) {
    return handleApiError('api/demo/diagnostics GET', err);
  }
}
