import React from 'react';
import { Inbox } from 'lucide-react';
import ProspectIdentity from '@/components/operating/ProspectIdentity';
import OperatingStateBadge from '@/components/operating/OperatingStateBadge';
import EmptyState from '@/components/operating/EmptyState';
import { SkeletonList } from '@/components/operating/Skeleton';
import type { Bucket, ConsoleProspect } from './types';
import { relativeTime } from './types';

/**
 * The prospect queue: one tab per operating bucket, one row per prospect.
 *
 * The tabs are the buckets the API already returns, so the count on a tab and the length of the
 * list under it come from the same object. "All" is a deduplicated union — a prospect with a
 * classified reply appears in both their owner's bucket and `draft_available`, and showing them
 * twice in one list would misrepresent the pipeline size.
 */

/** Tab order is the order of the operating loop, not the order the API happens to return. */
const TABS: Array<{ key: string; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'needs_attention', label: 'Needs Attention' },
  { key: 'ai_managed', label: 'AI Managed' },
  { key: 'human_managed', label: 'SDR Managed' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'reengagement_eligible', label: 'Re-engagement' },
];

const EMPTY_COPY: Record<string, { title: string; description: string }> = {
  all: {
    title: 'No prospects in the operating loop.',
    description: 'Prospects appear here once leadgen assigns them and research begins.',
  },
  needs_attention: {
    title: 'No prospects need your attention.',
    description: 'AI is handling the active queue. A reply moves a prospect here automatically.',
  },
  ai_managed: {
    title: 'AI is not managing any prospects right now.',
    description: 'Prospects arrive here after research qualifies them and a sequence is approved.',
  },
  human_managed: {
    title: 'You are not managing any conversations.',
    description: 'A prospect lands here once you take over from AI.',
  },
  waiting: {
    title: 'Nothing is waiting on a prospect.',
    description: 'Prospects appear here after an outbound touch, until they reply.',
  },
  reengagement_eligible: {
    title: 'No re-engagement candidates.',
    description: 'Prospects appear here after the configured waiting period with no reply.',
  },
};

export default function ProspectQueue({
  buckets, activeTab, onTabChange, selectedLeadId, onSelect, isLoading,
}: {
  buckets: Bucket[] | null;
  activeTab: string;
  onTabChange: (key: string) => void;
  selectedLeadId: string | null;
  onSelect: (leadId: string) => void;
  isLoading: boolean;
}) {
  const byKey = new Map((buckets ?? []).map((b) => [b.key, b]));

  const countFor = (key: string): number => {
    if (key === 'all') return unionProspects().length;
    return byKey.get(key)?.count ?? 0;
  };

  function unionProspects(): ConsoleProspect[] {
    const seen = new Map<string, ConsoleProspect>();
    for (const bucket of buckets ?? []) {
      // `draft_available` is a cross-cut over prospects already counted under their owner.
      if (bucket.key === 'draft_available') continue;
      for (const p of bucket.prospects) if (!seen.has(p.leadId)) seen.set(p.leadId, p);
    }
    return [...seen.values()];
  }

  const rows: ConsoleProspect[] = activeTab === 'all' ? unionProspects() : byKey.get(activeTab)?.prospects ?? [];
  const empty = EMPTY_COPY[activeTab] ?? EMPTY_COPY.all;

  return (
    <section className="rounded-xl border border-card-border bg-card-bg overflow-hidden" aria-label="Prospect queue">
      <div className="px-2 pt-2 border-b border-card-border" data-testid="console-buckets">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Operating states">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                role="tab"
                aria-selected={isActive}
                onClick={() => onTabChange(tab.key)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md type-meta transition-colors focus-ring ${
                  isActive
                    ? 'bg-brand-red/10 text-brand-red'
                    : 'text-text-secondary hover:bg-gray-50 hover:text-text-primary'
                }`}
              >
                {tab.label}
                <span
                  className={`font-mono type-micro px-1.5 py-0.5 rounded ${
                    isActive ? 'bg-brand-red/15 text-brand-red' : 'bg-gray-100 text-text-muted'
                  }`}
                  data-testid={tab.key === 'all' ? undefined : `bucket-${tab.key}-count`}
                >
                  {countFor(tab.key)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {isLoading && <SkeletonList rows={4} />}

      {!isLoading && rows.length === 0 && (
        <EmptyState title={empty.title} description={empty.description} icon={Inbox} />
      )}

      {!isLoading && rows.length > 0 && (
        <ul className="divide-y divide-card-border max-h-[560px] overflow-y-auto">
          {rows.map((p) => {
            const isSelected = selectedLeadId === p.leadId;
            return (
              <li key={`${activeTab}-${p.leadId}`}>
                <button
                  onClick={() => onSelect(p.leadId)}
                  aria-current={isSelected ? 'true' : undefined}
                  className={`w-full text-left px-4 py-3 transition-colors focus-ring ${
                    isSelected ? 'bg-brand-red/5' : 'hover:bg-gray-50'
                  }`}
                  data-testid={`prospect-${p.leadId}`}
                >
                  <ProspectIdentity name={p.name} title={p.title} company={p.company} />
                  <div className="flex items-center justify-between gap-2 mt-2 pl-11">
                    <OperatingStateBadge state={p.operatingState} />
                    <span className="type-micro text-text-muted whitespace-nowrap">
                      {p.replyAt
                        ? `replied ${relativeTime(p.replyAt)}`
                        : p.lastTouchAt
                        ? `touched ${relativeTime(p.lastTouchAt)}`
                        : 'no touches yet'}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
