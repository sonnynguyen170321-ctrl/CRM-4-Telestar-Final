'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { X, MailX } from 'lucide-react';
import HealthLevelBadge from './HealthLevelBadge';
import { useEscapeClose } from '@/hooks/useEscapeClose';
import { readApiError } from '@/lib/api/client';
import type { InboxHealthRow } from '@/lib/hooks/useEmailHealth';
import type { TrendPoint } from './EmailHealthTrendChart';

/**
 * Inbox detail as a right-side slide-over.
 *
 * Per the project's architecture rule, detail views are never their own route —
 * see components/LeadDetailPanel.tsx for the same pattern.
 */

const EmailHealthTrendChart = dynamic(() => import('./EmailHealthTrendChart'), { ssr: false });

interface BounceRow {
  id: string;
  to: string;
  subject: string | null;
  bounceType: string | null;
  bouncedAt: string | null;
  lead: { id: string; firstName: string; lastName: string; company: string } | null;
}

interface DetailPayload {
  account: InboxHealthRow;
  snapshots: TrendPoint[];
  recentBounces: BounceRow[];
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

type Props = { accountId: string; fallbackRow: InboxHealthRow; onClose: () => void };

export default function InboxHealthDetailPanel({ accountId, fallbackRow, onClose }: Props) {
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEscapeClose(onClose);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const res = await fetch(`/api/email-health/accounts/${accountId}`, { signal: controller.signal });
        if (!res.ok) throw new Error(await readApiError(res, 'Failed to load inbox detail'));
        setDetail(await res.json());
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Failed to load inbox detail');
      }
    }

    load();
    return () => controller.abort();
  }, [accountId]);

  const account = detail?.account ?? fallbackRow;

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="inbox-detail-title">
      <button
        type="button"
        aria-label="Close panel"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm cursor-default"
      />

      <aside className="relative w-[520px] max-w-full h-full bg-card-bg border-l border-card-border shadow-xl overflow-y-auto">
        <header className="sticky top-0 bg-card-bg border-b border-card-border px-5 py-4 flex items-start justify-between gap-3 z-10">
          <div className="min-w-0">
            <h2 id="inbox-detail-title" className="font-display font-extrabold text-lg text-text-primary truncate">
              {account.owner ? `${account.owner.firstName} ${account.owner.lastName}` : 'Unassigned inbox'}
            </h2>
            <p className="text-xs text-text-muted font-mono truncate">{account.email}</p>
            <div className="mt-2 flex items-center gap-2">
              <HealthLevelBadge level={account.healthLevel} score={account.healthScore} size="md" />
              <span className="text-[11px] text-text-muted">{account.provider}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-text-muted hover:text-text-primary transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="p-5 space-y-6">
          {error && (
            <p className="text-xs text-brand-red bg-brand-red/10 border border-brand-red/25 rounded-lg p-3">
              {error}
            </p>
          )}

          {account.isPaused && (
            <div className="rounded-xl border border-brand-red/25 bg-brand-red/10 p-3">
              <p className="text-xs font-semibold text-brand-red">Sending is paused</p>
              {account.pauseReason && (
                <p className="text-[11px] text-text-secondary mt-1">{account.pauseReason}</p>
              )}
            </div>
          )}

          <section className="grid grid-cols-2 gap-3">
            {[
              { label: 'Sent today', value: `${account.sentToday} / ${account.dailyCap}` },
              { label: 'Sent (7 days)', value: String(account.sevenDaySent) },
              { label: 'Hard bounce', value: pct(account.hardBounceRate) },
              { label: 'Soft bounce', value: pct(account.softBounceRate) },
              { label: 'Reply rate', value: pct(account.replyRate) },
              { label: 'Spam signal', value: pct(account.spamSignalRate) },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl border border-card-border p-3">
                <span className="text-[10px] uppercase tracking-wider text-text-secondary font-semibold font-display block">
                  {stat.label}
                </span>
                <span className="text-lg font-extrabold text-text-primary font-display">{stat.value}</span>
              </div>
            ))}
          </section>

          {account.reasons.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary font-display">
                Why this score
              </h3>
              <ul className="space-y-1.5">
                {account.reasons.map((reason, i) => (
                  <li key={reason} className="text-xs text-text-secondary flex gap-2">
                    <span className="text-brand-orange shrink-0">•</span>
                    <span>
                      {reason}
                      {account.recommendedActions[i] && (
                        <span className="block text-[11px] text-text-primary mt-0.5">
                          → {account.recommendedActions[i]}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary font-display">
              Health trend
            </h3>
            <EmailHealthTrendChart points={detail?.snapshots ?? []} />
          </section>

          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary font-display">
              Recent bounces
            </h3>
            {detail && detail.recentBounces.length === 0 && (
              <p className="text-xs text-text-muted">No bounces recorded for this inbox.</p>
            )}
            <ul className="space-y-1.5">
              {(detail?.recentBounces ?? []).map((bounce) => (
                <li key={bounce.id} className="flex items-start gap-2 text-xs">
                  <MailX className="w-3.5 h-3.5 mt-0.5 shrink-0 text-brand-red" aria-hidden="true" />
                  <div className="min-w-0">
                    <span className="block text-text-primary truncate">
                      {bounce.lead
                        ? `${bounce.lead.firstName} ${bounce.lead.lastName} · ${bounce.lead.company}`
                        : bounce.to}
                    </span>
                    <span className="block text-[10px] text-text-muted font-mono">
                      {bounce.bounceType ?? 'hard'}
                      {bounce.bouncedAt &&
                        ` · ${new Date(bounce.bouncedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </aside>
    </div>
  );
}
