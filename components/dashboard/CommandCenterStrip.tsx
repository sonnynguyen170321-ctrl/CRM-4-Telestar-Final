'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, ArrowRight, CheckCircle2, Clock, MessageSquare, Sparkles,
} from 'lucide-react';
import MetricCard from '@/components/operating/MetricCard';
import ProspectIdentity from '@/components/operating/ProspectIdentity';
import OperatingStateBadge from '@/components/operating/OperatingStateBadge';
import StatusBadge from '@/components/operating/StatusBadge';
import EmptyState from '@/components/operating/EmptyState';
import SectionHeader from '@/components/operating/SectionHeader';
import { SkeletonMetricRow, SkeletonList } from '@/components/operating/Skeleton';
import type { ConsoleData } from '@/components/ai/types';
import { relativeTime } from '@/components/ai/types';

/**
 * The revenue command strip that opens the dashboard.
 *
 * Four numbers, the queue that needs a person, and what AI has been doing — before the task list.
 * The dashboard's job at 9am is to answer "what needs me" before it answers "what is on my
 * calendar", and a wall of undifferentiated stat tiles answered neither.
 *
 * It reads `/api/ai/console`, the same endpoint the AI Command Center uses, so the number here and
 * the number there cannot disagree. If that request fails the strip degrades to a quiet line and
 * the task hub below is untouched — AI being down must never mean the CRM is down.
 */

export default function CommandCenterStrip({
  tasksToday, tasksDone,
}: {
  tasksToday: number;
  tasksDone: number;
}) {
  const [data, setData] = useState<ConsoleData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/ai/console')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('console'))))
      .then((body) => { if (!cancelled) setData(body); })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const counts: Record<string, number> = {};
  for (const b of data?.buckets ?? []) counts[b.key] = b.count;

  const attention = data?.buckets.find((b) => b.key === 'needs_attention')?.prospects ?? [];

  // "Replies today" is counted from the same activity timeline the console renders, not from a
  // second query that could drift from it.
  const repliesToday = (data?.timeline ?? []).filter(
    (t) => t.type === 'email_replied' && new Date(t.at).toDateString() === new Date().toDateString()
  ).length;

  if (failed) {
    return (
      <p className="rounded-xl border border-card-border bg-card-bg px-4 py-3 type-meta text-text-muted">
        The operating board is unavailable right now. Your tasks below are unaffected.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {isLoading && <SkeletonMetricRow count={4} />}

      {!isLoading && data && (
        <section className="grid grid-cols-4 gap-3" aria-label="Today at a glance">
          <MetricCard
            label="Needs attention"
            value={data.totals.needsAttention}
            tone="attention"
            icon={AlertTriangle}
            hint="Prospects replied — AI has stopped"
            emphasis={data.totals.needsAttention > 0}
            href="/ai"
          />
          <MetricCard
            label="AI managed"
            value={counts.ai_managed ?? 0}
            tone="ai"
            icon={Sparkles}
            hint="Being researched, sequenced or followed up"
            href="/ai"
          />
          <MetricCard
            label="Replies today"
            value={repliesToday}
            tone="human"
            icon={MessageSquare}
            hint="Inbound responses since midnight"
          />
          <MetricCard
            label="Tasks today"
            value={tasksToday}
            tone="neutral"
            icon={CheckCircle2}
            hint={`${tasksDone} done · ${Math.max(tasksToday - tasksDone, 0)} remaining`}
          />
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-5 items-stretch">
        {/* ─── needs your attention ─── */}
        <section className="rounded-xl border border-card-border bg-card-bg overflow-hidden flex flex-col h-full">
          <div className="px-5 py-3.5 border-b border-card-border">
            <SectionHeader
              title="Needs your attention"
              description="A prospect replied and AI handed the conversation over."
              action={
                <Link
                  href="/ai"
                  className="inline-flex items-center gap-1.5 type-meta text-brand-red hover:underline focus-ring rounded"
                >
                  View all <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                </Link>
              }
            />
          </div>

          {isLoading && <SkeletonList rows={2} />}

          {!isLoading && attention.length === 0 && (
            <div className="flex-1 flex items-center justify-center">
              <EmptyState
                title="No prospects need your attention."
                description="AI is currently handling the active queue. A reply moves a prospect here automatically."
                icon={CheckCircle2}
              />
            </div>
          )}

          {!isLoading && attention.length > 0 && (
            <ul className="divide-y divide-card-border">
              {attention.slice(0, 4).map((p) => (
                <li key={p.leadId} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <ProspectIdentity name={p.name} title={p.title} company={p.company} />
                    <span className="type-micro text-text-muted whitespace-nowrap pt-1">
                      Replied {relativeTime(p.replyAt)}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 mt-3 pl-11">
                    {p.replyLabel && <StatusBadge label={p.replyLabel} tone="attention" />}
                    <OperatingStateBadge state={p.operatingState} />
                    <Link
                      href="/ai"
                      className="inline-flex items-center gap-1.5 type-meta text-brand-red hover:underline focus-ring rounded ml-auto"
                    >
                      Review handoff <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ─── what AI is doing, and what just moved ─── */}
        <div className="space-y-5">
          <section className="rounded-xl border border-card-border bg-card-bg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-card-border">
              <h2 className="type-section flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-700" aria-hidden="true" />
                AI working now
              </h2>
            </div>
            {isLoading ? (
              <SkeletonList rows={3} />
            ) : (
              <ul className="divide-y divide-card-border">
                {[
                  { label: 'Managing prospects', value: counts.ai_managed ?? 0 },
                  { label: 'Needs a human', value: counts.needs_attention ?? 0 },
                  { label: 'SDR managing', value: counts.human_managed ?? 0 },
                  { label: 'Waiting on a reply', value: counts.waiting ?? 0 },
                  { label: 'Re-engagement eligible', value: counts.reengagement_eligible ?? 0 },
                ].map((row) => (
                  <li key={row.label} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <span className="type-meta text-text-secondary">{row.label}</span>
                    <span className="font-mono type-subsection text-text-primary">{row.value}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-card-border bg-card-bg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-card-border">
              <h2 className="type-section">Recent movement</h2>
            </div>
            {isLoading ? (
              <SkeletonList rows={3} />
            ) : (data?.timeline.length ?? 0) === 0 ? (
              <EmptyState
                title="Nothing has moved yet today."
                description="Sends, replies and handoffs appear here as they happen."
                icon={Clock}
              />
            ) : (
              <ul className="divide-y divide-card-border">
                {(data?.timeline ?? []).slice(0, 6).map((t, i) => (
                  <li key={`${t.at}-${i}`} className="flex gap-3 px-5 py-2.5">
                    <span className="type-micro font-mono text-text-muted w-20 shrink-0 pt-0.5">
                      {relativeTime(t.at)}
                    </span>
                    <span className="type-meta text-text-secondary">{t.description}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
