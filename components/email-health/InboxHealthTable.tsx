'use client';

import { PauseCircle, PlayCircle, Check, X, Pencil } from 'lucide-react';
import { useState } from 'react';
import HealthLevelBadge from './HealthLevelBadge';
import type { InboxHealthRow } from '@/lib/hooks/useEmailHealth';

/**
 * The inbox health grid. Absorbs and extends the "Active Outbound Accounts &
 * Daily Limits" table that used to live on /automation.
 */

const CAP_MIN = 1;
const CAP_MAX = 2000;
const STALE_SYNC_MS = 24 * 60 * 60 * 1000;

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function rateTone(rate: number, warnAt: number, badAt: number): string {
  if (rate >= badAt) return 'text-brand-red font-semibold';
  if (rate >= warnAt) return 'text-brand-orange-text font-semibold';
  return 'text-text-secondary';
}

function usageBarColor(usagePct: number): string {
  if (usagePct >= 90) return 'bg-brand-red';
  if (usagePct >= 70) return 'bg-brand-orange';
  return 'bg-channel-email';
}

function formatSync(lastSyncAt: string | null): { text: string; isStale: boolean } {
  if (!lastSyncAt) return { text: 'Never', isStale: true };
  const date = new Date(lastSyncAt);
  const isStale = Date.now() - date.getTime() > STALE_SYNC_MS;
  return {
    text: date.toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }),
    isStale,
  };
}

type Props = {
  rows: InboxHealthRow[];
  canManage: boolean;
  isMutating: boolean;
  onSelect: (row: InboxHealthRow) => void;
  onPause: (row: InboxHealthRow) => void;
  onResume: (row: InboxHealthRow) => void;
  onUpdateCap: (row: InboxHealthRow, dailyCap: number) => void;
};

