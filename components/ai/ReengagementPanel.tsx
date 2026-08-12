import React from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import type { HandoffPackage } from './types';
import { relativeTime } from './types';

/**
 * Handback: the one thing AI is not allowed to do for itself.
 *
 * A prospect going quiet makes them *eligible*; it does not start anything. This panel exists to
 * make that boundary visible — the context is preserved, the recommendation is ready, and nothing
 * happens until a person presses the button.
 *
 * The button's own wording is careful too. Pressing it opens a re-engagement work order awaiting
 * an approved plan; it does not send an email, and the result line says exactly that.
 */
export default function ReengagementPanel({
  pkg, busy, disabled, onHandback,
}: {
  pkg: HandoffPackage;
  busy: boolean;
  disabled: boolean;
  onHandback: () => void;
}) {
  const eligible = pkg.prospect.operatingState === 'reengagement_eligible';
  const lastOutbound = [...pkg.thread].reverse().find((m) => m.direction === 'out') ?? null;

  return (
    <section className="rounded-xl border border-orange-200 bg-orange-50/40 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="type-subsection">
            {eligible ? 'Re-engagement eligible' : 'Waiting for the prospect'}
          </h3>
          <p className="type-meta text-text-secondary mt-1 prose-measure">
            {lastOutbound
              ? `No response since the last touch ${relativeTime(lastOutbound.at)}.`
              : 'No response recorded.'}
            {' '}Previous conversation context is preserved.
          </p>
          <p className="type-meta text-text-primary mt-2 prose-measure">
            AI cannot resume outreach without an explicit handback.
          </p>
        </div>

        <button
          type="button"
          onClick={onHandback}
          disabled={disabled}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-orange text-white type-meta transition-colors hover:bg-brand-orange-hover disabled:opacity-50 focus-ring shrink-0"
          data-testid="handback"
        >
          {busy ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <RotateCcw className="w-4 h-4" aria-hidden="true" />
          )}
          Resume AI follow-up
        </button>
      </div>
    </section>
  );
}
