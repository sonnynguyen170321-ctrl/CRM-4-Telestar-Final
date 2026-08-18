'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, X, Sparkles } from 'lucide-react';
import type { AttentionReport, AttentionItem } from '@/lib/ai/engine/attention-engine';

export default function AttentionBanner() {
  const [report, setReport] = useState<AttentionReport | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/ai/attention')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: AttentionReport | null) => setReport(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading || dismissed || !report || report.items.length === 0) {
    return null;
  }

  // Top attention item
  const topItem: AttentionItem = report.items[0];

  return (
    <div className="relative z-20 border-b border-brand-gold/20 bg-gradient-to-r from-brand-gold/10 via-brand-gold/5 to-transparent px-4 py-2 text-xs transition-all">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-gold/20 text-brand-gold">
            <Sparkles className="h-3 w-3" />
          </div>

          <div className="flex items-center gap-2 truncate">
            <span className="font-semibold uppercase tracking-wider text-brand-gold text-[10px]">
              Attention Needed ({report.totalItems})
            </span>
            <span className="text-muted-text">•</span>
            <span className="font-medium text-foreground truncate">{topItem.title}</span>
            <span className="hidden text-muted-text sm:inline truncate">— {topItem.summary}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Link
            href={topItem.targetUrl}
            className="inline-flex items-center gap-1 rounded-md bg-brand-gold/20 px-2.5 py-1 text-[11px] font-medium text-brand-gold hover:bg-brand-gold hover:text-zinc-950 transition-colors"
          >
            <span>{topItem.actionLabel || 'Action'}</span>
            <ArrowRight className="h-3 w-3" />
          </Link>

          <button
            onClick={() => setDismissed(true)}
            className="rounded p-1 text-muted-text hover:text-foreground transition-colors"
            title="Dismiss banner"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
