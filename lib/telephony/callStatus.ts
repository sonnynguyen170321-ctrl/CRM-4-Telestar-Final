import type { CallStatus } from '@prisma/client';

/**
 * The call status state machine (docs/dialer/SYSTEM_DESIGN.md).
 *
 * Status only moves forward. A terminal row never changes status again; later events may only fill
 * fields that are still empty. Every writer applies this as a guarded `updateMany` whose `where`
 * lists the statuses a move may start from (`statusesBefore`), so two workers racing on the same
 * call cannot move it backwards — the database is the arbiter, not a read followed by a write.
 */

export const TERMINAL_STATUSES: readonly CallStatus[] = ['blocked', 'completed', 'no_answer', 'busy', 'failed', 'missed', 'canceled'];

/** Non-terminal statuses in the order a call passes through them. */
const ORDER: readonly CallStatus[] = ['authorized', 'initiated', 'ringing', 'answered'];

export const NON_TERMINAL_STATUSES: readonly CallStatus[] = ORDER;

export function isTerminalStatus(status: CallStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Whether a call in `from` may become `to`: from a live status, to a later one or to any end. */
export function canAdvance(from: CallStatus, to: CallStatus): boolean {
  if (isTerminalStatus(from)) return false;
  if (isTerminalStatus(to)) return true;
  return ORDER.indexOf(to) > ORDER.indexOf(from);
}

/** The statuses a call may be in for a move to `to` to be legal: the `where` of a guarded update. */
export function statusesBefore(to: CallStatus): CallStatus[] {
  return ORDER.filter((from) => canAdvance(from, to));
}

export type FinalStatus = Extract<CallStatus, 'completed' | 'no_answer' | 'busy' | 'failed' | 'canceled'>;

/**
 * How an outbound call ended, from whether it was ever answered and the provider's hangup cause.
 * Answered always wins: a call that was bridged ends `completed` whatever the cause says (the
 * far end hanging up on a long conversation reports `normal_clearing`, the same as a cancel).
 */
export function finalStatusFor(input: { answered: boolean; hangupCause: string | null }): FinalStatus {
  if (input.answered) return 'completed';
  switch ((input.hangupCause ?? '').toLowerCase()) {
    case 'user_busy':
      return 'busy';
    case 'timeout':
    case 'no_answer':
      return 'no_answer';
    case 'originator_cancel':
    case 'normal_clearing':
      return 'canceled';
    default:
      return 'failed';
  }
}
