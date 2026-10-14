'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Gauge } from 'lucide-react';
import { scoreContent } from '@/lib/compose/contentScore';

/** How long the draft has to be still before the score is recomputed. */
const SCORE_DEBOUNCE_MS = 400;

function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

const toneOf = (score: number) => (score >= 80 ? 'text-green-600' : score >= 60 ? 'text-amber-600' : 'text-brand-red');

/**
 * The content score (lib/compose/contentScore.ts) under the editor: one number, a row of the facts
 * it is built from, and the few changes that would raise it most. Deterministic, local, no AI.
 * Collapsed to one line until opened, so it informs without crowding the draft.
 */
export default function ContentScorePanel({ subject, body }: { subject: string; body: string }) {
  // Scored from the debounced draft only: `draft` changes once typing has paused for
  // SCORE_DEBOUNCE_MS, so a keystroke never runs the score (which parses the body once).
  const draft = useDebounced(useMemo(() => ({ subject, body }), [subject, body]), SCORE_DEBOUNCE_MS);
  const result = useMemo(() => scoreContent(draft), [draft]);
  const { metrics: m } = result;

  if (result.empty) return null;

  const facts = [
    `${m.words} words`,
    m.readingGrade !== null ? `grade ${m.readingGrade}` : null,
    `${m.links} ${m.links === 1 ? 'link' : 'links'}`,
    m.images ? `${m.images} ${m.images === 1 ? 'image' : 'images'}` : null,
    `${m.questions} ${m.questions === 1 ? 'question' : 'questions'}`,
    `${m.variables.length} ${m.variables.length === 1 ? 'variable' : 'variables'}`,
    `"I/we" ${m.firstPerson} : "you" ${m.secondPerson}`,
    `subject ${m.subjectLength} chars`,
  ].filter((f): f is string => Boolean(f));

  return (
    <details className="rounded-lg border border-card-border bg-bg-main/40 p-2.5 text-xs">
      <summary className="flex cursor-pointer items-center gap-1.5 font-semibold text-text-primary">
        <Gauge className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
        Content score
        <span className={`tabular-nums ${toneOf(result.score)}`} aria-label={`${result.score} out of 100, ${result.label}`}>
          {result.score}
        </span>
        <span className="font-normal text-text-muted">{result.label}{result.tips.length ? ` - ${result.tips.length} ${result.tips.length === 1 ? 'tip' : 'tips'}` : ''}</span>
      </summary>
      <div className="mt-2 space-y-1.5">
        <p className="text-text-muted">{facts.join(' · ')}{result.language === 'vi' ? ' · Vietnamese (no reading grade)' : ''}</p>
        {m.spamWords.length > 0 && <p className="text-text-muted">Trigger words: {m.spamWords.join(', ')}</p>}
        {result.tips.length > 0 ? (
          <ul className="list-disc space-y-0.5 pl-4 text-text-secondary">
            {result.tips.map((tip) => <li key={tip}>{tip}</li>)}
          </ul>
        ) : (
          <p className="text-text-secondary">Nothing to fix: short, personal and easy to answer.</p>
        )}
      </div>
    </details>
  );
}
