/**
 * The pre-send checklist, as a pure function over what the route gathered. Blocking items are
 * things the send routes would refuse anyway (surfaced before the rep presses Send); warnings are
 * things the email can survive but the rep should know. Browser-safe.
 */
export type ChecklistSeverity = 'block' | 'warn' | 'ok';

export interface ChecklistItem {
  id: 'recipient' | 'mailbox' | 'quota' | 'variables' | 'unsubscribe';
  severity: ChecklistSeverity;
  label: string;
  detail: string;
}

export interface ChecklistInput {
  recipientEmail: string;
  /** The queue refusal for the recipient (suppressed / DNC / invalid), or null. */
  recipientRefusal: { error: string } | null;
  /** The queue refusal for the mailbox (paused / inactive / critical with autopause), or null. */
  mailboxRefusal: { error: string } | null;
  mailboxEmail: string | null;
  healthLevel: string | null;
  quota: { dailyRemaining: number; dailyCap: number; hourlyRemaining: number | null; hourlyCap: number } | null;
  missingFields: string[];
  /** A bulk email (to many people / part of a cadence) must carry an unsubscribe link. */
  bulk: boolean;
  body: string;
}

export const LOW_QUOTA_THRESHOLD = 5;
const UNSUBSCRIBE = /unsubscribe|opt[\s-]?out/i;

export function buildChecklist(input: ChecklistInput): { items: ChecklistItem[]; canSend: boolean } {
  const items: ChecklistItem[] = [];

  items.push(
    input.recipientRefusal
      ? { id: 'recipient', severity: 'block', label: 'Recipient cannot be emailed', detail: input.recipientRefusal.error }
      : { id: 'recipient', severity: 'ok', label: 'Recipient is clear', detail: `${input.recipientEmail} is not suppressed or on a do-not-contact list.` },
  );

  if (input.mailboxRefusal) {
    items.push({ id: 'mailbox', severity: 'block', label: 'Mailbox cannot send', detail: input.mailboxRefusal.error });
  } else if (input.healthLevel === 'critical' || input.healthLevel === 'warning') {
    items.push({
      id: 'mailbox', severity: 'warn', label: 'Mailbox health needs attention',
      detail: `Inbox health for ${input.mailboxEmail ?? 'this mailbox'} is ${input.healthLevel}. It still sends, but a manager should look under Email Health.`,
    });
  } else {
    items.push({ id: 'mailbox', severity: 'ok', label: 'Mailbox is ready', detail: `${input.mailboxEmail ?? 'The mailbox'} is connected and not paused.` });
  }

  if (input.quota) {
    const { dailyRemaining, hourlyRemaining } = input.quota;
    if (dailyRemaining <= 0) {
      items.push({ id: 'quota', severity: 'warn', label: 'Daily limit reached', detail: 'This mailbox is out of sends for today. The email is kept and goes out tomorrow.' });
    } else if (hourlyRemaining !== null && hourlyRemaining <= 0) {
      items.push({ id: 'quota', severity: 'warn', label: 'Hourly limit reached', detail: 'This mailbox hit its hourly limit. The email is kept and goes out when the hour rolls over.' });
    } else if (dailyRemaining <= LOW_QUOTA_THRESHOLD) {
      items.push({ id: 'quota', severity: 'warn', label: 'Few sends left today', detail: `${dailyRemaining} of ${input.quota.dailyCap} sends left today on this mailbox.` });
    } else {
      items.push({ id: 'quota', severity: 'ok', label: 'Sending capacity', detail: `${dailyRemaining} of ${input.quota.dailyCap} sends left today.` });
    }
  }

  if (input.missingFields.length > 0) {
    items.push({
      id: 'variables', severity: 'warn', label: 'Missing values',
      detail: `No value for ${input.missingFields.map((f) => `{{${f}}}`).join(', ')}. Add a fallback or it goes out blank.`,
    });
  } else {
    items.push({ id: 'variables', severity: 'ok', label: 'Every variable has a value', detail: 'Nothing in the subject or body will go out blank.' });
  }

  if (input.bulk) {
    items.push(
      UNSUBSCRIBE.test(input.body)
        ? { id: 'unsubscribe', severity: 'ok', label: 'Unsubscribe link present', detail: 'The body offers an unsubscribe option.' }
        : { id: 'unsubscribe', severity: 'warn', label: 'No unsubscribe footer', detail: 'Bulk email should carry an unsubscribe link in the body, not only in the headers.' },
    );
  }

  return { items, canSend: !items.some((i) => i.severity === 'block') };
}
