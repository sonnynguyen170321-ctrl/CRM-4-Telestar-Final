'use client';

import React from 'react';
import Link from 'next/link';
import { AlertCircle, Gauge } from 'lucide-react';
import type { ComposeMailbox } from './types';

/** One short line per mailbox for the picker: its state, then what it can still send today. */
export function mailboxOptionLabel(mailbox: ComposeMailbox): string {
  if (mailbox.sendPausedAt) return `${mailbox.email} - paused`;
  if (mailbox.healthLevel === 'critical') return `${mailbox.email} - health critical`;
  if (mailbox.quota) return `${mailbox.email} - ${mailbox.quota.dailyRemaining} left today`;
  return mailbox.email;
}

interface MailboxSelectProps {
  id: string;
  mailboxes: readonly ComposeMailbox[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** Closes the surrounding dialog before following a link. */
  onNavigate?: () => void;
  disabled?: boolean;
}

/**
 * The From line: which mailbox the email leaves from, with what the rep needs to know before
 * writing - whether it is paused (a manager's decision), whether its health is critical, and how
 * much of today's and this hour's allowance is left. The worker still decides; running out of
 * allowance defers the email, it never drops it, and the line says so.
 */
export default function MailboxSelect({ id, mailboxes, selectedId, onSelect, onNavigate, disabled }: MailboxSelectProps) {
  const mailbox = mailboxes.find((m) => m.id === selectedId) ?? null;

  if (mailboxes.length === 0) {
    return (
      <div className="flex gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-normal text-text-secondary">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
        <span>
          No email account connected.{' '}
          <Link href="/settings" onClick={onNavigate} className="font-semibold text-brand-orange-text hover:underline">Connect one in Settings</Link>{' '}
          to send from the CRM.
        </span>
      </div>
    );
  }

  const quota = mailbox?.quota;
  const dailyOut = quota !== undefined && quota.dailyRemaining === 0;
  const hourlyOut = quota !== undefined && quota.hourlyRemaining === 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="w-16 shrink-0 text-xs font-semibold text-text-muted">From</label>
        <select
          id={id}
          value={selectedId}
          disabled={disabled}
          onChange={(event) => onSelect(event.target.value)}
          className="flex-1 rounded-lg border border-card-border bg-bg-main px-2.5 py-1.5 text-xs font-medium text-text-primary focus:border-brand-red focus:outline-none"
        >
          {mailboxes.map((m) => (
            <option key={m.id} value={m.id}>{mailboxOptionLabel(m)}</option>
          ))}
        </select>
      </div>

      {mailbox?.sendPausedAt ? (
        // Said before the rep writes, not after the worker refuses it.
        <div role="status" className="ml-[4.5rem] flex gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-2.5 text-xs leading-normal text-text-secondary">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
          <span>
            Sending is paused for <strong>{mailbox.email}</strong>
            {mailbox.sendPauseReason ? <> - {mailbox.sendPauseReason}</> : null}. A manager can resume it under{' '}
            <Link href="/email-health" onClick={onNavigate} className="font-semibold text-brand-orange-text hover:underline">Email Health</Link>.
            {mailboxes.length > 1 ? ' Pick another mailbox to send now.' : ''}
          </span>
        </div>
      ) : (
        <div className="ml-[4.5rem] space-y-1 text-xs leading-normal text-text-secondary">
          {mailbox?.healthLevel === 'critical' && (
            <p className="flex gap-1.5 text-amber-600 dark:text-amber-400">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              This mailbox has critical health; a manager may have stopped it from sending.
            </p>
          )}
          {quota && (
            <p className="flex items-center gap-1.5">
              <Gauge className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true" />
              {dailyOut
                ? 'Daily limit reached. This email is queued and goes out when the allowance resets.'
                : hourlyOut
                  ? 'Hourly limit reached. This email is queued and goes out within the hour.'
                  : `${quota.dailyRemaining} of ${quota.dailyCap} left today${quota.hourlyRemaining === null ? '' : `, ${quota.hourlyRemaining} this hour`}.`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
