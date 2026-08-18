'use client';

import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Activity,
  Award,
  CheckCircle2,
  Unlock,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import type { DatabaseHealthSummary as HealthSummaryType } from '@/lib/contact-intelligence/health';

interface DatabaseHealthSummaryProps {
  onApplyFilter?: (filterKey: string, filterValue: string) => void;
}

export default function DatabaseHealthSummary({ onApplyFilter }: DatabaseHealthSummaryProps) {
  const [data, setData] = useState<HealthSummaryType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = () => {
    setLoading(true);
    fetch('/api/leadgen/health')
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Failed to fetch database health');
        }
        return res.json();
      })
      .then((health) => {
        setData(health);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchHealth();
  }, []);

  if (loading) {
    return (
      <div className="p-5 rounded-2xl bg-zinc-900/60 border border-zinc-800 animate-pulse flex items-center justify-between">
        <div className="h-4 bg-zinc-800 rounded w-1/3" />
        <div className="h-4 bg-zinc-800 rounded w-1/4" />
      </div>
    );
  }

  if (error || !data) {
    return null;
  }

  const tierColors = {
    excellent: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    healthy: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    needs_attention: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    critical: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
  };

  return (
    <div className="space-y-4">
      {/* Top Banner Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Total & Verified Rate */}
        <div className="p-4 rounded-xl bg-zinc-900/70 border border-zinc-800 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
              Verified Contacts
            </span>
            <div className="text-xl font-bold text-zinc-100 mt-0.5">
              {data.totalContacts.toLocaleString()}
            </div>
            <span className="text-[11px] text-emerald-400 flex items-center gap-1 mt-0.5">
              <CheckCircle2 className="w-3 h-3" />
              {data.verifiedEmailRate}% Deliverable
            </span>
          </div>
          <div className="p-2.5 rounded-lg bg-zinc-800/80 text-zinc-300">
            <ShieldCheck className="w-5 h-5" />
          </div>
        </div>

        {/* Proven & Promising Assets */}
        <div className="p-4 rounded-xl bg-zinc-900/70 border border-zinc-800 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
              Proven Commercial Assets
            </span>
            <div className="text-xl font-bold text-emerald-400 mt-0.5">
              {data.provenCount + data.promisingCount}
            </div>
            <span className="text-[11px] text-zinc-400 mt-0.5 block">
              {data.provenCount} Proven · {data.promisingCount} Promising
            </span>
          </div>
          <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Award className="w-5 h-5" />
          </div>
        </div>

        {/* Reusable Inventory */}
        <div className="p-4 rounded-xl bg-zinc-900/70 border border-zinc-800 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
              Ready for Reuse
            </span>
            <div className="text-xl font-bold text-blue-400 mt-0.5">
              {data.readyForReuseCount}
            </div>
            <span className="text-[11px] text-zinc-400 mt-0.5 block">
              {data.lockedOrCooldownCount} In Cooldown / Lock
            </span>
          </div>
          <div className="p-2.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <Unlock className="w-5 h-5" />
          </div>
        </div>

        {/* Overall Database Health Tier */}
        <div className="p-4 rounded-xl bg-zinc-900/70 border border-zinc-800 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
              Database Asset Health
            </span>
            <div className="mt-1">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border capitalize ${tierColors[data.healthTier]}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-current" />
                {data.healthTier.replace(/_/g, ' ')}
              </span>
            </div>
            <span className="text-[11px] text-zinc-400 mt-1 block">
              Avg Quality: {data.averageQualityScore}/100
            </span>
          </div>
          <div className="p-2.5 rounded-lg bg-zinc-800/80 text-zinc-300">
            <Activity className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Remediation / Actionable Diagnostic Alerts */}
      {data.remediationSuggestions.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {data.remediationSuggestions.map((rec, idx) => (
            <div
              key={idx}
              className="p-3.5 rounded-xl bg-zinc-900/40 border border-zinc-800/80 flex flex-col justify-between space-y-2 hover:border-zinc-700 transition-colors"
            >
              <div>
                <h5 className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  {rec.title}
                </h5>
                <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                  {rec.description}
                </p>
              </div>
              {onApplyFilter && (
                <button
                  onClick={() => {
                    const [k, v] = rec.filterQuery.split('=');
                    if (k && v) onApplyFilter(k, v);
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 hover:text-emerald-300 pt-1"
                >
                  {rec.actionLabel}
                  <ChevronRight className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
