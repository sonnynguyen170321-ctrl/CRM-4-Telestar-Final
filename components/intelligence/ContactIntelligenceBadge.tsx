'use client';

import React from 'react';
import type { ContactQualityClass, ContactReuseStatus, ContactLifecycleState } from '@prisma/client';

const QUALITY_CONFIG: Record<ContactQualityClass, { label: string; bg: string; text: string; border: string; dot: string }> = {
  proven: { label: 'Proven Asset', bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20', dot: 'bg-emerald-400' },
  promising: { label: 'Promising', bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20', dot: 'bg-blue-400' },
  untested: { label: 'Untested', bg: 'bg-zinc-500/10', text: 'text-zinc-400', border: 'border-zinc-500/20', dot: 'bg-zinc-400' },
  weak: { label: 'Weak Data', bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20', dot: 'bg-amber-400' },
  invalid: { label: 'Invalid / DNC', bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/20', dot: 'bg-rose-400' },
};

const REUSE_CONFIG: Record<ContactReuseStatus, { label: string; bg: string; text: string; border: string }> = {
  ready: { label: 'Ready for Reuse', bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  reverify_first: { label: 'Re-verify First', bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' },
  cooldown: { label: 'In Cooldown', bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' },
  relationship_only: { label: 'Owner Warm-Only', bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/20' },
  client_locked: { label: 'Client Locked', bg: 'bg-indigo-500/10', text: 'text-indigo-400', border: 'border-indigo-500/20' },
  conflict_review: { label: 'Conflict Review', bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' },
  do_not_contact: { label: 'Do Not Contact', bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/20' },
  archived: { label: 'Archived', bg: 'bg-zinc-500/10', text: 'text-zinc-400', border: 'border-zinc-500/20' },
};

interface ContactIntelligenceBadgeProps {
  qualityClass?: ContactQualityClass | null;
  reuseStatus?: ContactReuseStatus | null;
  lifecycleState?: ContactLifecycleState | null;
  score?: number | null;
  onClick?: () => void;
  size?: 'sm' | 'md';
}

export default function ContactIntelligenceBadge({
  qualityClass,
  reuseStatus,
  lifecycleState,
  score,
  onClick,
  size = 'sm',
}: ContactIntelligenceBadgeProps) {
  const quality = qualityClass ? QUALITY_CONFIG[qualityClass] || QUALITY_CONFIG.untested : null;
  const reuse = reuseStatus ? REUSE_CONFIG[reuseStatus] : null;

  const sizeCls = size === 'sm' ? 'text-[11px] px-2 py-0.5' : 'text-xs px-2.5 py-1';

  return (
    <div
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 ${onClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
    >
      {quality && (
        <span className={`inline-flex items-center gap-1.5 rounded-full font-medium border ${quality.bg} ${quality.text} ${quality.border} ${sizeCls}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${quality.dot}`} />
          {quality.label}
        </span>
      )}

      {score !== undefined && score !== null && (
        <span className={`inline-flex items-center rounded-full font-mono font-semibold border ${sizeCls} ${
          score >= 80
            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
            : score >= 50
            ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
            : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
        }`}>
          {score}/100
        </span>
      )}

      {reuse && (
        <span className={`inline-flex items-center rounded-full font-medium border ${reuse.bg} ${reuse.text} ${reuse.border} ${sizeCls}`}>
          {reuse.label}
        </span>
      )}

      {lifecycleState && !quality && !reuse && (
        <span className={`inline-flex items-center rounded-full font-medium border bg-zinc-500/10 text-zinc-400 border-zinc-500/20 ${sizeCls}`}>
          {lifecycleState.replace(/_/g, ' ')}
        </span>
      )}
    </div>
  );
}
