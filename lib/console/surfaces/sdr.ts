import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/auth';
import type { AiConsole } from '../aiConsole';
import {
  HANDOFF_SLA_HOURS, loadOverdueTasks, loadOwnershipRows, lateHandoffs, reengagementGaps, resolveScope,
} from './shared';
import { group, hoursSince, type RoleSurface } from './types';

/**
 * The SDR surface — exceptions and selling work, nothing else (Phase 9).
 *
 * An SDR must never be asked to supervise healthy automation. Prospects AI is handling correctly
 * appear as **one number**; everything below the numbers is something a person has to do. If the
 * AI is working and nobody has replied, this screen is deliberately almost empty.
 *
 * The buckets come from the same `buildAiConsole` the board renders, so a count here can never
 * disagree with the count beside it.
 */
export async function buildSdrSurface(
  user: SessionUser,
  console_: AiConsole,
  now: Date
): Promise<RoleSurface> {
  const scope = await resolveScope(user);
  const [rows, overdue, drafts] = await Promise.all([
    loadOwnershipRows(scope),
    loadOverdueTasks(scope, now),
    // Replies classified as a sales conversation are where AI assistance is worth offering.
    prisma.lead.findMany({
      where: {
        tenantId: scope.tenantId,
        archivedAt: null,
        ...(scope.userIds ? { assignedToId: { in: scope.userIds } } : {}),
        operatingState: { in: ['human_attention', 'human_managed'] },
        inboundMessages: { some: { replyClass: { in: ['C', 'D'] } } },
      },
      select: {
        id: true, firstName: true, lastName: true, company: true, operatingState: true,
        operatingStateAt: true,
        inboundMessages: {
          where: { replyClass: { not: null } },
          orderBy: { date: 'desc' },
          take: 1,
          select: { replyKind: true, date: true },
        },
      },
      take: 100,
    }),
  ]);

  const count = (key: string) => console_.buckets.find((b) => b.key === key)?.count ?? 0;

  // "Needs you now" is deliberately the whole attention bucket, not just the late half: for the
  // person who owns the conversation, a reply that arrived ten minutes ago is still their job.
  const needsYou = rows
    .filter((r) => r.operatingState === 'human_attention')
    .map((r) => ({
      id: `attention-${r.leadId}`,
      primary: r.name + (r.company ? ` · ${r.company}` : ''),
      secondary: r.replyKindLabel
        ? `Replied — ${r.replyKindLabel.replace(/_/g, ' ')}. Outreach has stopped.`
        : 'Replied. Outreach has stopped.',
      meta: 'Waiting for your response',
      href: `/ai?prospect=${r.leadId}`,
      leadId: r.leadId,
      ageHours: hoursSince(r.stateAt, now),
      state: r.operatingState,
    }));

  const assistance = drafts.map((l) => ({
    id: `assist-${l.id}`,
    primary: `${l.firstName} ${l.lastName}`.trim() + (l.company ? ` · ${l.company}` : ''),
    secondary: 'A summary, a draft reply and objection support are ready to read.',
    meta: 'AI writes it, you send it',
    href: `/ai?prospect=${l.id}`,
    leadId: l.id,
    ageHours: hoursSince(l.inboundMessages[0]?.date ?? l.operatingStateAt, now),
    state: l.operatingState,
  }));

  return {
    key: 'sdr',
    title: 'Your prospects',
    focus: 'AI runs the repetitive outreach. This is the part that needs a person.',
    scope: 'own',
    metrics: [
      { key: 'ai_managed', label: 'AI is handling', value: String(count('ai_managed')), raw: count('ai_managed'), tone: 'ai', hint: 'No action needed from you' },
      { key: 'needs_you', label: 'Needs you now', value: String(needsYou.length), raw: needsYou.length, tone: 'attention', hint: 'Replied — outreach stopped' },
      { key: 'you_own', label: 'You are running', value: String(count('human_managed')), raw: count('human_managed'), tone: 'human', hint: 'Conversations you took over' },
      { key: 'waiting', label: 'Waiting on them', value: String(count('waiting')), raw: count('waiting'), tone: 'waiting', hint: 'You answered, they have not' },
      { key: 'reengagement', label: 'Follow-up suggested', value: String(count('reengagement_eligible')), raw: count('reengagement_eligible'), tone: 'eligible', hint: 'Gone quiet — your call' },
    ],
    groups: [
      group(
        'needs_you', 'Replies waiting on you',
        'A prospect answered. Outreach stopped the moment they did.',
        'critical', 'Nobody is waiting on a reply from you.', needsYou
      ),
      group(
        'overdue_calls', 'Calls past due',
        'Scheduled calls that have not been logged.',
        'warning', 'No calls are overdue.', overdue.calls
      ),
      group(
        'overdue_followups', 'Follow-ups past due',
        'Emails, messages and manual steps you owe someone.',
        'warning', 'Nothing is overdue.', overdue.followUps
      ),
      group(
        'assistance', 'AI help is ready',
        'Conversations where a summary and a draft reply already exist. Nothing sends itself.',
        'info', 'No drafts are waiting.', assistance
      ),
      group(
        'reengagement', 'Suggested follow-ups',
        'Gone quiet long enough that AI can pick them back up — if you say so.',
        'info', 'No prospects are waiting on that decision.', reengagementGaps(rows, now)
      ),
      group(
        'late', 'Overdue replies',
        `Replied over ${HANDOFF_SLA_HOURS} hours ago and still has no answer.`,
        'critical', 'Every reply has been answered in time.', lateHandoffs(rows, now)
      ),
    ],
    sources: ['Prospect ownership', 'Your task list', 'Inbound replies'],
  };
}
