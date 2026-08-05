'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, AlertCircle, Info, CheckCircle2, Loader2, RefreshCw,
} from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { readApiError } from '@/lib/api/client';

interface CardItem {
  id: string;
  label: string;
  detail: string;
  href: string;
}
interface Card {
  key: string;
  title: string;
  severity: 'error' | 'warn' | 'info';
  count: number;
  items: CardItem[];
}
interface Overview {
  generatedAt: string;
  totals: {
    activeUsers: number;
    inactiveUsers: number;
    activeCampaigns: number;
    totalCampaigns: number;
  };
  cards: Card[];
}

const SEVERITY = {
  error: { Icon: AlertTriangle, className: 'text-brand-red', ring: 'border-brand-red/30' },
  warn: { Icon: AlertCircle, className: 'text-brand-orange-text', ring: 'border-brand-orange/30' },
  info: { Icon: Info, className: 'text-text-muted', ring: 'border-card-border' },
} as const;

export default function AdminOverviewPage() {
  const { showToast } = useToast();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/overview');
      if (res.ok) setData(await res.json());
      else showToast(await readApiError(res, 'Failed to load the admin overview'), 'error');
    } catch {
      showToast('Network error while loading the admin overview', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-text-muted type-meta font-mono">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading operations status…
      </div>
    );
  }

  const cards = data?.cards ?? [];
  const allClear = cards.every((c) => c.count === 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-4 flex-wrap">
          <Stat label="Active users" value={data?.totals.activeUsers ?? 0} />
          <Stat label="Deactivated" value={data?.totals.inactiveUsers ?? 0} />
          <Stat label="Active campaigns" value={data?.totals.activeCampaigns ?? 0} />
          <Stat label="Total campaigns" value={data?.totals.totalCampaigns ?? 0} />
        </div>
        <button
          type="button"
          onClick={fetchOverview}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-card-border bg-bg-main hover:bg-card-border/30 text-text-secondary text-xs font-semibold rounded-lg transition-colors disabled:opacity-60"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </button>
      </div>

      {allClear && (
        <div className="glass-card p-6 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" aria-hidden="true" />
          <div>
            <h2 className="type-subsection font-bold text-text-primary">Nothing needs attention</h2>
            <p className="type-meta text-text-muted prose-measure">
              Every active campaign has an SDR, no work is stranded on a deactivated user, and every
              rep has a manager.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {cards
          .filter((c) => c.count > 0)
          .map((card) => {
            const { Icon, className, ring } = SEVERITY[card.severity];
            return (
              <section key={card.key} className={`glass-card p-4 space-y-3 border ${ring}`}>
                <div className="flex items-start gap-2">
                  <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${className}`} aria-hidden="true" />
                  <h2 className="type-subsection font-bold text-text-primary flex-1">
                    {card.title}
                  </h2>
                  <span className="type-body font-mono font-bold text-text-primary">
                    {card.count}
                  </span>
                </div>

                <ul className="space-y-1">
                  {card.items.map((item) => (
                    <li key={item.id}>
                      <Link
                        href={item.href}
                        className="flex items-baseline justify-between gap-3 px-2 py-1.5 rounded-lg hover:bg-bg-main/60 transition-colors"
                      >
                        <span className="type-body text-text-primary font-medium truncate">
                          {item.label}
                        </span>
                        <span className="type-meta text-text-muted truncate shrink-0 max-w-[55%] text-right">
                          {item.detail}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>

                {card.count > card.items.length && (
                  <p className="type-meta text-text-muted px-2">
                    + {card.count - card.items.length} more
                  </p>
                )}
              </section>
            );
          })}
      </div>

      {data && (
        <p className="type-meta text-text-muted font-mono">
          Generated {new Date(data.generatedAt).toLocaleTimeString()} · cached for 30s
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="type-section font-bold text-text-primary font-mono">{value}</div>
      <div className="type-meta text-text-muted">{label}</div>
    </div>
  );
}
