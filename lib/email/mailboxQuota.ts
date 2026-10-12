/**
 * How much a mailbox can still send, as the composer shows it.
 *
 * Mirrors the worker's accounting (`workers/email.ts`): the daily counter resets at the server's
 * local midnight (`dailySendDate` older than today means a fresh day), and the hourly ceiling is
 * measured against real sent rows rather than a counter. This is advisory display only; the worker
 * remains the gate and defers a message instead of dropping it.
 */
export interface MailboxQuotaInput {
  dailyCap: number;
  dailySendCount: number;
  dailySendDate: Date | null;
  hourlyCap: number;
}

export interface MailboxQuota {
  dailyCap: number;
  dailyRemaining: number;
  hourlyCap: number;
  /** Null when the mailbox has no hourly ceiling. */
  hourlyRemaining: number | null;
}

export function mailboxQuota(account: MailboxQuotaInput, sentLastHour: number, now: Date = new Date()): MailboxQuota {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sentToday = account.dailySendDate && account.dailySendDate >= today ? account.dailySendCount : 0;
  return {
    dailyCap: account.dailyCap,
    dailyRemaining: Math.max(0, account.dailyCap - sentToday),
    hourlyCap: account.hourlyCap,
    // hourlyCap <= 0 means no hourly ceiling (the worker skips the check).
    hourlyRemaining: account.hourlyCap > 0 ? Math.max(0, account.hourlyCap - sentLastHour) : null,
  };
}
