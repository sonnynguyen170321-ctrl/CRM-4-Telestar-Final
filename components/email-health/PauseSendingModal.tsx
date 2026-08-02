'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useEscapeClose } from '@/hooks/useEscapeClose';
import type { InboxHealthRow } from '@/lib/hooks/useEmailHealth';

/**
 * Confirms a send pause and captures why.
 *
 * The reason is required: it is shown to whoever later considers resuming, and
 * without it a paused inbox becomes an unexplained outage.
 */

const REASON_MAX = 500;

const QUICK_REASONS = [
  'Hard bounce rate too high',
  'Spam complaints detected',
  'Bad lead list — pending audit',
  'Domain DNS not verified',
  'Warming up — reducing volume',
];

type Props = {
  row: InboxHealthRow;
  isSubmitting: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
};

export default function PauseSendingModal({ row, isSubmitting, onClose, onConfirm }: Props) {
  const [reason, setReason] = useState('');
  useEscapeClose(onClose);

  const trimmed = reason.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= REASON_MAX && !isSubmitting;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pause-sending-title"
    >
      <div className="glass-card rounded-2xl p-6 w-full max-w-md space-y-4 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-red/10 text-brand-red border border-brand-red/20 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h2 id="pause-sending-title" className="font-display font-extrabold text-lg text-text-primary">
              Pause sending
            </h2>
            <p className="text-xs text-text-secondary mt-1">
              No further email will leave{' '}
              <span className="font-mono text-text-primary">{row.email}</span> until a manager
              resumes it. Sequences stay enrolled; their sends will fail closed.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="pause-reason" className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary font-display">
            Reason (required)
          </label>
          <input
            id="pause-reason"
            type="text"
            value={reason}
            maxLength={REASON_MAX}
            autoFocus
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) onConfirm(trimmed); }}
            placeholder="Why is this inbox being paused?"
            className="w-full bg-bg-main border border-card-border rounded-lg px-3 py-2 text-sm focus-ring"
          />
          <div className="flex flex-wrap gap-1.5">
            {QUICK_REASONS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setReason(preset)}
                className="px-2 py-1 rounded-md text-[10px] font-semibold border border-card-border text-text-secondary hover:text-text-primary hover:border-brand-orange/40 transition-colors cursor-pointer"
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-card-border text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => onConfirm(trimmed)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand-red text-white hover:bg-brand-red-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {isSubmitting ? 'Pausing…' : 'Pause sending'}
          </button>
        </div>
      </div>
    </div>
  );
}