export default function InboxHealthTable({
  rows, canManage, isMutating, onSelect, onPause, onResume, onUpdateCap,
}: Props) {
  const [editingCapId, setEditingCapId] = useState<string | null>(null);
  const [capDraft, setCapDraft] = useState<string>('');

  const startEditingCap = (row: InboxHealthRow) => {
    setEditingCapId(row.id);
    setCapDraft(String(row.dailyCap));
  };

  const commitCap = (row: InboxHealthRow) => {
    const next = parseInt(capDraft, 10);
    if (Number.isFinite(next) && next >= CAP_MIN && next <= CAP_MAX && next !== row.dailyCap) {
      onUpdateCap(row, next);
    }
    setEditingCapId(null);
  };

  if (rows.length === 0) {
    return (
      <div className="text-center py-12 text-sm text-text-secondary">
        No connected inboxes in your scope yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse text-xs">
        <thead>
          <tr className="border-b border-card-border text-[10px] uppercase text-text-secondary tracking-wider font-semibold">
            <th scope="col" className="py-2 pr-3">Owner / Inbox</th>
            <th scope="col" className="py-2 pr-3">Health</th>
            <th scope="col" className="py-2 pr-3">Daily Usage</th>
            <th scope="col" className="py-2 pr-3 text-right">7d Sent</th>
            <th scope="col" className="py-2 pr-3 text-right">Hard Bnc</th>
            <th scope="col" className="py-2 pr-3 text-right">Soft Bnc</th>
            <th scope="col" className="py-2 pr-3 text-right">Reply</th>
            <th scope="col" className="py-2 pr-3">Last Sync</th>
            <th scope="col" className="py-2 pr-3">Next Action</th>
            {canManage && <th scope="col" className="py-2 text-right">Controls</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-card-border/50">
          {rows.map((row) => {
            const sync = formatSync(row.lastSyncAt);
            const isEditing = editingCapId === row.id;

            return (
              <tr key={row.id} className="hover:bg-card-border/20 transition-colors">
                <td className="py-2.5 pr-3">
                  <button
                    type="button"
                    onClick={() => onSelect(row)}
                    className="text-left focus-ring rounded cursor-pointer"
                  >
                    <span className="block font-semibold text-text-primary">
                      {row.owner ? `${row.owner.firstName} ${row.owner.lastName}` : 'Unassigned'}
                    </span>
                    <span className="block text-text-muted font-mono text-[11px]">{row.email}</span>
                  </button>
                </td>

                <td className="py-2.5 pr-3">
                  <HealthLevelBadge level={row.healthLevel} score={row.healthScore} />
                  {row.isPaused && row.pauseReason && (
                    <span className="block text-[10px] text-text-muted mt-1 max-w-[160px] truncate" title={row.pauseReason}>
                      {row.pauseReason}
                    </span>
                  )}
                </td>

                <td className="py-2.5 pr-3 min-w-[130px]">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-text-primary">{row.sentToday}</span>
                    <span className="text-text-muted">/</span>
                    {isEditing ? (
                      <span className="flex items-center gap-1">
                        <input
                          type="number"
                          min={CAP_MIN}
                          max={CAP_MAX}
                          value={capDraft}
                          autoFocus
                          onChange={(e) => setCapDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitCap(row);
                            if (e.key === 'Escape') setEditingCapId(null);
                          }}
                          className="w-16 bg-bg-main border border-card-border rounded px-1 py-0.5 text-xs font-mono focus-ring"
                          aria-label={`Daily cap for ${row.email}`}
                        />
                        <button
                          type="button"
                          onClick={() => commitCap(row)}
                          className="text-channel-whatsapp hover:opacity-80 cursor-pointer"
                          aria-label="Save daily cap"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingCapId(null)}
                          className="text-text-muted hover:opacity-80 cursor-pointer"
                          aria-label="Cancel"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <span className="font-mono text-text-secondary">{row.dailyCap}</span>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => startEditingCap(row)}
                            className="text-text-muted hover:text-brand-orange-text transition-colors cursor-pointer"
                            aria-label={`Edit daily cap for ${row.email}`}
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                        )}
                      </span>
                    )}
                  </div>
                  <div className="w-full bg-card-border/50 h-1.5 rounded-full overflow-hidden mt-1.5">
                    <div
                      className={`h-full rounded-full transition-all ${usageBarColor(row.usagePct)}`}
                      style={{ width: `${Math.min(100, row.usagePct)}%` }}
                    />
                  </div>
                </td>

                <td className="py-2.5 pr-3 text-right font-mono text-text-secondary">{row.sevenDaySent}</td>
                <td className={`py-2.5 pr-3 text-right font-mono ${rateTone(row.hardBounceRate, 0.02, 0.05)}`}>
                  {pct(row.hardBounceRate)}
                </td>
                <td className={`py-2.5 pr-3 text-right font-mono ${rateTone(row.softBounceRate, 0.05, 0.08)}`}>
                  {pct(row.softBounceRate)}
                </td>
                <td className="py-2.5 pr-3 text-right font-mono text-text-secondary">{pct(row.replyRate)}</td>

                <td className={`py-2.5 pr-3 font-mono text-[11px] ${sync.isStale ? 'text-brand-orange-text' : 'text-text-secondary'}`}>
                  {sync.text}
                </td>

                <td className="py-2.5 pr-3 max-w-[220px]">
                  <span className="text-[11px] text-text-secondary line-clamp-2">
                    {row.recommendedActions[0] ?? '—'}
                  </span>
                </td>

                {canManage && (
                  <td className="py-2.5 text-right whitespace-nowrap">
                    {row.isPaused ? (
                      <button
                        type="button"
                        disabled={isMutating}
                        onClick={() => onResume(row)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border border-channel-whatsapp/30 text-channel-whatsapp hover:bg-channel-whatsapp/10 transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        <PlayCircle className="w-3.5 h-3.5" />
                        Resume
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={isMutating}
                        onClick={() => onPause(row)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border border-card-border text-text-secondary hover:text-brand-red hover:border-brand-red/30 transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        <PauseCircle className="w-3.5 h-3.5" />
                        Pause
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
