/**
 * What a waiting step is waiting for, in words a rep can act on.
 *
 * The codes are the reasons `evaluateAutomationEligibility` returns and the sequence worker stores
 * on `SequenceEnrollment.holdReason`. Browser-safe: the enrollments table renders these.
 */

const HOLD_LABELS: Record<string, string> = {
  // Deferred: it will try again by itself.
  before_send_window: 'Waiting for the send window to open',
  after_send_window: 'Past today’s send window — goes in the next one',
  outside_send_window: 'Outside the send window',
  weekend_adjustment: 'Weekend — goes on the next weekday',
  daily_quota_exhausted: 'Mailbox reached today’s limit — goes tomorrow',
  mailbox_paused: 'Sending is paused on this mailbox',
  inbox_health_critical: 'Held: mailbox health is critical',
  // Needs a person.
  step_is_manual: 'Manual step — the rep sends this one',
  missing_template: 'No template on this step',
  no_connected_mailbox: 'No connected mailbox to send from',
  no_sequence_sender: 'No sending mailbox chosen for this sequence — choose one under Send from',
  sequence_senders_disconnected: 'Every mailbox this sequence sends from is disconnected',
  channel_requires_manual_action: 'Manual step — the rep completes this one',
  mailbox_inactive: 'The sending mailbox is disconnected',
  // Blocked: it will not send as things stand.
  user_inactive: 'The lead owner’s account is deactivated',
  campaign_paused: 'The campaign is paused',
  campaign_completed: 'The campaign is completed',
  lead_archived: 'The lead is archived',
  lead_email_invalid: 'The lead’s email bounced',
  lead_email_missing: 'The lead has no email address',
  lead_replied: 'The lead replied',
  meeting_booked: 'A meeting is booked',
  sequence_inactive: 'The sequence is turned off',
  recipient_suppressed: 'The address is on the suppression list',
  step_mismatch: 'The cadence has moved to another step',
};

/** Reasons that clear themselves; everything else needs someone to change something. */
const SELF_CLEARING = new Set([
  'before_send_window', 'after_send_window', 'outside_send_window', 'weekend_adjustment', 'daily_quota_exhausted',
]);

export function describeHold(reason: string | null | undefined): { label: string; needsAction: boolean } | null {
  if (!reason) return null;
  return {
    label: HOLD_LABELS[reason] ?? `Not sent: ${reason.replace(/_/g, ' ')}`,
    needsAction: !SELF_CLEARING.has(reason),
  };
}
