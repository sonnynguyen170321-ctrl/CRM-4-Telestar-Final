'use client';

import React, { useEffect, useState } from 'react';
import { Check, Copy, FileText, HelpCircle, Loader2, PhoneCall, PlugZap, Sparkles } from 'lucide-react';
import type { AssistResult } from './types';

/**
 * AI as the SDR's copilot — drafting, summarising, preparing. Never sending.
 *
 * There is deliberately no send control on this panel. `prospect_reply` is `human_only` at every
 * autonomy setting, and a button here that looked like it dispatched mail would misrepresent the
 * permission model even if the request behind it were refused.
 *
 * The unavailable path is a designed state, not an error. With no provider configured the CRM's
 * own recommended objective is still on screen, which is the point being demonstrated: the
 * operating model does not depend on the model.
 */

const SECONDARY: Array<{ kind: string; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { kind: 'summary', label: 'Summarise thread', icon: FileText },
  { kind: 'objection_help', label: 'Objection help', icon: HelpCircle },
  { kind: 'meeting_prep', label: 'Prepare call', icon: PhoneCall },
];

export default function AssistPanel({
  leadId, assist, busy, onAssist,
}: {
  leadId: string;
  assist: AssistResult | null;
  busy: string | null;
  onAssist: (kind: string) => void;
}) {
  const disabled = busy !== null;

  // The draft as the rep has edited it. Controlled, because the difference between what AI wrote
  // and what the rep is actually going to send is the entire signal (Phase 10).
  const [edited, setEdited] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    setEdited(assist?.text ?? '');
    setFeedback(null);
  }, [assist?.text, assist?.kind]);

  /**
   * "I used this."
   *
   * Records how much of the draft survived and nothing else. It sends no mail — the rep still
   * sends the message themselves, which is what `prospect_reply` being `human_only` means in
   * practice rather than in policy.
   */
  const recordUse = async () => {
    setRecording(true);
    try {
      const res = await fetch('/api/ai/draft-outcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId,
          draft: assist?.text ?? '',
          sent: edited,
          occurrenceKey: `${assist?.kind ?? 'draft'}:${(assist?.text ?? '').length}`,
        }),
      });
      const body = await res.json();
      setFeedback(
        res.ok
          ? 'Thanks — recorded how much of the draft you kept. Nothing was sent.'
          : (body.error ?? 'Could not record that.')
      );
    } catch {
      setFeedback('Could not record that. Nothing was sent either way.');
    } finally {
      setRecording(false);
    }
  };

  return (
    <section className="rounded-xl border border-card-border bg-card-bg px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="type-subsection flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-700" aria-hidden="true" />
            AI assistance
          </h3>
          <p className="type-micro text-text-muted mt-1 prose-measure">
            Internal drafts only. Nothing here reaches the prospect — you copy, edit and send it yourself.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-4">
        <button
          type="button"
          onClick={() => onAssist('reply_draft')}
          disabled={disabled}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-red text-white type-meta transition-colors hover:bg-brand-red-hover disabled:opacity-50 focus-ring"
          data-testid="assist-reply_draft"
        >
          {busy === 'reply_draft' ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="w-4 h-4" aria-hidden="true" />
          )}
          Draft response
        </button>

        {SECONDARY.map((a) => (
          <button
            key={a.kind}
            type="button"
            onClick={() => onAssist(a.kind)}
            disabled={disabled}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-card-border type-meta text-text-secondary transition-colors hover:bg-gray-50 hover:text-text-primary disabled:opacity-50 focus-ring"
            data-testid={`assist-${a.kind}`}
          >
            {busy === a.kind ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <a.icon className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            {a.label}
          </button>
        ))}
      </div>

      {assist && (
        <div className="mt-4" data-testid="assist-output">
          {assist.available ? (
            <div className="rounded-lg border border-card-border overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-card-border bg-gray-50">
                <span className="type-meta text-text-secondary">{assist.label}</span>
                <span className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => { void navigator.clipboard?.writeText(edited); }}
                    className="inline-flex items-center gap-1.5 type-micro text-text-secondary hover:text-text-primary focus-ring rounded px-1"
                  >
                    <Copy className="w-3 h-3" aria-hidden="true" /> Copy
                  </button>
                  <button
                    type="button"
                    onClick={() => { void recordUse(); }}
                    disabled={recording}
                    className="inline-flex items-center gap-1.5 type-micro text-text-secondary hover:text-text-primary focus-ring rounded px-1 disabled:opacity-50"
                    title="Records how much of the draft you kept. Sends nothing."
                    data-testid="assist-used"
                  >
                    <Check className="w-3 h-3" aria-hidden="true" /> I used this
                  </button>
                </span>
              </div>
              <textarea
                value={edited}
                onChange={(e) => setEdited(e.target.value)}
                rows={9}
                aria-label={`${assist.label} draft`}
                className="w-full px-4 py-3 type-body text-text-primary bg-card-bg resize-y focus:outline-none"
              />
              {feedback && (
                <p className="px-4 py-2 type-micro text-text-secondary border-t border-card-border bg-gray-50" data-testid="assist-feedback">
                  {feedback}
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-card-border bg-gray-50 px-4 py-4">
              <p className="type-body text-text-primary flex items-center gap-2">
                <PlugZap className="w-4 h-4 text-text-muted" aria-hidden="true" />
                AI assistance unavailable
              </p>
              <p className="type-meta text-text-muted mt-1.5 prose-measure">
                CRM context and the recommended objective remain available. Connect an AI provider to
                generate a contextual draft.
              </p>
              <p className="type-meta text-text-primary mt-3 prose-measure">
                {assist.recommendedObjective}
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
