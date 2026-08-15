import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/auth';
import { computeVisibleUserIds } from '@/lib/podScoping';
import { hoursSince, type ExceptionItem } from './types';

/**
 * The queries an ownership surface shares (Phase 9).
 *
 * SDR and Team Lead ask the same questions about the same rows — "who replied and has not been
 * answered", "what is overdue", "who has gone quiet" — and differ only in whose prospects they
 * ask about. Writing it twice would produce two definitions of "untouched" that drift, so the
 * scoping is a parameter and the definition lives here once.
 *
 * Nothing in this file introduces a metric. Every row comes from `Lead`, `Task`,
 * `ProspectTransition` and `Activity` exactly as the CRM already writes them.
 */

/** A handoff older than this with no owner action is late. Four working hours, in wall clock. */
export const HANDOFF_SLA_HOURS = 4;
/** A conversation a human owns with no activity for this long has stalled. */
export const STALLED_CONVERSATION_HOURS = 72;
/** Re-engagement eligibility a human has neither acted on nor dismissed for this long. */
export const REENGAGEMENT_GAP_HOURS = 72;

export interface SurfaceScope {
  tenantId: string;
  /** null means "everyone in the tenant" — a Director is not scoped down to a list. */
  userIds: string[] | null;
}

/**
 * The CRM's own pod walk, not an AI-side role matrix.
 *
 * Same helper the team surfaces and the AI console already use, so a Team Lead's pod is the pod
 * the rest of the product agrees they have.
 */
export async function resolveScope(user: SessionUser): Promise<SurfaceScope> {
  const tenantId = user.tenantId as string;
  const allUsers = await prisma.user.findMany({
    where: { tenantId },
    select: { id: true, role: true, managerId: true },
  });
  return { tenantId, userIds: computeVisibleUserIds(allUsers, user) };
}

const leadWhere = (scope: SurfaceScope) => ({
  tenantId: scope.tenantId,
  archivedAt: null,
  ...(scope.userIds ? { assignedToId: { in: scope.userIds } } : {}),
});

export interface OwnershipRow {
  leadId: string;
  name: string;
  company: string | null;
  operatingState: string;
  ownerName: string | null;
  ownerId: string | null;
  /** When responsibility last moved, whatever moved it. */
  stateAt: Date | null;
  /** The most recent thing the owning human did on this prospect. */
  lastHumanActionAt: Date | null;
  replyKindLabel: string | null;
}

/**
 * Prospects a human is responsible for, with the two timestamps that decide whether that
 * responsibility is being met.
 *
 * `lastHumanActionAt` counts activity by the *owner*, not by the system: an AI-written note or an
 * automated state change must not clear a late handoff. That is the whole reason this is one
 * query pair rather than a `lead.updatedAt` read.
 */
export async function loadOwnershipRows(scope: SurfaceScope): Promise<OwnershipRow[]> {
  const leads = await prisma.lead.findMany({
    where: {
      ...leadWhere(scope),
      operatingState: { in: ['human_attention', 'human_managed', 'reengagement_eligible', 'waiting_for_prospect'] },
    },
    select: {
      id: true, firstName: true, lastName: true, company: true,
      operatingState: true, operatingStateAt: true, assignedToId: true,
      assignedTo: { select: { firstName: true, lastName: true } },
      inboundMessages: {
        where: { replyClass: { not: null } },
        orderBy: { date: 'desc' },
        take: 1,
        select: { replyKind: true },
      },
    },
    take: 500,
  });

  if (leads.length === 0) return [];

  // One grouped pass for "the owner did something", rather than a query per prospect.
  const humanActivity = await prisma.activity.groupBy({
    by: ['leadId'],
    where: {
      tenantId: scope.tenantId,
      leadId: { in: leads.map((l) => l.id) },
      // System-authored movement is excluded on purpose: it is not a human answering a prospect.
      // `email_replied` is the *prospect's* action — counting it would clear the very clock it
      // starts, and every late handoff would report itself as answered.
      type: { notIn: ['prospect_handed_off', 'prospect_reengagement_eligible', 'sequence_deferred', 'email_replied'] },
    },
    _max: { createdAt: true },
  });
  const lastAction = new Map(humanActivity.map((a) => [a.leadId, a._max?.createdAt ?? null]));

  return leads.map((l) => ({
    leadId: l.id,
    name: `${l.firstName} ${l.lastName}`.trim(),
    company: l.company,
    operatingState: l.operatingState,
    ownerName: l.assignedTo ? `${l.assignedTo.firstName} ${l.assignedTo.lastName}`.trim() : null,
    ownerId: l.assignedToId,
    stateAt: l.operatingStateAt,
    lastHumanActionAt: lastAction.get(l.id) ?? null,
    replyKindLabel: l.inboundMessages[0]?.replyKind ?? null,
  }));
}

