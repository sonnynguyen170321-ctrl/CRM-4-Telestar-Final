'use client';

import { formatMoney, type OpportunitySummary } from './types';

const STAGE_META = [
  { key: 'pendingClientReview', label: 'Pending Review', color: 'border-amber-500/25 bg-amber-500/5 text-amber-400' },
  { key: 'acceptedByClient', label: 'Accepted', color: 'border-sky-500/25 bg-sky-500/5 text-sky-400' },
  { key: 'won', label: 'Won', color: 'border-emerald-500/25 bg-emerald-500/5 text-emerald-400' },
  { key: 'lost', label: 'Lost', color: 'border-red-500/25 bg-red-500/5 text-red-400' },
  { key: 'rejected', label: 'Rejected', color: 'border-red-500/25 bg-red-500/5 text-red-400' },
] as const;

export default function OpportunityValueCard({ summary }: { summary: OpportunitySummary }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
      <div className="rounded-xl border border-card-border bg-card-bg p-4">
        <p className="text-xs text-muted mb-1">Pipeline Value (Open)</p>
        <p className="text-2xl font-semibold text-white">
          {formatMoney(summary.totalPipelineValue, 'USD')}
        </p>
        <p className="text-xs text-muted mt-1">
          Weighted: {formatMoney(summary.weightedPipelineValue, 'USD')}
        </p>
      </div>

      <div className="rounded-xl border border-card-border bg-card-bg p-4">
        <p className="text-xs text-muted mb-1">Open Opportunities</p>
        <p className="text-2xl font-semibold text-white">{summary.totalOpen}</p>
        <p className="text-xs text-muted mt-1">in pipeline</p>
      </div>

      <div className="rounded-xl border border-card-border bg-card-bg p-4">
        <p className="text-xs text-muted mb-1">Won</p>
        <p className="text-2xl font-semibold text-emerald-400">{summary.won}</p>
        <p className="text-xs text-muted mt-1">closed-won this period</p>
      </div>

      <div className="rounded-xl border border-card-border bg-card-bg p-4">
        <p className="text-xs text-muted mb-1">Lost / Rejected</p>
        <p className="text-2xl font-semibold text-red-400">
          {summary.lost + summary.rejected}
        </p>
        <p className="text-xs text-muted mt-1">not moving forward</p>
      </div>

      <div className="col-span-full flex flex-wrap gap-2">
        {STAGE_META.map(m => (
          <span
            key={m.key}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${m.color}`}
          >
            {m.label}: {summary[m.key]}
          </span>
        ))}
      </div>
    </div>
  );
}
