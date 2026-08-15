import React from 'react';
import Link from 'next/link';
import type { StatusTone } from './states';

/**
 * One number, with enough context to act on it.
 *
 * Four of these across the top of a screen is the budget. Fifteen is a wall of digits nobody
 * reads, which is what the dashboard used to be — the point of a command center is that the eye
 * lands somewhere first.
 */

const ACCENT: Record<StatusTone, string> = {
  ai: 'text-blue-700',
  attention: 'text-brand-red',
  human: 'text-emerald-700',
  waiting: 'text-amber-700',
  eligible: 'text-brand-orange-text',
  neutral: 'text-text-secondary',
  blocked: 'text-red-800',
  done: 'text-emerald-700',
};

interface MetricCardProps {
  label: string;
  value: number | string;
  tone?: StatusTone;
  icon?: React.ComponentType<{ className?: string }>;
  /** Secondary line — what the number means, not a second number. */
  hint?: string;
  href?: string;
  testId?: string;
  /** Draws the card as the one that matters most on the row. */
  emphasis?: boolean;
}

export default function MetricCard({
  label, value, tone = 'neutral', icon: Icon, hint, href, testId, emphasis = false,
}: MetricCardProps) {
  const body = (
    <>
      <div className="flex items-center gap-2">
        {Icon && <Icon className={`w-4 h-4 shrink-0 ${ACCENT[tone]}`} aria-hidden="true" />}
        <span className="type-meta text-text-secondary">{label}</span>
      </div>
      <div className={`font-mono type-page-title mt-2 ${emphasis ? ACCENT[tone] : 'text-text-primary'}`} data-testid={testId}>
        {value}
      </div>
      {hint && <p className="type-micro text-text-muted mt-1 leading-snug">{hint}</p>}
    </>
  );

  const shell = `block rounded-xl border bg-card-bg px-4 py-4 transition-colors ${
    emphasis ? 'border-brand-red/30' : 'border-card-border'
  }`;

  if (href) {
    return (
      <Link href={href} className={`${shell} hover:border-text-muted focus-ring`}>
        {body}
      </Link>
    );
  }
  return <div className={shell}>{body}</div>;
}