/** A handoff nobody has answered yet, and it has been sitting there. */
export function lateHandoffs(rows: OwnershipRow[], now: Date, slaHours = HANDOFF_SLA_HOURS): ExceptionItem[] {
  return rows
    .filter((r) => r.operatingState === 'human_attention')
    .filter((r) => {
      const age = hoursSince(r.stateAt, now);
      if (age === null || age < slaHours) return false;
      // Answered after the handoff — the clock stopped, however late it was.
      return !(r.lastHumanActionAt && r.stateAt && r.lastHumanActionAt > r.stateAt);
    })
    .map((r) => ({
      id: `late-handoff-${r.leadId}`,
      primary: r.name + (r.company ? ` · ${r.company}` : ''),
      secondary: 'Replied and is still waiting for a person.',
      meta: r.ownerName ? `Owner: ${r.ownerName}` : 'Unassigned',
      href: `/ai?prospect=${r.leadId}`,
      leadId: r.leadId,
      ownerName: r.ownerName,
      ageHours: hoursSince(r.stateAt, now),
      state: r.operatingState,
    }));
}

/** The conversation is a human's, and the human has gone quiet on it. */
export function stalledConversations(rows: OwnershipRow[], now: Date): ExceptionItem[] {
  return rows
    .filter((r) => r.operatingState === 'human_managed')
    .filter((r) => {
      const age = hoursSince(r.lastHumanActionAt ?? r.stateAt, now);
      return age !== null && age >= STALLED_CONVERSATION_HOURS;
    })
    .map((r) => ({
      id: `stalled-${r.leadId}`,
      primary: r.name + (r.company ? ` · ${r.company}` : ''),
      secondary: 'No movement since the conversation was taken over.',
      meta: r.ownerName ? `Owner: ${r.ownerName}` : 'Unassigned',
      href: `/ai?prospect=${r.leadId}`,
      leadId: r.leadId,
      ownerName: r.ownerName,
      ageHours: hoursSince(r.lastHumanActionAt ?? r.stateAt, now),
      state: r.operatingState,
    }));
}

/**
 * Eligible for re-engagement, and nobody has decided either way.
 *
 * Eligibility is a recommendation the CRM makes; leaving it undecided is the exception, and the
 * fix is a human pressing "Resume AI follow-up" or working the prospect themselves. Nothing here
 * starts anything.
 */
export function reengagementGaps(rows: OwnershipRow[], now: Date): ExceptionItem[] {
  return rows
    .filter((r) => r.operatingState === 'reengagement_eligible')
    .filter((r) => {
      const age = hoursSince(r.stateAt, now);
      return age !== null && age >= REENGAGEMENT_GAP_HOURS;
    })
    .map((r) => ({
      id: `reengagement-gap-${r.leadId}`,
      primary: r.name + (r.company ? ` · ${r.company}` : ''),
      secondary: 'Recommended for follow-up. Waiting on a person to decide.',
      meta: r.ownerName ? `Owner: ${r.ownerName}` : 'Unassigned',
      href: `/ai?prospect=${r.leadId}`,
      leadId: r.leadId,
      ownerName: r.ownerName,
      ageHours: hoursSince(r.stateAt, now),
      state: r.operatingState,
    }));
}

export interface OverdueTasks {
  calls: ExceptionItem[];
  followUps: ExceptionItem[];
  /** Open overdue count per owner — what "whose queue is growing" is measured from. */
  byOwner: Map<string, { name: string; count: number }>;
}

/** Overdue work, split the way a salesperson thinks about it: calls, and everything else. */
export async function loadOverdueTasks(scope: SurfaceScope, now: Date): Promise<OverdueTasks> {
  const tasks = await prisma.task.findMany({
    where: {
      status: 'pending',
      dueDate: { lt: now },
      lead: leadWhere(scope),
      ...(scope.userIds ? { userId: { in: scope.userIds } } : {}),
    },
    orderBy: { dueDate: 'asc' },
    take: 400,
    select: {
      id: true, type: true, title: true, dueDate: true, leadId: true, userId: true,
      lead: { select: { firstName: true, lastName: true, company: true, operatingState: true } },
      user: { select: { firstName: true, lastName: true } },
    },
  });

  const byOwner = new Map<string, { name: string; count: number }>();
  const toItem = (t: (typeof tasks)[number]): ExceptionItem => {
    const owner = t.user ? `${t.user.firstName} ${t.user.lastName}`.trim() : null;
    return {
      id: `task-${t.id}`,
      primary: `${t.lead.firstName} ${t.lead.lastName}`.trim() + (t.lead.company ? ` · ${t.lead.company}` : ''),
      secondary: t.title,
      meta: owner ? `Owner: ${owner}` : 'Unassigned',
      href: `/?task=${t.id}`,
      leadId: t.leadId,
      ownerName: owner,
      ageHours: hoursSince(t.dueDate, now),
      state: t.lead.operatingState,
    };
  };

  for (const t of tasks) {
    if (!t.userId) continue;
    const owner = t.user ? `${t.user.firstName} ${t.user.lastName}`.trim() : t.userId;
    const entry = byOwner.get(t.userId) ?? { name: owner, count: 0 };
    entry.count += 1;
    byOwner.set(t.userId, entry);
  }

  return {
    calls: tasks.filter((t) => t.type === 'phone').map(toItem),
    followUps: tasks.filter((t) => t.type !== 'phone').map(toItem),
    byOwner,
  };
}
