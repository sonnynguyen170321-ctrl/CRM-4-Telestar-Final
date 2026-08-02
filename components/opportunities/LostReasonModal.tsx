'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import type { Opportunity } from './types';
import { LOST_REASONS } from './ClientAcceptanceModal';

export default function LostReasonModal({
  open,
  onClose,
  onSubmit,
  opportunity,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: () => void;
  opportunity: Opportunity | null;
}) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [lostReason, setLostReason] = useState('');
  const [lostReasonDetails, setLostReasonDetails] = useState('');
  const [note, setNote] = useState('');

  const target = open && opportunity ? opportunity : null;

  if (!target) return null;

  const opportunityId = target.id;

  async function handleSubmit() {
    if (!lostReason) {
      showToast('Lost reason is required', 'error');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage: 'lost',
          lostReason,
          lostReasonDetails: lostReasonDetails || undefined,
          note: note || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error ?? 'Failed to move to lost', 'error');
        return;
      }

      showToast('Opportunity marked as lost', 'success');
      setLostReason('');
      setLostReasonDetails('');
      setNote('');
      onSubmit();
      onClose();
    } catch {
      showToast('Failed to move to lost', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-card-border bg-card-bg p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Mark as Lost</h2>
          <button onClick={onClose} className="text-muted hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mb-4 text-sm text-muted">
          <span className="text-white">{target.title}</span> · {target.client.name}
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Lost Reason *</label>
            <select
              value={lostReason}
              onChange={e => setLostReason(e.target.value)}
              className="w-full bg-surface border border-card-border rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 outline-none"
            >
              <option value="">Select reason</option>
              {LOST_REASONS.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Details</label>
            <textarea
              value={lostReasonDetails}
              onChange={e => setLostReasonDetails(e.target.value)}
              rows={2}
              className="w-full bg-surface border border-card-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted/50 focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 outline-none resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Note</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
              placeholder="Optional internal note"
              className="w-full bg-surface border border-card-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted/50 focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 outline-none resize-none"
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-card-border px-4 py-2 text-sm text-muted hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
          >
            {loading ? 'Saving...' : 'Mark as Lost'}
          </button>
        </div>
      </div>
    </div>
  );
}
