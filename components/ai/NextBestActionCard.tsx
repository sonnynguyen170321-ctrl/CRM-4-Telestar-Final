'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Sparkles, ArrowRight, ShieldCheck, Clock, Loader2, RefreshCw } from 'lucide-react';
import type { NextBestActionResult, NextBestActionType } from '@/lib/ai/engine/next-best-action';

interface NextBestActionCardProps {
  leadId: string;
  onExecuteAction?: (action: NextBestActionType) => void;
}

const ACTION_CONFIG: Record<
  NextBestActionType,
  { label: string; bg: string; text: string; border: string }
> = {
  REPLY: { label: 'Reply Now', bg: 'bg-emerald-500/10', text: 'text-emerald-700', border: 'border-emerald-500/30' },
  CALL: { label: 'Direct Call', bg: 'bg-blue-500/10', text: 'text-blue-700', border: 'border-blue-500/30' },
  FOLLOW_UP: { label: 'Follow Up', bg: 'bg-amber-500/10', text: 'text-amber-800', border: 'border-amber-500/30' },
  RESEARCH: { label: 'Enrich Data', bg: 'bg-purple-500/10', text: 'text-purple-700', border: 'border-purple-500/30' },
  SCHEDULE: { label: 'Book Meeting', bg: 'bg-cyan-500/10', text: 'text-cyan-800', border: 'border-cyan-500/30' },
  REVIEW: { label: 'Review Deal', bg: 'bg-indigo-500/10', text: 'text-indigo-700', border: 'border-indigo-500/30' },
  ESCALATE: { label: 'Escalate to Lead', bg: 'bg-rose-500/10', text: 'text-rose-700', border: 'border-rose-500/30' },
  REASSIGN: { label: 'Reassign Rep', bg: 'bg-orange-500/10', text: 'text-orange-800', border: 'border-orange-500/30' },
  DO_NOT_CONTACT: { label: 'Do Not Contact', bg: 'bg-red-500/10', text: 'text-red-700', border: 'border-red-500/30' },
  WAIT: { label: 'Cadence Active', bg: 'bg-zinc-500/10', text: 'text-text-secondary', border: 'border-zinc-500/30' },
};

export default function NextBestActionCard({ leadId, onExecuteAction }: NextBestActionCardProps) {
  const [data, setData] = useState<NextBestActionResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchNba = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/ai/nba?leadId=${leadId}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load action');
        return res.json();
      })
      .then((result: NextBestActionResult) => setData(result))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [leadId]);

  useEffect(() => {
    if (leadId) fetchNba();
  }, [leadId, fetchNba]);

  if (loading) {
    return (
      <div className="rounded-xl border border-card-border bg-card-bg/60 p-4 animate-pulse">
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-gold-text" />
          <span>Calculating SDR Next Best Action...</span>
        </div>
      </div>
    );
  }

  if (error || !data) return null;

  const config = ACTION_CONFIG[data.action] || ACTION_CONFIG.FOLLOW_UP;

  return (
    <div className="group relative overflow-hidden rounded-xl border border-card-border bg-card-bg p-3.5 shadow-xs transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/15 text-brand-gold-text">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold tracking-wide uppercase text-brand-gold-text">Next Best Action</span>
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium border ${config.bg} ${config.text} ${config.border}`}>
                {config.label}
              </span>
            </div>
            <p className="mt-0.5 text-xs font-medium text-text-primary prose-measure">{data.reason}</p>
          </div>
        </div>

        <button
          onClick={fetchNba}
          title="Recalculate action"
          className="rounded p-1 text-text-muted hover:bg-card-border/30 hover:text-text-primary transition-colors"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>

      {data.sourceEvidence && data.sourceEvidence.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {data.sourceEvidence.slice(0, 2).map((ev, i) => (
            <span
              key={i}
              className="inline-block rounded bg-bg-main px-1.5 py-0.5 text-[10px] text-text-secondary font-mono truncate max-w-full border border-card-border"
            >
              {ev}
            </span>
          ))}
        </div>
      )}

      <div className="mt-2.5 flex items-center justify-between border-t border-card-border pt-2 text-[11px] text-text-muted">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3 text-text-muted" />
            <span>SLA: {new Date(data.deadline).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="h-3 w-3 text-emerald-600" />
            <span className="text-text-secondary">{Math.round(data.confidence * 100)}% Match</span>
          </span>
        </div>

        {onExecuteAction && data.action !== 'WAIT' && (
          <button
            onClick={() => onExecuteAction(data.action)}
            className="inline-flex items-center gap-1 rounded-md bg-brand-gold-text/15 px-2 py-1 text-[11px] font-medium text-brand-gold-text hover:bg-brand-gold-text hover:text-white transition-colors"
          >
            <span>Execute</span>
            <ArrowRight className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
