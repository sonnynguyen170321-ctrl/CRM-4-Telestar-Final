'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, GitPullRequestArrow, Lightbulb, RefreshCw, ShieldCheck, X } from 'lucide-react';
import EmptyState from '@/components/operating/EmptyState';
import StatusBadge from '@/components/operating/StatusBadge';

/**
 * The approval queue for what the system learned (Phase 10).
 *
 * Every row answers the seven questions a manager needs before deciding: what happened, what
 * evidence supports it, what pattern the system thinks it sees, what change is proposed, which
 * campaign it affects, and what approving or rejecting actually does. The last two are printed on
 * the row rather than explained elsewhere, because "approve" is exactly the word a reader will
 * assume means "apply".
 *
 * It does not: apply a change, edit a playbook, or activate anything. Approving creates a draft.
 */

interface EvidenceRow {
  kind: string;
  detail: string | null;
  occurredAt: string;
  leadId: string | null;
}

interface Proposal {
  id: string;
  campaignId: string;
  campaignName: string | null;
  title: string;
  observation: string;
  suggestedChange: string;
  status: string;
  supportCount: number;
  ifApproved: string;
  ifRejected: string;
  basedOnVersionNumber: number | null;
  createdVersionNumber: number | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  evidence: EvidenceRow[];
  createdAt: string;
}

const EVIDENCE_LABEL: Record<string, string> = {
  positive_reply: 'Positive reply',
  reengagement_reply: 'Reply after follow-up',
  objection_raised: 'Objection raised',
  meeting_booked: 'Meeting booked',
  lead_rejected: 'Prospect said no',
  draft_accepted: 'Draft sent as written',
  draft_edited: 'Draft rewritten',
  research_irrelevant: 'Research not useful',
};

