'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Upload, Target, XCircle, Database, Copy, MailCheck, Route, Users } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { readApiError } from '@/lib/api/client';

type Metrics = {
  importedWeek: number;
  qualifiedWeek: number;
  disqualifiedWeek: number;
  totalPool: number;
  duplicateRate: number;
  emailValidRate: number;
  assignedToCampaign: number;
  assignedToSdr: number;
  qualifiedBySource: { source: string; count: number }[];
  qualifiedByMember: { id: string; name: string; count: number }[];
  requirementProgress: {
    campaignId: string;
    campaignName: string;
    required: number;
    delivered: number;
    status: string;
  }[];
  icpAdherence: {
    campaigns: {
      campaignId: string;
      campaignName: string;
      hasCriteria: boolean;
      delivered: number;
      evaluated: number;
      matched: number;
      mismatched: number;
      unknown: number;
      unevaluated: number;
      matchRate: number | null;
      topMismatchReasons: { criterion: string; count: number }[];
    }[];
    totals: {
      evaluated: number;
      matched: number;
      mismatched: number;
      unknown: number;
      matchRate: number | null;
      topMismatchReasons: { criterion: string; count: number }[];
    };
  };
  avgDaysToQualification: number;
};

/**
 * Criterion names as the matcher reports them, in a manager's language.
 *
 * `requiredField:phone` is how `matchRequirement` names a missing mandatory field, and showing
 * that string to a Leadgen Manager would be engineering vocabulary on a business surface.
 */
function criterionLabel(criterion: string): string {
  if (criterion.startsWith('requiredField:')) {
    return `missing ${criterion.slice('requiredField:'.length)}`;
  }
  const named: Record<string, string> = {
    title: 'job title',
    industry: 'industry',
    country: 'country',
    companySize: 'company size',
  };
  return named[criterion] ?? criterion;
}

const STAT_CARDS = [
  { key: 'importedWeek', label: 'Imported (7d)', icon: Upload, color: 'text-blue-400' },
  { key: 'qualifiedWeek', label: 'Qualified (7d)', icon: Target, color: 'text-emerald-400' },
  { key: 'disqualifiedWeek', label: 'Disqualified (7d)', icon: XCircle, color: 'text-brand-red' },
  { key: 'totalPool', label: 'Pool Records', icon: Database, color: 'text-purple-400' },
  { key: 'duplicateRate', label: 'Duplicate Rate', icon: Copy, color: 'text-amber-400' },
  { key: 'emailValidRate', label: 'Email Valid Rate', icon: MailCheck, color: 'text-cyan-400' },
  { key: 'assignedToCampaign', label: 'Assigned to Campaign', icon: Route, color: 'text-purple-300' },
  { key: 'assignedToSdr', label: 'Assigned to SDR', icon: Users, color: 'text-amber-300' },
] as const;

