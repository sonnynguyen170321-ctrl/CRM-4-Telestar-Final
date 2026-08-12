import React from 'react';
import { FlaskConical } from 'lucide-react';

/**
 * Presenter controls: deliver a controlled inbound reply during the walkthrough.
 *
 * Nothing is staged. Each button posts to `/api/demo/inbound-reply`, which runs the message
 * through the same sync chokepoint real mail goes through — classification, handoff and the
 * transition ledger all happen for real. The endpoint refuses outside the demo tenant, so this
 * panel is inert everywhere else.
 *
 * Visually understated on purpose: it is scaffolding for the demo, not part of the product being
 * demonstrated.
 */

const REPLIES: Array<{ key: string; label: string; body: string; auto: boolean }> = [
  {
    key: 'interest',
    label: 'Interested reply',
    body: "This is interesting. We're actually reviewing this problem right now. Can you send me more detail on how the implementation works?",
    auto: false,
  },
  { key: 'pricing', label: 'Pricing question', body: 'How much does this cost?', auto: false },
  { key: 'ooo', label: 'Out of office', body: "I'm out of office until next Monday.", auto: true },
  { key: 'unsubscribe', label: 'Unsubscribe', body: 'Please unsubscribe me.', auto: false },
  { key: 'ambiguous', label: 'Ambiguous reply', body: 'Thanks for reaching out. We are evaluating multiple vendors and might discuss this next quarter.', auto: false },
];

export default function DemoReplyControls({
  leadId, disabled, busy, onBusyChange, onDelivered,
}: {
  leadId: string;
  disabled: boolean;
  busy: string | null;
  onBusyChange: (key: string | null) => void;
  onDelivered: (message: string) => void | Promise<void>;
}) {
  const deliver = async (reply: (typeof REPLIES)[number]) => {
    onBusyChange(`reply-${reply.key}`);
    try {
      const res = await fetch('/api/demo/inbound-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, body: reply.body, autoReply: reply.auto }),
      });
      const out = await res.json();
      onBusyChange(null);
      await onDelivered(
        res.ok
          ? `Reply delivered — class ${out.replyClass} (${out.replyKind}), ${out.handoffApplied ? 'handed to the SDR' : 'no SDR interrupt'}.`
          : `Could not deliver the reply: ${out.error ?? 'the request was refused'}.`
      );
    } catch {
      onBusyChange(null);
      await onDelivered('Could not deliver the reply. Nothing was changed.');
    }
  };

  return (
    <section className="rounded-xl border border-dashed border-card-border bg-gray-50/60 px-5 py-4">
      <h3 className="type-subsection flex items-center gap-2 text-text-secondary">
        <FlaskConical className="w-4 h-4" aria-hidden="true" />
        Demo controls
      </h3>
      <p className="type-micro text-text-muted mt-1 prose-measure">
        Deliver a controlled inbound reply. It goes through the same sync chokepoint as real mail —
        classification, handoff and the transition ledger are all real.
      </p>
      <div className="flex flex-wrap gap-2 mt-3">
        {REPLIES.map((r) => (
          <button
            key={r.key}
            type="button"
            disabled={disabled}
            onClick={() => void deliver(r)}
            className="px-3 py-1.5 rounded-md border border-card-border bg-card-bg type-micro text-text-secondary transition-colors hover:bg-gray-50 hover:text-text-primary disabled:opacity-50 focus-ring"
            data-testid={`demo-reply-${r.key}`}
          >
            {busy === `reply-${r.key}` ? 'Delivering…' : r.label}
          </button>
        ))}
      </div>
    </section>
  );
}
