'use client';

import { Check, Eye, Loader2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { RescorePreview } from '@/components/automation/RescorePreview';
import { ActionButton } from '@/components/icp/IcpEditorCard';
import { inputClass } from '@/components/icp/IcpRuleEditor';
import { icpApi, readJson } from '@/components/icp/icpClient';
import { useToast } from '@/context/ToastContext';
import type { IcpRuleChange } from '@/lib/leadgen/icpRuleDiff';
import type { IcpPreviewResult } from '@/lib/leads/icpPreview';

type Person = { id: string; firstName: string; lastName: string };
type Review = {
  id: string;
  versionNumber: number;
  submittedAt: string | null;
  profile: { id: string; name: string; kind: string; owner: Person | null };
  submittedBy: Person | null;
  currentPublishedVersion: number | null;
  changes: IcpRuleChange[];
  rulesJson: unknown;
  campaigns: Array<{ id: string; name: string }>;
};

const personName = (person: Person | null) => (person ? `${person.firstName} ${person.lastName}`.trim() : 'Unknown');

/**
 * Personal ICPs waiting for a decision. A team lead sees their pod's submissions, a manager sees
 * all of them. Each shows what changes in plain language, what it would do to the leads of each
 * campaign it would score (nothing is written), and Approve / Send back. After an approval the
 * campaigns on that ICP are offered a rescore, because approving does not move existing verdicts.
 */
export function IcpReviewQueue({ onDecided }: { onDecided?: () => void }) {
  const { showToast } = useToast();
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [busy, setBusy] = useState('');
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [previews, setPreviews] = useState<Record<string, IcpPreviewResult | 'loading'>>({});
  const [approved, setApproved] = useState<Array<{ profile: string; campaigns: Array<{ id: string; name: string }> }>>([]);

  const load = useCallback(async () => {
    try {
      const data = await fetch('/api/icp/reviews').then((r) => readJson<{ reviews: Review[] }>(r));
      setReviews(data.reviews);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not load reviews', 'error');
      setReviews([]);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const preview = async (review: Review, campaignId: string) => {
    const key = `${review.id}:${campaignId}`;
    setPreviews((current) => ({ ...current, [key]: 'loading' }));
    try {
      const result = await fetch(`/api/icp/versions/${review.id}/preview-score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rulesJson: review.rulesJson, campaignId }),
      }).then((r) => readJson<IcpPreviewResult>(r));
      setPreviews((current) => ({ ...current, [key]: result }));
    } catch (error) {
      setPreviews((current) => {
        const { [key]: _gone, ...rest } = current;
        return rest;
      });
      showToast(error instanceof Error ? error.message : 'Preview failed', 'error');
    }
  };

  const decide = async (review: Review, kind: 'approve' | 'reject') => {
    setBusy(`${kind}:${review.id}`);
    try {
      if (!review.submittedAt) throw new Error('This submission has no timestamp; reload the queue');
      if (kind === 'approve') {
        const result = await icpApi.approve(review.id, review.submittedAt);
        setApproved((current) => [...current, { profile: review.profile.name, campaigns: result.campaigns }]);
        showToast(`${review.profile.name} approved. Rescore its campaigns to apply it to existing leads.`, 'success');
      } else {
        await icpApi.reject(review.id, note, review.submittedAt);
        showToast('Sent back to the rep with your note', 'success');
        setRejecting(null);
        setNote('');
      }
      await load();
      onDecided?.();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Request failed', 'error');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-card-border bg-card-bg p-6">
        <h2 className="type-section text-text-primary">ICP reviews</h2>
        <p className="mt-2 max-w-[68ch] text-sm leading-6 text-text-secondary">
          Custom ICPs that reps submitted. Nothing scores against them until you approve.
        </p>
        {reviews === null ? (
          <p className="mt-6 flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading reviews…
          </p>
        ) : reviews.length === 0 ? (
          <p className="mt-6 text-sm text-text-secondary">Nothing is waiting for your review.</p>
        ) : (
          <ul className="mt-6 space-y-5">
            {reviews.map((review) => (
              <li key={review.id} className="rounded-xl border border-card-border bg-bg-main p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="type-card text-text-primary">
                      {review.profile.name} · v{review.versionNumber}
                    </h3>
                    <p className="mt-1 text-xs text-text-secondary">
                      Submitted by {personName(review.submittedBy)}
                      {review.submittedAt && ` on ${new Date(review.submittedAt).toLocaleDateString()}`}
                      {review.currentPublishedVersion
                        ? ` · replaces v${review.currentPublishedVersion}`
                        : ' · first version'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <ActionButton label="Approve" icon={Check} busy={busy === `approve:${review.id}`} disabled={Boolean(busy)} onClick={() => void decide(review, 'approve')} primary />
                    <ActionButton label="Send back" icon={X} busy={false} disabled={Boolean(busy)} onClick={() => setRejecting(rejecting === review.id ? null : review.id)} />
                  </div>
                </div>

                {rejecting === review.id && (
                  <div className="mt-4 flex items-end gap-3">
                    <label className="flex-1 space-y-2 text-xs font-semibold text-text-secondary">
                      What should they change?
                      <input className={inputClass} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Add a target country; titles are too broad" />
                    </label>
                    <ActionButton label="Send back" icon={X} busy={busy === `reject:${review.id}`} disabled={Boolean(busy) || note.trim().length < 3} onClick={() => void decide(review, 'reject')} primary />
                  </div>
                )}

                <h4 className="mt-5 text-xs font-bold uppercase tracking-wide text-text-muted">
                  {review.currentPublishedVersion ? 'What changes' : 'Rules in this ICP'}
                </h4>
                {review.changes.length === 0 ? (
                  <p className="mt-2 text-xs text-text-secondary">No rule differs from the current version.</p>
                ) : (
                  <dl className="mt-2 divide-y divide-card-border/60 text-xs">
                    {review.changes.map((change) => (
                      <div key={change.label} className="grid grid-cols-[200px_1fr] gap-3 py-2">
                        <dt className="font-semibold text-text-primary">{change.label}</dt>
                        <dd className="text-text-secondary">
                          {review.currentPublishedVersion ? (
                            <>
                              <span className="line-through opacity-70">{change.before}</span>
                              {' → '}
                              <span className="font-semibold text-text-primary">{change.after}</span>
                            </>
                          ) : (
                            change.after
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}

                <h4 className="mt-5 text-xs font-bold uppercase tracking-wide text-text-muted">Effect on campaign leads</h4>
                {review.campaigns.length === 0 ? (
                  <p className="mt-2 text-xs text-text-secondary">No campaign you can see uses this ICP yet.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {review.campaigns.map((campaign) => {
                      const result = previews[`${review.id}:${campaign.id}`];
                      return (
                        <li key={campaign.id} className="rounded-lg border border-card-border px-3 py-2 text-xs">
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-semibold text-text-primary">{campaign.name}</span>
                            <button
                              type="button"
                              onClick={() => void preview(review, campaign.id)}
                              disabled={result === 'loading'}
                              className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border border-card-border px-3 font-bold text-text-primary hover:bg-card-bg disabled:opacity-50"
                            >
                              {result === 'loading' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
                              Preview on leads
                            </button>
                          </div>
                          {result && result !== 'loading' && <PreviewSummary result={result} />}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {approved.map((entry, index) => (
        <section key={`${entry.profile}-${index}`} className="space-y-3">
          <p className="text-sm font-semibold text-text-primary">
            {entry.profile} is live. Apply it to existing leads:
          </p>
          {entry.campaigns.length === 0 ? (
            <p className="text-xs text-text-secondary">No campaign you can see uses it yet.</p>
          ) : (
            entry.campaigns.map((campaign) => (
              <RescoreCampaign key={campaign.id} campaignId={campaign.id} campaignName={campaign.name} />
            ))
          )}
        </section>
      ))}
    </div>
  );
}

function RescoreCampaign({ campaignId, campaignName }: { campaignId: string; campaignName: string }) {
  const { showToast } = useToast();
  return <RescorePreview showToast={showToast} campaignId={campaignId} campaignName={campaignName} />;
}

const LABEL = { qualified: 'Fit', needs_review: 'Review', unqualified: 'No fit' } as const;

export function PreviewSummary({ result }: { result: IcpPreviewResult }) {
  return (
    <p className="mt-2 text-text-secondary" role="status">
      {result.sampleSize} lead{result.sampleSize === 1 ? '' : 's'} checked:{' '}
      {(['qualified', 'needs_review', 'unqualified'] as const).map((key, index) => (
        <span key={key}>
          {index > 0 && ' · '}
          {LABEL[key]} {result.before[key]} → <span className="font-semibold text-text-primary">{result.after[key]}</span>
        </span>
      ))}
      {result.before.unscored > 0 && ` · ${result.before.unscored} not scored yet`}
    </p>
  );
}
