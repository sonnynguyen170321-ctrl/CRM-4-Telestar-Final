'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { BarChart3, Loader2, Globe2, Upload, MailCheck, Copy } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { readApiError } from '@/lib/api/client';

type Metrics = {
  qualifiedBySource: { source: string; count: number }[];
  duplicateRate: number;
  emailValidRate: number;
  totalPool: number;
  importedWeek: number;
};

type PoolItem = { sourceType: string; sourceName: string | null };

const SOURCE_TYPE_LABEL: Record<string, string> = {
  manual: 'Manual entry',
  csv_import: 'CSV import',
  bulk_import: 'Bulk import',
  web: 'Web',
  referral: 'Referral',
  event: 'Event',
  outbound: 'Outbound',
  other: 'Other',
};

export default function SourcesTab() {
  const { showToast } = useToast();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [byType, setByType] = useState<{ type: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mRes, pRes] = await Promise.all([
        fetch('/api/leadgen-pool/metrics'),
        fetch('/api/leadgen-pool?pageSize=200'),
      ]);
      if (!mRes.ok) throw new Error(await readApiError(mRes, 'Failed to load source metrics'));
      const metrics: Metrics = await mRes.json();
      setMetrics(metrics);

      const poolData = pRes.ok ? await pRes.json() : null;
      const typeMap = new Map<string, number>();
      for (const item of (poolData?.items ?? []) as PoolItem[]) {
        typeMap.set(item.sourceType, (typeMap.get(item.sourceType) ?? 0) + 1);
      }
      setByType([...typeMap.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load source metrics', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
      </div>
    );
  }

  if (!metrics) {
    return <p className="text-sm text-text-muted">Could not load source metrics.</p>;
  }

  const totalQualified = metrics.qualifiedBySource.reduce((s, x) => s + x.count, 0);
  const topSource = metrics.qualifiedBySource[0]?.source ?? '—';
  const maxType = Math.max(1, ...byType.map((t) => t.count));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-card-bg border border-card-border rounded-xl px-4 py-3 flex items-center gap-3">
          <Globe2 className="w-5 h-5 text-blue-400 flex-shrink-0" />
          <div>
            <div className="text-xl font-bold text-text-primary font-display">{metrics.qualifiedBySource.length}</div>
            <div className="text-[10px] text-text-muted uppercase tracking-wide">Active sources</div>
          </div>
        </div>
        <div className="bg-card-bg border border-card-border rounded-xl px-4 py-3 flex items-center gap-3">
          <BarChart3 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
          <div>
            <div className="text-xl font-bold text-text-primary font-display truncate">{topSource}</div>
            <div className="text-[10px] text-text-muted uppercase tracking-wide">Top source</div>
          </div>
        </div>
        <div className="bg-card-bg border border-card-border rounded-xl px-4 py-3 flex items-center gap-3">
          <MailCheck className="w-5 h-5 text-cyan-400 flex-shrink-0" />
          <div>
            <div className="text-xl font-bold text-text-primary font-display">{metrics.emailValidRate}%</div>
            <div className="text-[10px] text-text-muted uppercase tracking-wide">Email valid rate</div>
          </div>
        </div>
        <div className="bg-card-bg border border-card-border rounded-xl px-4 py-3 flex items-center gap-3">
          <Copy className="w-5 h-5 text-amber-400 flex-shrink-0" />
          <div>
            <div className="text-xl font-bold text-text-primary font-display">{metrics.duplicateRate}%</div>
            <div className="text-[10px] text-text-muted uppercase tracking-wide">Duplicate rate</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-card-bg border border-card-border rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-emerald-400" />
            <h3 className="font-display font-extrabold text-sm text-text-primary">Qualified Leads by Source</h3>
          </div>
          {metrics.qualifiedBySource.length === 0 ? (
            <p className="text-xs text-text-muted italic">No qualified leads yet.</p>
          ) : (
            metrics.qualifiedBySource.map((s) => {
              const pct = totalQualified ? Math.round((s.count / totalQualified) * 100) : 0;
              return (
                <div key={s.source} className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-text-secondary truncate">{s.source}</span>
                    <span className="font-mono text-text-muted whitespace-nowrap">{s.count} · {pct}%</span>
                  </div>
                  <div className="h-1.5 bg-bg-main border border-card-border rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500/70 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="bg-card-bg border border-card-border rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-blue-400" />
            <h3 className="font-display font-extrabold text-sm text-text-primary">Pool Composition by Source Type</h3>
          </div>
          {byType.length === 0 ? (
            <p className="text-xs text-text-muted italic">No records in the pool yet.</p>
          ) : (
            byType.map((t) => (
              <div key={t.type} className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-text-secondary truncate">{SOURCE_TYPE_LABEL[t.type] ?? t.type}</span>
                  <span className="font-mono text-text-muted">{t.count}</span>
                </div>
                <div className="h-1.5 bg-bg-main border border-card-border rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500/70 rounded-full" style={{ width: `${(t.count / maxType) * 100}%` }} />
                </div>
              </div>
            ))
          )}
          <p className="text-[10px] text-text-muted italic pt-1">Sample: latest 200 pool records · {metrics.totalPool} total in database</p>
        </div>
      </div>
    </div>
  );
}
