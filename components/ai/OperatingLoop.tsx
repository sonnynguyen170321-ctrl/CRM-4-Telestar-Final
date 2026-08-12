import React from 'react';
import { ChevronRight } from 'lucide-react';
import { operatingStateMeta } from '@/components/operating/states';

/**
 * The operating loop, as a single line a stranger can follow.
 *
 * Seven states, left to right, each with the number of prospects sitting in it right now. The
 * point of putting it on screen is that the handoff in the middle — AI Managing → Needs Human →
 * SDR Managing — is the whole product argument, and a stepper makes it obvious that the AI stops
 * there rather than continuing past it.
 *
 * Counts come from the same buckets the queue is built from, so this cannot disagree with the
 * list underneath it. No chart library: seven boxes and six chevrons.
 */

/** Bucket key each step reads its count from, plus the enum the label is derived from. */
const STEPS: Array<{ state: string; bucket: string }> = [
  { state: 'researching', bucket: 'ai_managed' },
  { state: 'ready_for_outreach', bucket: 'ai_managed' },
  { state: 'ai_managed', bucket: 'ai_managed' },
  { state: 'human_attention', bucket: 'needs_attention' },
  { state: 'human_managed', bucket: 'human_managed' },
  { state: 'waiting_for_prospect', bucket: 'waiting' },
  { state: 'reengagement_eligible', bucket: 'reengagement_eligible' },
  // Closes the loop. Without it a handed-back prospect vanished from the stepper while still
  // being counted in the AI Managed tab — the two read as contradicting each other.
  { state: 'ai_reengagement', bucket: 'ai_managed' },
];

const TONE_RING: Record<string, string> = {
  ai: 'border-blue-200 bg-blue-50/60',
  attention: 'border-red-200 bg-red-50/60',
  human: 'border-emerald-200 bg-emerald-50/60',
  waiting: 'border-amber-200 bg-amber-50/60',
  eligible: 'border-orange-200 bg-orange-50/60',
  neutral: 'border-card-border bg-card-bg',
  blocked: 'border-red-300 bg-red-50/60',
  done: 'border-emerald-200 bg-emerald-50/60',
};

export default function OperatingLoop({
  stateCounts,
  activeState,
  onSelect,
}: {
  /**
   * Operating-state enum → count, tallied from the prospects the buckets already carry. Counting
   * per state rather than per bucket matters: Researching, Ready for Outreach and AI Managing all
   * live in the `ai_managed` bucket, and repeating the bucket total under all three would
   * misstate where prospects actually are.
   */
  stateCounts: Record<string, number>;
  activeState?: string | null;
  onSelect?: (bucketKey: string) => void;
}) {
  return (
    <div className="overflow-x-auto" data-testid="operating-loop">
      <ol className="flex items-stretch gap-1 min-w-max">
        {STEPS.map((step, i) => {
          const meta = operatingStateMeta(step.state);
          const count = stateCounts[step.state] ?? 0;
          const isActive = activeState === step.bucket;

          const box = (
            <span
              className={`flex flex-col justify-between h-full px-3 py-2 rounded-lg border ${TONE_RING[meta.tone]} ${
                isActive ? 'ring-1 ring-brand-red/40' : ''
              } ${onSelect ? 'transition-colors hover:border-text-muted' : ''}`}
            >
              <span className="type-micro text-text-secondary whitespace-nowrap">{meta.label}</span>
              <span className="font-mono type-subsection text-text-primary mt-1">{count}</span>
            </span>
          );

          return (
            <li key={step.state} className="flex items-center gap-1">
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(step.bucket)}
                  className="text-left h-full focus-ring rounded-lg"
                  title={meta.hint}
                >
                  {box}
                </button>
              ) : (
                <span title={meta.hint} className="h-full">{box}</span>
              )}
              {i < STEPS.length - 1 && (
                <ChevronRight className="w-3.5 h-3.5 text-text-muted shrink-0" aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