export default function PlaybookProposals() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [canReview, setCanReview] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/proposals');
      if (!res.ok) throw new Error('proposals');
      const body = await res.json();
      setProposals(body.proposals ?? []);
      setCanReview(Boolean(body.canReview));
    } catch {
      setError('Could not load playbook proposals.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const rebuild = useCallback(async () => {
    setBusy('rebuild');
    setMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/ai/proposals', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'refresh failed');
      await load();
      setMessage(
        `Reviewed ${body.signals.scanned} outcomes. ${body.proposals.created} new proposal(s), ${body.proposals.updated} updated. No policy was changed.`
      );
    } catch {
      setError('Could not rebuild the proposal queue.');
    } finally {
      setBusy(null);
    }
  }, [load]);

  const decide = useCallback(async (id: string, decision: 'approve' | 'reject') => {
    setBusy(id);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/ai/proposals/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const body = await res.json();
      await load();
      if (!res.ok) setError(body.error ?? 'The decision was refused.');
      else setMessage(body.message);
    } catch {
      setError('The decision could not be recorded. Nothing was changed.');
    } finally {
      setBusy(null);
    }
  }, [load]);

  return (
    <section className="rounded-xl border border-card-border bg-card-bg overflow-hidden" data-testid="insights">
      <div className="px-5 py-3.5 border-b border-card-border flex items-start justify-between gap-4">
        <div>
          <h2 className="type-section flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-brand-gold-text" aria-hidden="true" />
            Playbook proposals
          </h2>
          <p className="type-meta text-text-muted mt-1 prose-measure">
            What outcomes suggest changing. Approving creates a new draft for review — it never
            edits the playbook that is running.
          </p>
        </div>
        {canReview && (
          <button
            type="button"
            onClick={() => void rebuild()}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-card-border type-meta text-text-secondary transition-colors hover:bg-gray-50 hover:text-text-primary focus-ring disabled:opacity-50"
            data-testid="proposals-rebuild"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            {busy === 'rebuild' ? 'Reviewing outcomes…' : 'Review outcomes'}
          </button>
        )}
      </div>

      {message && (
        <p className="px-5 py-3 type-meta text-emerald-900 bg-emerald-50 border-b border-emerald-200" data-testid="proposal-result">
          {message}
        </p>
      )}
      {error && (
        <p className="px-5 py-3 type-meta text-red-800 bg-red-50 border-b border-red-200" role="alert">
          {error}
        </p>
      )}

      {proposals.length === 0 ? (
        <EmptyState
          title="No proposals yet."
          description="Proposals appear once enough outcomes have accumulated to show a pattern worth changing policy for."
          icon={Lightbulb}
        />
      ) : (
        <ul className="divide-y divide-card-border">
          {proposals.map((p) => (
            <li key={p.id} className="px-5 py-4" data-testid={`proposal-${p.id}`}>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  label={p.status === 'proposed' ? 'Proposed' : p.status === 'approved' ? 'Approved' : p.status === 'rejected' ? 'Rejected' : 'Superseded'}
                  tone={p.status === 'approved' ? 'done' : p.status === 'rejected' ? 'blocked' : 'waiting'}
                />
                <span className="type-meta text-text-secondary">{p.campaignName ?? 'Campaign'}</span>
                <span className="type-micro font-mono text-text-muted">{p.supportCount} supporting outcomes</span>
              </div>

              <h3 className="type-subsection mt-2.5">{p.title}</h3>
              <p className="type-body text-text-primary mt-1.5 prose-measure">{p.observation}</p>

              {p.evidence.length > 0 && (
                <div className="mt-3">
                  <span className="type-micro text-text-muted">Evidence</span>
                  <ul className="mt-1 space-y-1" data-testid={`proposal-evidence-${p.id}`}>
                    {p.evidence.map((e, n) => (
                      <li key={n} className="type-meta text-text-secondary flex gap-2 prose-measure">
                        <span className="text-text-muted shrink-0" aria-hidden="true">—</span>
                        <span>
                          <span className="text-text-primary">{EVIDENCE_LABEL[e.kind] ?? e.kind.replace(/_/g, ' ')}</span>
                          {e.detail ? ` · ${e.detail}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-3 flex gap-2.5">
                <GitPullRequestArrow className="w-4 h-4 text-text-muted shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <span className="type-micro text-text-muted">Proposed change</span>
                  <p className="type-body text-text-primary mt-0.5 prose-measure">{p.suggestedChange}</p>
                </div>
              </div>

              <div className="mt-3 rounded-lg border border-card-border px-4 py-3 space-y-1">
                <p className="type-meta text-text-secondary prose-measure">
                  <span className="text-text-primary">If you approve:</span> {p.ifApproved}
                </p>
                <p className="type-meta text-text-secondary prose-measure">
                  <span className="text-text-primary">If you reject:</span> {p.ifRejected}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-card-border">
                <span className="inline-flex items-center gap-1.5 type-meta text-text-secondary">
                  <ShieldCheck className="w-3.5 h-3.5 text-text-muted" aria-hidden="true" />
                  {p.status === 'proposed'
                    ? 'Manager approval required'
                    : p.reviewedByName
                      ? `${p.status === 'approved' ? 'Approved' : 'Rejected'} by ${p.reviewedByName}`
                      : `${p.status}`}
                  {p.createdVersionNumber !== null && ` · draft version ${p.createdVersionNumber} created`}
                  {p.basedOnVersionNumber !== null && ` · based on version ${p.basedOnVersionNumber}`}
                </span>

                {canReview && p.status === 'proposed' && (
                  <span className="flex gap-2 ml-auto">
                    <button
                      type="button"
                      onClick={() => void decide(p.id, 'approve')}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-red text-white type-meta transition-colors hover:bg-brand-red/90 focus-ring disabled:opacity-50"
                      data-testid={`proposal-approve-${p.id}`}
                    >
                      <Check className="w-3.5 h-3.5" aria-hidden="true" /> Approve as draft
                    </button>
                    <button
                      type="button"
                      onClick={() => void decide(p.id, 'reject')}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-card-border type-meta text-text-secondary transition-colors hover:bg-gray-50 focus-ring disabled:opacity-50"
                      data-testid={`proposal-reject-${p.id}`}
                    >
                      <X className="w-3.5 h-3.5" aria-hidden="true" /> Reject
                    </button>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
