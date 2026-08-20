/**
 * Briefing data — one server-side source for the morning and end-of-day summaries.
 *
 * Extracted from `app/api/ai/briefing/route.ts` so that the chat route can build an EOD answer
 * from the CRM rather than from whatever the browser posted.
 *
 * ## Why this lives in `lib/briefing/`, not `lib/ai/`
 *
 * It reads `Task`, `Activity`, `Lead` and `User` — CRM tables. Nothing under `lib/ai/` may
 * touch a CRM table directly; the AI layer calls domain services, and the domain services own
 * the queries and the scoping. `tests/agent-object-authorization.test.ts` enforces that as a
 * source scan, and it caught this module on its first draft, when it was written as
 * `lib/ai/briefing.ts`. The right repair was to move the file, not to add it to the test's
 * exemption list — the rule is what keeps object authorization in one place.
 *
 * ## Why this is not a client concern
 *
 * The chatbox used to answer "summarise my day" by fetching `/api/ai/briefing?type=eod`
 * itself, JSON-stringifying the result, and attaching it to the chat request as
 * `context.eodData`. The chat route's context schema ended in `.passthrough()`, so the key
 * survived validation — and then nothing read it. The system prompt was assembled from
 * `page`, a handful of counters and the lead block; `eodData` was never mentioned. The
 * feature looked wired end to end and was, in fact, a round trip to nowhere: the model
 * answered about the user's day from conversation history alone.
 *
 * Fetching it here fixes both halves. The data is real, and it is read under the session's own
 * role scope instead of being handed to the server by the page that wants to be summarised.
 *
 * Role scoping is identical to the route's, because it is now literally the same code: an SDR
 * sees themselves, a Team Lead their pod, a Floor Manager their floor, a Director everything.
 */

import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/auth';

export interface EodSummary {
  date: string;
  tasksCompleted: number;
  tasksSkipped: number;
  meetingsBooked: number;
  activityCounts: Record<string, number>;
  stageChanges: Array<{ lead: string; company: string }>;
}

export interface MorningSummary {
  overdueTasks: number;
  todayTaskCount: number;
  todayTasksByChannel: Record<string, number>;
  staleLeads: number;
  recentReplies: Array<{ firstName: string; lastName: string; company: string | null }>;
  hotLeads: Array<{ name: string; company: string | null; stage: string }>;
}

export interface BriefingWindow {
  todayStart: Date;
  todayEnd: Date;
}

export function briefingWindow(now: Date = new Date()): BriefingWindow {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return { todayStart, todayEnd: new Date(todayStart.getTime() + 86400000) };
}

/**
 * The user ids this session may see, or `undefined` for a Director (everyone).
 *
 * Walks `managerId`, which is how pod membership is represented everywhere else in the CRM.
 */
export async function visibleUserIds(user: SessionUser): Promise<string[] | undefined> {
  if (user.role === 'sdr' || user.role === 'leadgen') return [user.id];

  if (user.role === 'team_lead') {
    const reports = await prisma.user.findMany({ where: { managerId: user.id }, select: { id: true } });
    return [user.id, ...reports.map((r) => r.id)];
  }

  if (user.role === 'floor_manager' || user.role === 'leadgen_manager') {
    const teamLeads = await prisma.user.findMany({ where: { managerId: user.id }, select: { id: true } });
    const sdrs = await prisma.user.findMany({
      where: { managerId: { in: teamLeads.map((t) => t.id) } },
      select: { id: true },
    });
    return [user.id, ...teamLeads.map((t) => t.id), ...sdrs.map((s) => s.id)];
  }

  // director: no filter
  return undefined;
}

/**
 * The same set of people, spelled the way each model spells ownership.
 *
 * `Task` and `Activity` own a `userId`; `Lead` owns an `assignedToId`. Applying the task
 * shape to a lead query is not a silent mismatch — Prisma rejects it outright with
 * `Unknown argument \`userId\``, and the whole briefing endpoint answers 500. It did, for
 * every role except director, for as long as this had one scope object: the chatbox swallows
 * a failed briefing with `.catch(() => {})`, so the only visible symptom was a morning
 * briefing that never appeared.
 */
export function scopesFor(userIdFilter: string[] | undefined) {
  return {
    userScope: userIdFilter ? { userId: { in: userIdFilter } } : {},
    leadScope: userIdFilter ? { assignedToId: { in: userIdFilter } } : {},
  };
}

