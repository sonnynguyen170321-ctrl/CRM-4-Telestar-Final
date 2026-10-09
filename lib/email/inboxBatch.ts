import type { InboxMessage } from './EmailService';

/**
 * Messages one sync run reads at most. A run that finds more reads the oldest ones and says
 * `truncated`; the sync then moves its cursor only as far as what it read, and the next run carries on.
 *
 * There used to be no such thing: each run read the newest 50 and moved the cursor to "now", so any
 * mail beyond 50 since the last run was never read. A cold-email mailbox gets its bounces in a burst
 * right after a batch send — the run that lost them is the one that mattered (owner, 2026-10-09: a
 * bounced address was sent the follow-up).
 */
export const SYNC_READ_LIMIT = 300;

/** What one run read, and whether mail was left for the next run. */
export type InboxBatch = { messages: InboxMessage[]; truncated: boolean };

/** An adapter that does not page (IMAP) still returns a bare list: it read everything. */
export function toInboxBatch(result: InboxMessage[] | InboxBatch): InboxBatch {
  return Array.isArray(result) ? { messages: result, truncated: false } : result;
}