export default function OverviewTab() {
  const { showToast } = useToast();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/leadgen-pool/metrics');
      if (!res.ok) throw new Error(await readApiError(res, 'Failed to load metrics'));
      setMetrics(await res.json());
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load metrics', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-6 h-6 border-2 border-purple-500/30 border-t-purple-400 rounded-full animate-spin" />
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center">
        <Database className="w-10 h-10 text-text-muted mb-3 opacity-40" />
        <p className="text-sm text-text-muted">Could not load leadgen metrics.</p>
      </div>
    );
  }

  const topSources = metrics.qualifiedBySource.slice(0, 6);
  const topMembers = metrics.qualifiedByMember.slice(0, 6);
  const maxSource = Math.max(1, ...topSources.map((s) => s.count));
  const maxMember = Math.max(1, ...topMembers.map((m) => m.count));
  // Campaigns with no criteria configured are not shown as 0% — there is nothing to adhere to.
  const measuredCampaigns = metrics.icpAdherence.campaigns.filter((c) => c.hasCriteria);

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {STAT_CARDS.map(({ key, label, icon: Icon, color }) => (
          <div key={key} className="bg-card-bg border border-card-border rounded-xl px-4 py-3 flex items-center gap-3">
            <Icon className={`w-5 h-5 ${color} flex-shrink-0`} />
            <div>
              <div className="text-xl font-bold text-text-primary font-display">
                {typeof metrics[key] === 'number' ? `${metrics[key]}${key === 'duplicateRate' || key === 'emailValidRate' ? '%' : ''}` : '—'}
              </div>
              <div className="text-[10px] text-text-muted uppercase tracking-wide">{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Requirements progress */}
      <div className="space-y-3">
        {/* h2, not h3 — top-level panel title under the page h1; skipping a level breaks
            the heading order. Classes unchanged, so it looks identical. */}
        <h2 className="font-display font-extrabold text-sm text-text-primary">Campaign Lead Requirements</h2>
        {metrics.requirementProgress.length === 0 ? (
          <div className="bg-card-bg border border-card-border rounded-2xl p-6 text-center text-xs text-text-muted italic">
            <p className="prose-measure mx-auto">
              No campaign lead requirements yet. Create them from the Campaign Routing tab.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {metrics.requirementProgress.map((req) => {
              const pct = req.required > 0 ? Math.min(100, Math.round((req.delivered / req.required) * 100)) : 0;
              return (
                <div key={req.campaignId} className="bg-card-bg border border-card-border rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-text-primary">{req.campaignName}</p>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${req.status === 'fulfilled' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-purple-500/10 text-purple-300 border border-purple-500/20'}`}>
                      {req.status.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-2 bg-bg-main border border-card-border rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-purple-500 to-purple-300 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[10px] font-mono text-text-muted whitespace-nowrap">
                      {req.delivered}/{req.required}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ICP adherence — a different question from delivery volume above. A campaign can be
          fully delivered and badly off-brief, and this is the number that says so. */}
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display font-extrabold text-sm text-text-primary">ICP Adherence</h2>
          {metrics.icpAdherence.totals.matchRate !== null && (
            <span className="text-xs text-text-muted">
              <span className="font-mono font-bold text-text-primary">
                {metrics.icpAdherence.totals.matchRate}%
              </span>{' '}
              of {metrics.icpAdherence.totals.evaluated} evaluated delivered leads match
            </span>
          )}
        </div>
        {measuredCampaigns.length === 0 ? (
          <div className="bg-card-bg border border-card-border rounded-2xl p-6 text-center text-xs text-text-muted italic">
            <p className="prose-measure mx-auto">
              No campaign requirement defines target titles, industries, countries, company size or
              mandatory fields yet, so there is nothing to measure delivered leads against.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {measuredCampaigns.map((c) => (
              <div key={c.campaignId} className="bg-card-bg border border-card-border rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-text-primary">{c.campaignName}</p>
                  <span className="text-[10px] font-mono text-text-muted">
                    {/* Never "0%" for a campaign nothing could be judged on — an unmeasured
                        campaign and a failing one must not read the same. */}
                    {c.matchRate === null ? 'not measured' : `${c.matchRate}% on ICP`}
                  </span>
                </div>
                {c.evaluated > 0 && (
                  <div className="flex h-2 rounded-full overflow-hidden border border-card-border bg-bg-main">
                    <div className="h-full bg-emerald-500" style={{ width: `${(c.matched / c.evaluated) * 100}%` }} />
                    <div className="h-full bg-brand-red" style={{ width: `${(c.mismatched / c.evaluated) * 100}%` }} />
                    <div className="h-full bg-amber-400" style={{ width: `${(c.unknown / c.evaluated) * 100}%` }} />
                  </div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-text-muted">
                  <span><span className="font-mono text-emerald-400">{c.matched}</span> match</span>
                  <span><span className="font-mono text-brand-red">{c.mismatched}</span> off-ICP</span>
                  {/* Missing data is its own number. Folding it into either side would either
                      flatter the rate or blame the floor for gaps in enrichment. */}
                  <span><span className="font-mono text-amber-400">{c.unknown}</span> unknown</span>
                  {c.unevaluated > 0 && (
                    <span><span className="font-mono">{c.unevaluated}</span> not yet in CRM</span>
                  )}
                </div>
                {c.topMismatchReasons.length > 0 && (
                  <p className="mt-2 text-[10px] text-text-muted">
                    Most common misses:{' '}
                    {c.topMismatchReasons
                      .map((r) => `${criterionLabel(r.criterion)} (${r.count})`)
                      .join(', ')}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Qualified by source */}
        <div className="bg-card-bg border border-card-border rounded-2xl p-4 space-y-3">
          <h3 className="font-display font-extrabold text-sm text-text-primary">Qualified by Source</h3>
          {topSources.length === 0 ? (
            <p className="text-xs text-text-muted italic">No qualified leads yet.</p>
          ) : (
            topSources.map((s) => (
              <div key={s.source} className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-text-secondary truncate">{s.source}</span>
                  <span className="font-mono text-text-muted">{s.count}</span>
                </div>
                <div className="h-1.5 bg-bg-main border border-card-border rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500/70 rounded-full" style={{ width: `${(s.count / maxSource) * 100}%` }} />
                </div>
              </div>
            ))
          )}
        </div>

        {/* Qualified by member */}
        <div className="bg-card-bg border border-card-border rounded-2xl p-4 space-y-3">
          <h3 className="font-display font-extrabold text-sm text-text-primary">Qualified by Team Member</h3>
          {topMembers.length === 0 ? (
            <p className="text-xs text-text-muted italic">No qualified leads yet.</p>
          ) : (
            topMembers.map((m) => (
              <div key={m.id} className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-text-secondary truncate">{m.name}</span>
                  <span className="font-mono text-text-muted">{m.count}</span>
                </div>
                <div className="h-1.5 bg-bg-main border border-card-border rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500/70 rounded-full" style={{ width: `${(m.count / maxMember) * 100}%` }} />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Avg qualification time */}
      <div className="bg-card-bg border border-card-border rounded-2xl px-4 py-3 flex items-center justify-between">
        <span className="text-xs text-text-secondary">Average time from import to qualification</span>
        <span className="text-xs font-mono font-bold text-purple-300">{metrics.avgDaysToQualification} days</span>
      </div>
    </div>
  );
}
