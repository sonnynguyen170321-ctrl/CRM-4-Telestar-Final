'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, PencilLine, Send } from 'lucide-react';

type ActivityItem = {
  id: string;
  at: string;
  kind: 'edit' | 'cadence';
  actor: { id: string; name: string } | null;
  summary: string;
  lead?: { id: string; name: string } | null;
};

/**
 * Sequence activity tab (lib/sequences/activity.ts): who changed the sequence, and what the cadence
 * did to which lead, newest first. Reps see cadence events only for leads they can see.
 */
export function SequenceActivityPanel({ sequenceId }: { sequenceId: string }) {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/sequences/${sequenceId}/activity`);
        if (cancelled) return;
        if (!res.ok) {
          setError('Could not load activity');
          return;
        }
        const data = (await res.json()) as { items: ActivityItem[] };
        setItems(data.items);
      } catch {
        if (!cancelled) setError('Network error loading activity');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sequenceId]);

  if (error) return <p className="text-xs text-red-600">{error}</p>;
  if (!items) {
    return (
      <div className="flex items-center gap-2 text-xs text-text-secondary">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading activity…
      </div>
    );
  }
  if (items.length === 0) {
    return <p className="text-xs text-text-secondary">Nothing has happened on this sequence yet.</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-text-secondary">Latest {items.length} events — edits and cadence actions.</p>
      <ul className="bg-card-bg border border-card-border rounded-xl divide-y divide-card-border">
        {items.map((item) => {
          const Icon = item.kind === 'edit' ? PencilLine : Send;
          return (
            <li key={item.id} className="flex items-start gap-3 px-3 py-2.5 text-xs">
              <Icon className="w-3.5 h-3.5 mt-0.5 text-text-secondary shrink-0" aria-hidden />
              <div className="flex-1 min-w-0">
                <div className="text-text-primary">
                  {item.summary}
                  {item.lead && (
                    <>
                      {' — '}
                      <Link href={`/leads/${item.lead.id}`} className="text-brand-red hover:underline">
                        {item.lead.name}
                      </Link>
                    </>
                  )}
                </div>
                <div className="text-text-secondary">
                  {item.actor ? item.actor.name : 'System'} · {new Date(item.at).toLocaleString()}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
