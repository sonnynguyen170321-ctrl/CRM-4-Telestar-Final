import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, getLeadWhereScope } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { getEmailAccountScope, emailAccountWhere } from '@/lib/email-health/access';
import { deriveOperatorReason } from '@/lib/automation/operatorState';

export const dynamic = 'force-dynamic';

/** How many in-flight cadences the operator view explains at once. */
const WAITING_PAGE_SIZE = 50;

export async function GET(_req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    // This route previously returned every active mailbox in the tenant to any
    // authenticated caller, SDRs included. Mailboxes are now scoped to the
    // viewer's pod, matching the deliverability module.
    const scope = await getEmailAccountScope(user);
    const accountScopeWhere = emailAccountWhere(scope);
    // 1. Fetch KPI metrics
    const [totalActiveSequences, totalPendingOutbound, totalActiveAccounts] = await Promise.all([
      prisma.lead.count({
        where: {
          sequenceId: { not: null },
          sequenceStatus: 'active',
        },
      }),
      prisma.task.count({
        where: {
          status: 'pending',
          type: 'email',
          sequenceId: { not: null },
        },
      }),
      prisma.emailAccount.count({
        where: {
          isActive: true,
          ...accountScopeWhere,
        },
      }),
    ]);

    // 2. Fetch email account statuses (active only; exclude credential fields)
    const rawEmailAccounts = await prisma.emailAccount.findMany({
      where: { isActive: true, ...accountScopeWhere },
      orderBy: { email: 'asc' },
      select: {
        id: true,
        email: true,
        provider: true,
        isActive: true,
        lastSyncAt: true,
        dailySendCount: true,
        dailyCap: true,
        dailySendDate: true,
        hourlySendWindow: true,
        imapServer: true,
        smtpServer: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const emailAccounts = rawEmailAccounts.map(account => {
      const isNewDay = !account.dailySendDate || account.dailySendDate < today;
      return {
        ...account,
        dailySendCount: isNewDay ? 0 : account.dailySendCount,
      };
    });

    // 3. Fetch recent automation activity logs.
    //    `sequence_deferred` belongs here: a deferral is the most common thing the engine does
    //    that an operator has to explain, and filtering it out made every deferral invisible on
    //    this page while it sat in the database.
    const activities = await prisma.activity.findMany({
      where: {
        type: {
          in: [
            'email_sent',
            'sequence_enrolled',
            'sequence_completed',
            'sequence_unenrolled',
            'sequence_deferred',
            'stage_changed',
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 15,
      include: {
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            company: true,
          },
        },
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    // 4. Explain every in-flight cadence the viewer is allowed to see.
    //
    //    Scoped through `getLeadWhereScope`, the same helper the leads and analytics surfaces
    //    use — an SDR must not learn about a pod-mate's prospects by way of the automation page.
    const leadScope = await getLeadWhereScope(user);
    const enrollments = await prisma.sequenceEnrollment.findMany({
      where: {
        status: { in: ['active', 'paused'] },
        lead: leadScope,
      },
      orderBy: [{ nextActionAt: 'asc' }],
      take: WAITING_PAGE_SIZE,
      select: {
        id: true,
        status: true,
        currentStep: true,
        nextActionAt: true,
        pausedReason: true,
        sequenceId: true,
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            company: true,
            assignedToId: true,
          },
        },
        sequence: { select: { id: true, name: true } },
      },
    });

    // The current step's task and the assignee's mailbox, fetched once for the whole page
    // rather than per row — this list is rendered on every operator refresh.
    const leadIds = enrollments.map((e) => e.lead.id);
    const assigneeIds = [
      ...new Set(enrollments.map((e) => e.lead.assignedToId).filter(Boolean) as string[]),
    ];

    const [stepTasks, assigneeAccounts] = await Promise.all([
      leadIds.length
        ? prisma.task.findMany({
            where: { leadId: { in: leadIds }, sequenceId: { not: null }, status: 'pending' },
            select: { leadId: true, sequenceId: true, sequenceStep: true, status: true, dueDate: true },
          })
        : Promise.resolve([]),
      assigneeIds.length
        ? prisma.emailAccount.findMany({
            where: { userId: { in: assigneeIds }, isActive: true },
            select: {
              userId: true,
              isActive: true,
              sendPausedAt: true,
              dailyCap: true,
              dailySendCount: true,
              dailySendDate: true,
              healthLevel: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const accountByUser = new Map(assigneeAccounts.map((a) => [a.userId, a]));

    const waiting = enrollments.map((enrollment) => {
      const task = stepTasks.find(
        (t) =>
          t.leadId === enrollment.lead.id &&
          t.sequenceId === enrollment.sequenceId &&
          t.sequenceStep === enrollment.currentStep
      );
      const account = enrollment.lead.assignedToId
        ? accountByUser.get(enrollment.lead.assignedToId) ?? null
        : null;

      const reason = deriveOperatorReason({
        enrollment: {
          status: enrollment.status,
          currentStep: enrollment.currentStep,
          nextActionAt: enrollment.nextActionAt,
          pausedReason: enrollment.pausedReason,
        },
        task: task ? { status: task.status, dueDate: task.dueDate } : null,
        account: account
          ? {
              isActive: account.isActive,
              sendPausedAt: account.sendPausedAt,
              dailyCap: account.dailyCap,
              dailySendCount: account.dailySendCount,
              dailySendDate: account.dailySendDate,
              healthLevel: account.healthLevel,
            }
          : null,
        stepLabel: `Step ${enrollment.currentStep}`,
      });

      return {
        enrollmentId: enrollment.id,
        lead: enrollment.lead,
        sequenceName: enrollment.sequence?.name ?? null,
        currentStep: enrollment.currentStep,
        ...reason,
      };
    });

    return NextResponse.json({
      metrics: {
        totalActiveSequences,
        totalPendingOutbound,
        totalActiveAccounts,
        needsAttention: waiting.filter((w) => w.needsAttention).length,
      },
      emailAccounts,
      activities,
      waiting,
    });
  } catch (error) {
    console.error('[automation-stats-api] Failed to load statistics:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