export async function loadMorningBriefing(user: SessionUser, now: Date = new Date()): Promise<MorningSummary> {
  const { todayStart, todayEnd } = briefingWindow(now);
  const { userScope, leadScope } = scopesFor(await visibleUserIds(user));

  const [overdueTasks, todayTasks, staleLeads, recentReplies] = await Promise.all([
    prisma.task.count({ where: { ...userScope, status: 'pending', dueDate: { lt: todayStart } } }),
    prisma.task.findMany({
      where: { ...userScope, status: 'pending', dueDate: { gte: todayStart, lt: todayEnd } },
      include: { lead: { select: { firstName: true, lastName: true, company: true, stage: true } } },
      orderBy: { dueDate: 'asc' },
      take: 10,
    }),
    prisma.lead.count({
      where: {
        ...leadScope,
        stage: { notIn: ['won', 'lost'] },
        lastContactedAt: { lt: new Date(now.getTime() - 7 * 86400000) },
      },
    }),
    prisma.lead.findMany({
      where: { ...leadScope, stage: 'replied', updatedAt: { gte: new Date(now.getTime() - 86400000) } },
      select: { firstName: true, lastName: true, company: true },
      take: 3,
    }),
  ]);

  const byChannel = todayTasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.type] = (acc[t.type] || 0) + 1;
    return acc;
  }, {});

  return {
    overdueTasks,
    todayTaskCount: todayTasks.length,
    todayTasksByChannel: byChannel,
    staleLeads,
    recentReplies,
    hotLeads: todayTasks
      .filter((t) => t.lead.stage === 'replied' || t.lead.stage === 'meeting_booked')
      .slice(0, 3)
      .map((t) => ({ name: `${t.lead.firstName} ${t.lead.lastName}`, company: t.lead.company, stage: t.lead.stage })),
  };
}

export async function loadEodSummary(user: SessionUser, now: Date = new Date()): Promise<EodSummary> {
  const { todayStart, todayEnd } = briefingWindow(now);
  const { userScope } = scopesFor(await visibleUserIds(user));

  const [activities, tasksCompleted, tasksSkipped, stageChanges, meetingsBooked] = await Promise.all([
    prisma.activity.findMany({
      where: { ...userScope, createdAt: { gte: todayStart, lt: todayEnd } },
      select: { type: true, channel: true, userId: true },
    }),
    prisma.task.count({
      where: { ...userScope, status: 'completed', completedAt: { gte: todayStart, lt: todayEnd } },
    }),
    prisma.task.count({
      where: { ...userScope, status: 'skipped', updatedAt: { gte: todayStart, lt: todayEnd } },
    }),
    prisma.activity.findMany({
      where: { ...userScope, type: 'stage_changed', createdAt: { gte: todayStart, lt: todayEnd } },
      include: { lead: { select: { firstName: true, lastName: true, company: true } } },
      take: 5,
    }),
    prisma.activity.count({
      where: { ...userScope, type: 'meeting_booked', createdAt: { gte: todayStart, lt: todayEnd } },
    }),
  ]);

  const activityCounts = activities.reduce<Record<string, number>>((acc, a) => {
    acc[a.type] = (acc[a.type] || 0) + 1;
    return acc;
  }, {});

  return {
    date: todayStart.toISOString().split('T')[0],
    tasksCompleted,
    tasksSkipped,
    meetingsBooked,
    activityCounts,
    stageChanges: stageChanges.map((a) => ({
      lead: a.lead ? `${a.lead.firstName} ${a.lead.lastName}` : 'Unknown',
      company: a.lead?.company || '',
    })),
  };
}

/**
 * Whether this turn is asking for an end-of-day summary.
 *
 * Kept beside the loader rather than in the route so the trigger and the data it triggers
 * cannot drift apart. Matches the phrasings the chatbox has always recognised.
 */
export function isEodRequest(message: string): boolean {
  return /summarize my day|summarise my day|end of day|what did i do today|eod report|daily summary/i.test(message);
}

/** Compact, promptable rendering. Numbers only — no free text the model could mistake for instruction. */
export function formatEodForPrompt(summary: EodSummary): string {
  const activities = Object.entries(summary.activityCounts)
    .map(([type, count]) => `${type}=${count}`)
    .join(', ');

  const lines = [
    `[End-of-day figures for ${summary.date}, read from the CRM]`,
    `Tasks completed: ${summary.tasksCompleted}`,
    `Tasks skipped: ${summary.tasksSkipped}`,
    `Meetings booked: ${summary.meetingsBooked}`,
    `Activity counts: ${activities || 'none'}`,
  ];

  if (summary.stageChanges.length > 0) {
    lines.push(
      `Stage changes: ${summary.stageChanges.map((c) => `${c.lead}${c.company ? ` (${c.company})` : ''}`).join('; ')}`,
    );
  }

  return lines.join('\n');
}
