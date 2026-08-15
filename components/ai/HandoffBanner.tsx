import React from 'react';
import { ArrowRight, MessageSquareQuote, Sparkles } from 'lucide-react';
import StatusBadge from '@/components/operating/StatusBadge';
import type { HandoffPackage } from './types';
import { relativeTime } from './types';

/**
 * The moment the operating model changes hands.
 *
 * A prospect replied, AI stopped, and a person now owns the conversation. That sentence is the
 * whole product argument, so it gets a banner rather than a row in a table — the reply in the
 * prospect's own words, what the classifier made of it, and the transfer of ownership stated
 * plainly underneath.
 *
 * Everything shown is a stored fact. Confidence renders only when the classifier actually
 * produced one: the deterministic path stores `null`, and printing "100%" next to a rule-based
 * match would be an invented number dressed up as a model output.
 */
export default function HandoffBanner({
  pkg, ownerName,
}: {
  pkg: HandoffPackage;
  ownerName: string | null;
}) {
  const reply = pkg.latestReply;
  if (!reply) return null;

  const isHandedOver = pkg.prospect.operatingState === 'human_attention' || pkg.handoffAt !== null;

  return (
    <section
      className="rounded-xl border border-red-200 bg-red-50/50 overflow-hidden"
      aria-labelledby="handoff-heading"
      data-testid="latest-reply"
    >
      <div className="px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          {isHandedOver && <StatusBadge label="Human attention required" tone="attention" size="md" />}
          <span className="type-meta text-text-secondary">
            {pkg.prospect.name.split(' ')[0]} replied {relativeTime(reply.at)}
          </span>
        </div>

        <h2 id="handoff-heading" className="sr-only">Inbound reply and handoff</h2>

        <blockquote className="mt-3 flex gap-3">
          <MessageSquareQuote className="w-4 h-4 text-brand-red shrink-0 mt-1" aria-hidden="true" />
          <p className="type-body text-text-primary prose-measure whitespace-pre-wrap italic">
            {reply.body}
          </p>
        </blockquote>

        <div className="flex flex-wrap items-center gap-2 mt-3 pl-7">
          {reply.kindLabel && (
            <StatusBadge label={reply.kindLabel} tone="attention" data-testid="reply-kind" />
          )}
          {reply.classLabel && <StatusBadge label={reply.classLabel} tone="neutral" />}
          {reply.confidence !== null && (
            <span className="type-micro text-text-muted font-mono">
              {(reply.confidence * 100).toFixed(0)}% confidence
              {reply.source ? ` · ${reply.source}` : ''}
            </span>
          )}
        </div>
      </div>

      {isHandedOver && (
        <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-t border-red-200 bg-white/70">
          <span className="inline-flex items-center gap-2 type-meta text-text-primary">
            <Sparkles className="w-4 h-4 text-blue-700" aria-hidden="true" />
            AI stopped autonomous outreach
          </span>
          <ArrowRight className="w-4 h-4 text-text-muted" aria-hidden="true" />
          <span className="type-meta text-text-primary">
            Ownership transferred to <strong>{ownerName ?? 'the assigned SDR'}</strong>
          </span>
        </div>
      )}
    </section>
  );
}
