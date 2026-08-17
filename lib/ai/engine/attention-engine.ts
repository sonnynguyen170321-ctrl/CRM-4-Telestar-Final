import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export interface AttentionItem {
  id: string;
  category: 'urgent_reply' | 'overdue_task' | 'mailbox_health' | 'unassigned_leads' | 'stalled_sequence' | 'rep_workload' | 'system_alert';
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  summary: string;
  reason: string;
  evidence: string;
  targetUrl: string;
  actionLabel: string;
  dedupeKey: string;
  createdAt: Date;
}

export interface AttentionReport {
  role: Role;
  totalItems: number;
  criticalCount: number;
  items: AttentionItem[];
  quietnessStatus: 'active_signals' | 'all_clear_stay_quiet';
}

/**
 * 🎯 "WHAT NEEDS ATTENTION?" ENGINE (Sections 11, 12, 13, 14)
 * Evaluates live signals, calculates explicit business priority, and enforces quietness when all is well.
 */
export async function getWhatNeedsAttention(params: {
  userId: string;
  role: Role;
  tenantId: string;
}): Promise<AttentionReport> {
  const { userId, role, tenantId } = params;
  const items: AttentionItem[] = [];
  const now = new Date();

  // 1. SDR ATTENTION: Positive replies waiting & overdue followups
  if (role === 'sdr' || role === 'leadgen') {
    const overdueLeads = await prisma.lead.findMany({
      where: {
        tenantId,
        assignedToId: userId,
        nextTaskDue: { lt: now },
        stage: { notIn: ['won', 'lost'] },
      },
      select: { id: true, firstName: true, lastName: true, company: true, nextTaskDue: true, stage: true },
      take: 5,
      orderBy: { nextTaskDue: 'asc' },
    });

    for (const lead of overdueLeads) {
      items.push({
        id: `overdue_lead_${lead.id}`,
        category: 'overdue_task',
        severity: 'high',
        title: `Overdue follow-up with ${lead.firstName} ${lead.lastName}`,
        summary: `${lead.company} task was scheduled for ${lead.nextTaskDue?.toLocaleDateString() || 'earlier'}.`,
        reason: 'SDR SLA: Scheduled tasks must be actioned within 24 hours to prevent lead decay.',
        evidence: `Lead stage is ${lead.stage}. Next task was due at ${lead.nextTaskDue?.toISOString()}.`,
        targetUrl: `/leads/${lead.id}`,
        actionLabel: 'Open Lead',
        dedupeKey: `overdue_${lead.id}_${lead.nextTaskDue?.toISOString().slice(0, 10)}`,
        createdAt: now,
      });
    }
  }

  // 2. FLOOR MANAGER & TEAM LEAD ATTENTION: Unassigned leads & rep workload
  if (role === 'floor_manager' || role === 'team_lead' || role === 'director') {
    const unassignedCount = await prisma.lead.count({
      where: {
        tenantId,
        operatingState: 'unassigned',
      },
    });

    if (unassignedCount > 0) {
      items.push({
        id: `unassigned_leads_pool`,
        category: 'unassigned_leads',
        severity: unassignedCount > 20 ? 'critical' : 'high',
        title: `${unassignedCount} unassigned lead${unassignedCount > 1 ? 's' : ''} waiting in pool`,
        summary: `New leads from recent imports have not yet been distributed to active sales reps.`,
        reason: 'Speed-to-lead rule: Fresh leads lose 60% conversion potential if uncontacted for >24h.',
        evidence: `Direct database count shows ${unassignedCount} records with operatingState=unassigned.`,
        targetUrl: `/leads?tab=pool`,
        actionLabel: 'Assign Leads',
        dedupeKey: `unassigned_${tenantId}_${now.toISOString().slice(0, 13)}`,
        createdAt: now,
      });
    }

    // Check paused or failed mailboxes
    const pausedMailboxes = await prisma.emailAccount.findMany({
      where: {
        tenantId,
        OR: [{ isActive: false }, { sendPausedAt: { not: null } }],
      },
      select: { id: true, email: true, isActive: true, sendPausedAt: true, user: { select: { email: true } } },
      take: 3,
    });

    for (const mb of pausedMailboxes) {
      items.push({
        id: `mb_failed_${mb.id}`,
        category: 'mailbox_health',
        severity: 'critical',
        title: `Mailbox paused: ${mb.email}`,
        summary: `Outbound sending is halted for rep ${mb.user.email}.`,
        reason: 'Outbound sequences cannot dispatch scheduled steps while mailbox is paused or disconnected.',
        evidence: `EmailAccount ID ${mb.id} has isActive=${mb.isActive}, sendPausedAt=${mb.sendPausedAt?.toISOString() || 'null'}.`,
        targetUrl: `/settings?tab=email`,
        actionLabel: 'Check Email Settings',
        dedupeKey: `mb_failed_${mb.id}`,
        createdAt: now,
      });
    }
  }

  const criticalCount = items.filter((i) => i.severity === 'critical').length;

  return {
    role,
    totalItems: items.length,
    criticalCount,
    items,
    quietnessStatus: items.length === 0 ? 'all_clear_stay_quiet' : 'active_signals',
  };
}
