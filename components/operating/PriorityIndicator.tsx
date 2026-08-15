import React from 'react';
import { priorityMeta } from './states';

/**
 * The CRM's deterministic priority, shown as a level plus a three-bar meter.
 *
 * `Lead.crmPriorityScore` is the enum hot / warm / cold. There is no 0-100 fit score in this
 * schema, so this component does not display one — inventing a number would put a confident,
 * unfalsifiable figure on screen that nothing in the database backs.
 */

const BAR_TONE: Record<string, string> = {
  attention: 'bg-brand-red',
  eligible: 'bg-brand-gold',
  neutral: 'bg-gray-400',
};

export default function PriorityIndicator({
  priority, className = '',
}: {
  priority: string | null | undefined;
  className?: string;
}) {
  const meta = priorityMeta(priority);
  const fill = BAR_TONE[meta.tone] ?? 'bg-gray-400';

  return (
    <span
      className={`inline-flex items-center gap-2 ${className}`}
      title={`CRM priority: ${priority ?? 'warm'}`}
    >
      <span className="flex items-end gap-0.5" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={`w-1 rounded-[1px] ${n <= meta.bars ? fill : 'bg-gray-200'}`}
            style={{ height: `${4 + n * 3}px` }}
          />
        ))}
      </span>
      <span className="type-meta text-text-secondary">{meta.label}</span>
    </span>
  );
}
