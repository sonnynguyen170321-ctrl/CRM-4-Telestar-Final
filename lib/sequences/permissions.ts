import type { SessionUser } from '@/lib/auth';

/**
 * Who may set a step's send window.
 *
 * A send window is a deliverability policy lever, in the same class as the per-mailbox
 * daily cap: widening it across a campaign changes how a client's domain looks to
 * receiving mail servers. It stays with the roles that answer for domain reputation
 * rather than with the twelve reps sending through it. SDRs still see the resulting
 * cadence — they just cannot move it.
 */
const SEND_WINDOW_ROLES: readonly SessionUser['role'][] = ['director', 'floor_manager'];

export function canConfigureSendWindow(role: SessionUser['role']): boolean {
  return SEND_WINDOW_ROLES.includes(role);
}

interface StepWindowFields {
  order?: number;
  sendWindowStartMinutes?: number | null;
  sendWindowEndMinutes?: number | null;
}

export interface SendWindowViolation {
  order: number;
  reason: 'forbidden_role' | 'invalid_range';
}

/**
 * Validate the send-window edits in an incoming step list against the caller's role and
 * against the stored steps.
 *
 * Only *changes* are gated. An SDR editing a step's instructions re-sends the window
 * fields unchanged, and blocking that would make the whole builder read-only for them.
 * A window is also rejected when only one bound is set or the range is inverted — the
 * scheduler treats such a pair as "no window", so accepting it would silently discard
 * what the manager thought they configured.
 */
export function assertSendWindowPermission(
  role: SessionUser['role'],
  incoming: StepWindowFields[],
  existing: { order: number; sendWindowStartMinutes: number | null; sendWindowEndMinutes: number | null }[] = [],
): SendWindowViolation[] {
  const violations: SendWindowViolation[] = [];
  const byOrder = new Map(existing.map((s) => [s.order, s]));

  for (const [idx, step] of incoming.entries()) {
    const order = step.order ?? idx + 1;
    const start = step.sendWindowStartMinutes ?? null;
    const end = step.sendWindowEndMinutes ?? null;

    const onlyOneBound = (start === null) !== (end === null);
    const inverted = start !== null && end !== null && end <= start;
    if (onlyOneBound || inverted) {
      violations.push({ order, reason: 'invalid_range' });
      continue;
    }

    const prior = byOrder.get(order);
    const changed =
      (prior?.sendWindowStartMinutes ?? null) !== start ||
      (prior?.sendWindowEndMinutes ?? null) !== end;

    if (changed && !canConfigureSendWindow(role)) {
      violations.push({ order, reason: 'forbidden_role' });
    }
  }

  return violations;
}
