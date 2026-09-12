'use client';

import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';

export type ResearchCampaignOption = {
  id: string;
  name: string;
  client: { name: string };
};

export default function ResearchPromotionDialog({
  isOpen,
  campaigns,
  candidateCount,
  busy,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  campaigns: ResearchCampaignOption[];
  candidateCount: number;
  busy: boolean;
  onClose: () => void;
  onConfirm: (campaignId: string) => Promise<void>;
}) {
  const [campaignId, setCampaignId] = useState('');

  useEffect(() => {
    if (!isOpen) setCampaignId('');
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close campaign picker"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={busy ? undefined : onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="research-promotion-title"
        className="relative z-10 w-full max-w-lg rounded-lg border border-card-border bg-card-bg p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="research-promotion-title" className="type-section font-bold text-text-primary">
              Choose campaign
            </h2>
            <p className="mt-1 type-meta text-text-muted">
              Add {candidateCount} candidate{candidateCount === 1 ? '' : 's'} to one campaign pipeline.
              The reusable prospect stays available for other campaigns.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-text-muted hover:bg-bg-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red disabled:opacity-50"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <label className="mt-5 block space-y-1">
          <span className="type-meta font-semibold text-text-secondary">Active campaign</span>
          <select
            autoFocus
            value={campaignId}
            onChange={(event) => setCampaignId(event.target.value)}
            className="min-h-11 w-full rounded-lg border border-card-border bg-bg-main px-3 type-body text-text-primary outline-none focus:border-brand-red focus:ring-2 focus:ring-brand-red/20"
          >
            <option value="">Select a campaign</option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name} / {campaign.client.name}
              </option>
            ))}
          </select>
        </label>

        {campaigns.length === 0 && (
          <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 type-meta text-amber-300">
            No active campaign is available in your scope.
          </p>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="inline-flex min-h-11 items-center rounded-lg border border-card-border px-4 type-meta font-semibold text-text-secondary hover:bg-bg-main disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!campaignId || busy}
            onClick={() => onConfirm(campaignId)}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-red px-4 type-meta font-semibold text-white hover:bg-brand-red/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {busy ? 'Adding...' : 'Add to campaign'}
          </button>
        </div>
      </section>
    </div>
  );
}
