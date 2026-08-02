'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import type { Opportunity } from './types';

export const LOST_REASONS: { value: string; label: string }[] = [
  { value: 'no_budget', label: 'No budget' },
  { value: 'no_authority', label: 'No authority' },
  { value: 'no_need', label: 'No need' },
  { value: 'no_timeline', label: 'No timeline' },
  { value: 'wrong_icp', label: 'Wrong ICP' },
  { value: 'wrong_persona', label: 'Wrong persona' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'competitor', label: 'Competitor selected' },
  { value: 'unresponsive', label: 'Unresponsive' },
  { value: 'client_rejected', label: 'Client rejected' },
  { value: 'other', label: 'Other' },
];

export default function ClientAcceptanceModal({
  open,
  onClose,
  onDecision,
  opportunity,
}: {
  open: boolean;
  onClose: () => void;
  onDecision: () => void;
  opportunity: Opportunity | null;
}) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [decision, setDecision] = useState<string>('accepted');
  const [clientFeedback, setClientFeedback] = useState('');
  const [lostReason, setLostReason] = useState('');
  const [lostReasonDetails, setLostReasonDetails] = useState('');

  const target = open && opportunity ? opportunity : null;

  if (!target) return null;

  const opportunityId = target.id;

  async function handleSubmit() {
    if (decision === 'rejected' && !lostReason) {
      showToast('Lost reason is required when rejecting', 'error');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/handoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          clientFeedback: clientFeedback || undefined,
          lostReason: lostReason || undefined,
          lostReasonDetails: lostReasonDetails || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error ?? 'Failed to submit decision', 'error');
        return;
      }

      showToast(
        decision === 'accepted'
          ? 'Opportunity accepted — moving into pipeline'
          : decision === 'rejected'
            ? 'Opportunity rejected'
            : 'Marked as needs more info',
        'success',
      );
      setDecision('accepted');
      setClientFeedback('');
      setLostReason('');
      setLostReasonDetails('');
      onDecision();
      onClose();
    } catch {
      showToast('Failed to submit decision', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-card-border bg-card-bg p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Client Review Decision</h2>
          <button onClick={onClose} className="text-muted hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mb-4 text-sm text-muted">
          <span className="text-white">{target.title}</span> · {target.client.name}
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Decision *</label>
            <div className="flex gap-2">
              {[
                { value: 'accepted', label: 'Accept', cls: 'border-emerald-500/40 text-emerald-400' },
                { value: 'needs_more_info', label: 'Needs Info', cls: 'border-amber-500/40 text-amber-400' },
                { value: 'rejected', label: 'Reject', cls: 'border-red-500/40 text-red-400' },
              ].map(o => (
                <button
                  key={o.value}
                  onClick={() => setDecision(o.value)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    decision === o.value
                      ? o.cls
                      : 'border-card-border text-muted hover:text-white'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Client Feedback</label>
            <textarea
              value={clientFeedback}
              onChange={e => setClientFeedback(e.target.value)}
              rows={3}
              placeholder="What did the client say?"
              className="w-full bg-surface border border-card-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted/50 focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 outline-none resize-none"
            />
          </div>

          {decision === 'rejected' && (
            <div className="space-y-3">
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
            </div>
          )}
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
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {loading ? 'Submitting...' : 'Submit Decision'}
          </button>
        </div>
      </div>
    </div>
  );
}
