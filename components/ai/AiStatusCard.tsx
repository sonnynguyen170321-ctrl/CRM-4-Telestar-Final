import React from 'react';
import { Sparkles, UserCheck } from 'lucide-react';
import { isAiOwned } from '@/components/operating/states';
import type { HandoffPackage } from './types';

/**
 * What AI is doing about this prospect right now, and what it is not allowed to do.
 *
 * The second half matters as much as the first. When a human owns the conversation the card says
 * so explicitly — AI stays available for drafting and summarising and cannot contact the prospect
 * — because "AI is off" and "AI may not touch the prospect" are different claims and only one of
 * them is true.
 *
 * Every line is read from stored state. `Next` shows the enrollment's `nextActionAt`, which the
 * automation scheduler owns; nothing here computes a time.
 */

function formatWhen(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `Today · ${time}`;
  if (isTomorrow) return `Tomorrow · ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${time}`;
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-2 border-t border-card-border first:border-t-0">
      <span className="type-micro text-text-muted w-16 shrink-0 pt-0.5">{label}</span>
      <span className="type-meta text-text-primary prose-measure">{children}</span>
    </div>
  );
}

export default function AiStatusCard({ pkg }: { pkg: HandoffPackage }) {
  const state = pkg.prospect.operatingState;
  const aiOwns = isAiOwned(state);
  const seq = pkg.sequence;
  const nextAt = formatWhen(seq?.nextActionAt ?? null);

  const headline = aiOwns
    ? 'AI is managing outreach.'
    : state === 'waiting_for_prospect'
    ? 'Waiting on the prospect.'
    : state === 'reengagement_eligible'
    ? 'Quiet long enough to re-engage.'
    : 'An SDR is managing this conversation.';

  const current = (() => {
    if (pkg.workOrder && ['active', 'pending', 'paused'].includes(pkg.workOrder.status)) {
      return `Work order ${pkg.workOrder.type.replace(/_/g, ' ')} · ${pkg.workOrder.status}`;
    }
    if (seq) {
      const step = seq.currentStep !== null ? ` · step ${seq.currentStep}` : '';
      return `${seq.name}${step}${seq.status ? ` · ${seq.status}` : ''}`;
    }
    return 'No sequence or work order is running.';
  })();

  const next = (() => {
    if (state === 'human_attention') return 'SDR response required.';
    if (state === 'human_managed') return 'Whatever you decide — nothing is scheduled by AI.';
    if (state === 'reengagement_eligible') return 'Nothing, until a human hands the prospect back.';
    if (nextAt) return nextAt;
    if (state === 'ai_reengagement') return 'A re-engagement plan has to be approved before anything sends.';
    return 'Nothing is scheduled.';
  })();

  const why = (() => {
    if (state === 'human_attention') return 'The prospect replied, so AI stopped and handed over.';
    if (state === 'human_managed') return 'You took ownership of the conversation.';
    if (state === 'waiting_for_prospect') return 'The last touch was delivered and no reply has arrived.';
    if (state === 'reengagement_eligible') return 'No response for long enough to clear the waiting period.';
    if (seq?.pausedReason) return seq.pausedReason.replace(/_/g, ' ');
    if (state === 'researching') return 'Evidence has to exist before any outreach is allowed.';
    return 'Running the approved sequence for this campaign.';
  })();

  return (
    <section
      className={`rounded-xl border p-4 ${aiOwns ? 'border-blue-200 bg-blue-50/40' : 'border-card-border bg-card-bg'}`}
      data-testid="ai-status"
    >
      <h3 className="type-subsection flex items-center gap-2">
        {aiOwns ? (
          <Sparkles className="w-4 h-4 text-blue-700" aria-hidden="true" />
        ) : (
          <UserCheck className="w-4 h-4 text-emerald-700" aria-hidden="true" />
        )}
        AI status
      </h3>

      <p className="type-body text-text-primary mt-2">{headline}</p>

      {!aiOwns && (
        <p className="type-meta text-text-muted mt-1 prose-measure">
          AI is available for assistance but cannot contact the prospect autonomously.
        </p>
      )}

      <div className="mt-3">
        <Line label="Current">{current}</Line>
        <Line label="Next">{next}</Line>
        <Line label="Why">{why}</Line>
      </div>
    </section>
  );
}
