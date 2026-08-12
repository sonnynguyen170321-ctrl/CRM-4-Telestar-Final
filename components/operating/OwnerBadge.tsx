import React from 'react';
import { Sparkles } from 'lucide-react';
import { isAiOwned } from './states';

/**
 * Who is responsible for this prospect right now.
 *
 * A lead is always *assigned* to a person — that is a CRM record, not an answer. While AI is
 * running the outreach, the answer is AI; the assignee is who it hands back to. Showing the
 * person's name in both cases is the single most confusing thing this UI could do, so the two
 * read completely differently: a tinted AI chip versus initials and a name.
 */
export default function OwnerBadge({
  operatingState, ownerName, ownerRole, className = '',
}: {
  operatingState: string | null | undefined;
  ownerName: string | null | undefined;
  ownerRole?: string | null;
  className?: string;
}) {
  if (isAiOwned(operatingState)) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-blue-200 bg-blue-50 text-blue-700 type-micro whitespace-nowrap ${className}`}
        title={ownerName ? `AI is managing outreach. Hands back to ${ownerName}.` : 'AI is managing outreach.'}
      >
        <Sparkles className="w-3 h-3 shrink-0" aria-hidden="true" />
        AI Managed
      </span>
    );
  }

  if (!ownerName) {
    return <span className={`type-meta text-text-muted ${className}`}>Unassigned</span>;
  }

  const initials = ownerName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <span className={`inline-flex items-center gap-2 min-w-0 ${className}`}>
      <span className="w-6 h-6 rounded-full bg-brand-orange/10 text-brand-orange-text flex items-center justify-center type-micro shrink-0">
        {initials}
      </span>
      <span className="min-w-0">
        <span className="block type-meta text-text-primary truncate">{ownerName}</span>
        {ownerRole && <span className="block type-micro text-text-muted">{ownerRole}</span>}
      </span>
    </span>
  );
}
