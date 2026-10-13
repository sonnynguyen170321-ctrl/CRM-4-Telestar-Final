'use client';

import React from 'react';
import { Mail, AlertTriangle, Clock, CheckCircle2, Loader2 } from 'lucide-react';
import type { EmailStepInfo } from '@/lib/sequences/autoSendState';

/**
 * What the CRM is doing with an email it sends itself, in place of Complete and Skip.
 *
 * The task is a record of a send the CRM owns, so the list says where that send is: scheduled,
 * held (and why), failed (and why), being checked, or sent. Two quiet links remain for the cases a
 * person really has: "I sent it outside the CRM" and "Don't send".
 */

const TONE: Record<string, string> = {
  scheduled: 'bg-blue-500/10 text-blue-700 border-blue-500/20',
  sending: 'bg-blue-500/10 text-blue-700 border-blue-500/20',
  checking: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
  held: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
  failed: 'bg-red-500/10 text-red-700 border-red-500/20',
  sent: 'bg-green-500/10 text-green-700 border-green-500/20',
  skipped: 'bg-card-border text-text-secondary border-transparent',
};

/** "Sending automatically (scheduled Tue 09:30)": the text a rep reads in the list. */
export function autoSendText(step: EmailStepInfo): string {
  if (step.state === 'scheduled' && step.scheduledAt) {
    const when = new Date(step.scheduledAt).toLocaleString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    return `${step.label} (scheduled ${when})`;
  }
  return step.label;
}

function StateIcon({ state }: { state: EmailStepInfo['state'] }) {
  const cls = 'w-3.5 h-3.5 flex-shrink-0';
  if (state === 'failed' || state === 'held') return <AlertTriangle className={cls} aria-hidden="true" />;
  if (state === 'sent') return <CheckCircle2 className={cls} aria-hidden="true" />;
  if (state === 'sending' || state === 'checking') return <Loader2 className={`${cls} animate-spin`} aria-hidden="true" />;
  if (state === 'scheduled') return <Clock className={cls} aria-hidden="true" />;
  return <Mail className={cls} aria-hidden="true" />;
}

interface AutoSendStatusProps {
  step: EmailStepInfo;
  /** Offered only while the task is still open and the send is not already with the mail worker. */
  onSentOutside?: () => void;
  onDontSend?: () => void;
}

export default function AutoSendStatus({ step, onSentOutside, onDontSend }: AutoSendStatusProps) {
  const inFlight = step.state === 'sending' || step.state === 'checking';
  return (
    <div className="flex flex-col items-end gap-1 max-w-[18rem]">
      <span
        role="status"
        title={step.reason ?? undefined}
        className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border inline-flex items-center gap-1.5 text-left ${TONE[step.state ?? 'scheduled']}`}
      >
        <StateIcon state={step.state} />
        <span>{autoSendText(step)}</span>
      </span>
      {!inFlight && (onSentOutside || onDontSend) && (
        <span className="flex items-center gap-3 text-[11px] text-text-muted">
          {onSentOutside && (
            <button type="button" onClick={onSentOutside} className="hover:text-text-primary hover:underline">
              I sent it outside the CRM
            </button>
          )}
          {onDontSend && (
            <button type="button" onClick={onDontSend} className="hover:text-text-primary hover:underline">
              Don’t send
            </button>
          )}
        </span>
      )}
    </div>
  );
}
