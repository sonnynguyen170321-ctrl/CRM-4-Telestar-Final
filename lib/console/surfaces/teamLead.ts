import type { SessionUser } from '@/lib/auth';
import {
  HANDOFF_SLA_HOURS, STALLED_CONVERSATION_HOURS, lateHandoffs, loadOverdueTasks,
  loadOwnershipRows, reengagementGaps, resolveScope, stalledConversations,
} from './shared';
import { group, type ExceptionItem, type RoleSurface } from './types';

/**
 * The Team Lead surface — their pod's exceptions, and only exceptions (Phase 9).
 *
 * A Team Lead does not need to see work being done correctly. What they need is the short list of
 * places where their people are behind: a prospect who replied and got no answer, a call that was
 * never made, a conversation that stopped moving, and which rep's queue is growing.
 *
 * Scoping is `computeVisibleUserIds` — the CRM's own pod walk. A Team Lead sees the SDRs who
 * report to them and nobody else, because that is what the rest of the product already means by
 * their pod.
 */
export async function buildTeamLeadSurface(user: SessionUser, now: Date): Promise<RoleSurface> {
  const scope = await resolveScope(user);
  const [rows, overdue] = await Promise.all([
    loadOwnershipRows(scope),
    loadOverdueTasks(scope, now),
  ]);

  const late = lateHandoffs(rows, now);
  const stalled = stalledConversations(rows, now);
  const gaps = reengagementGaps(rows, now);

  /**
   * Whose queue is growing.
   *
   * Deliberately an exception list, not a leaderboard: it counts *unmet* work per rep, so a rep
   * doing a large volume correctly never appears. A coaching candidate is someone with more than
   * their share of overdue work, not someone with a low activity count.
   */
  const queuePressure: ExceptionItem[] = [];
  // Keyed by owner *name*, because the ownership rows carry the display name and the task rows
  // carry the user id — one shared key beats joining two half-populated maps.
  const perOwner = new Map<string, { name: string; overdue: number; lateReplies: number; stalled: number }>();
  const owner = (name: string) => {
    const existing = perOwner.get(name);
    if (existing) return existing;
    const created = { name, overdue: 0, lateReplies: 0, stalled: 0 };
    perOwner.set(name, created);
    return created;
  };

  for (const entry of overdue.byOwner.values()) owner(entry.name).overdue += entry.count;
  for (const item of late) if (item.ownerName) owner(item.ownerName).lateReplies += 1;
  for (const item of stalled) if (item.ownerName) owner(item.ownerName).stalled += 1;

  for (const [key, entry] of perOwner) {
    const total = entry.overdue + entry.lateReplies + entry.stalled;
    // Three unmet items is where a queue stops being noise and starts being a pattern worth a
    // conversation. Below that a rep is simply having a normal day.
    if (total < 3) continue;
    queuePressure.push({
      id: `pressure-${key}`,
      primary: entry.name,
      secondary: `${total} things behind: ${entry.overdue} overdue, ${entry.lateReplies} unanswered replies, ${entry.stalled} stalled conversations.`,
      meta: 'Worth a coaching conversation',
      ownerName: entry.name,
      ageHours: total,
    });
  }

  return {
    key: 'team_lead',
    title: 'Your pod',
    focus: 'What your team is behind on. Work being handled correctly does not appear here.',
    scope: 'team',
    metrics: [
      { key: 'late_replies', label: 'Replies past SLA', value: String(late.length), raw: late.length, tone: 'attention', hint: `Unanswered for ${HANDOFF_SLA_HOURS}h+` },
      { key: 'overdue_calls', label: 'Calls overdue', value: String(overdue.calls.length), raw: overdue.calls.length, tone: 'risk' },
      { key: 'overdue_followups', label: 'Follow-ups overdue', value: String(overdue.followUps.length), raw: overdue.followUps.length, tone: 'risk' },
      { key: 'stalled', label: 'Stalled conversations', value: String(stalled.length), raw: stalled.length, tone: 'waiting', hint: `No movement in ${STALLED_CONVERSATION_HOURS / 24} days` },
      { key: 'coaching', label: 'Reps falling behind', value: String(queuePressure.length), raw: queuePressure.length, tone: 'attention' },
    ],
    groups: [
      group(
        'late_replies', 'Positive replies nobody has answered',
        `A prospect replied and no one on your pod has acted for over ${HANDOFF_SLA_HOURS} hours.`,
        'critical', 'Every reply in your pod has been picked up in time.', late
      ),
      group(
        'overdue_calls', 'Calls overdue',
        'Scheduled calls past their time with no outcome logged.',
        'critical', 'No calls are overdue in your pod.', overdue.calls
      ),
      group(
        'overdue_followups', 'Follow-ups overdue',
        'Non-call steps your reps owe a prospect.',
        'warning', 'No follow-ups are overdue.', overdue.followUps
      ),
      group(
        'stalled', 'Conversations that stopped moving',
        `A rep took the conversation over and nothing has happened for ${STALLED_CONVERSATION_HOURS / 24} days.`,
        'warning', 'Every live conversation has moved recently.', stalled
      ),
      group(
        'queue_pressure', 'Reps falling behind',
        'Reps carrying more unmet work than the rest of the pod. Coaching candidates, not a ranking.',
        'warning', 'No rep is carrying an unusual backlog.', queuePressure
      ),
      group(
        'reengagement_gaps', 'Follow-up decisions nobody has made',
        'Prospects the CRM flagged for re-engagement that are still waiting on a human decision.',
        'info', 'No re-engagement decision is outstanding.', gaps
      ),
    ],
    sources: ['Prospect ownership', 'Task lists across your pod', 'Inbound replies'],
  };
}
