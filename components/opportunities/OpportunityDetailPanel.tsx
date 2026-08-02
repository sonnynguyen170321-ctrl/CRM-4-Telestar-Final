'use client';

import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useAppContext } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import {
  ageInDays,
  formatDate,
  formatMoney,
  toNumber,
  STAGES,
  type Opportunity,
  type OpportunityActivity,
} from './types';
import OpportunityStageBadge from './OpportunityStageBadge';
import ClientAcceptanceModal from './ClientAcceptanceModal';
import LostReasonModal from './LostReasonModal';

const STAGE_LABELS: Record<string, string> = {
  pending_client_review: 'Pending Client Review',
  accepted_by_client: 'Accepted by Client',
  discovery: 'Discovery',
  proposal: 'Proposal',
  negotiation: 'Negotiation',
  won: 'Won',
  lost: 'Lost',
  nurture: 'Nurture',
};

const ACTIVITY_LABELS: Record<string, string> = {
  created: 'Created',
  stage_changed: 'Stage Changed',
  value_updated: 'Value Updated',
  next_step_updated: 'Next Step Updated',
  handoff_accepted: 'Client Accepted',
  handoff_rejected: 'Client Rejected',
  handoff_info_requested: 'Needs More Info',
  note_added: 'Note Added',
  closed_won: 'Closed Won',
  closed_lost: 'Closed Lost',
};

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-text-muted">{label}</p>
      <p className="mt-0.5 text-sm text-text-primary">{value || '—'}</p>
    </div>
  );
}

export default function OpportunityDetailPanel({
  opportunity,
  onClose,
  onChanged,
}: {
  opportunity: Opportunity;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { isManager } = useAppContext();
  const { showToast } = useToast();
  const [detail, setDetail] = useState<Opportunity | null>(null);
  const [note, setNote] = useState('');
  const [submittingNote, setSubmittingNote] = useState(false);
  const [movingStage, setMovingStage] = useState(false);
  const [showHandoff, setShowHandoff] = useState(false);
  const [showLost, setShowLost] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/opportunities/${opportunity.id}`);
      if (res.ok) setDetail((await res.json()) as Opportunity);
    } catch {
      // panel will fall back to list data
    }
  }, [opportunity.id]);

  useEffect(() => {
    setDetail(null);
    refresh();
  }, [refresh]);

  const opp = detail ?? opportunity;
  const open = opp.status === 'open';
  const rejected = opp.handoffStatus === 'rejected';
  const showClientReview = isManager && open && !rejected && opp.handoffStatus !== 'accepted';
  const canMarkLost = isManager && open && opp.stage !== 'lost';

  async function handleStageChange(stage: string) {
    if (!stage) return;
    setMovingStage(true);
    try {
      const res = await fetch(`/api/opportunities/${opp.id}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error ?? 'Failed to move stage', 'error');
        return;
      }
      showToast(`Moved to ${STAGE_LABELS[stage] ?? stage}`, 'success');
      await refresh();
      onChanged();
    } catch {
      showToast('Failed to move stage', 'error');
    } finally {
      setMovingStage(false);
    }
  }

  async function handleAddNote() {
    if (!note.trim()) return;
    setSubmittingNote(true);
    try {
      const res = await fetch(`/api/opportunities/${opp.id}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: note.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error ?? 'Failed to add note', 'error');
        return;
      }
      setNote('');
      showToast('Note added', 'success');
      await refresh();
    } catch {
      showToast('Failed to add note', 'error');
    } finally {
      setSubmittingNote(false);
    }
  }

  const activities: OpportunityActivity[] = opp.activities ?? [];
  const wonLost = !open && (opp.status === 'won' || opp.status === 'lost' || rejected);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-card-border bg-card-bg"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-card-border px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-text-primary">{opp.title}</h2>
              <OpportunityStageBadge stage={opp.stage} status={opp.status} handoffStatus={opp.handoffStatus} />
            </div>
            <p className="mt-1 text-sm text-text-muted">
              {opp.client.name} · {opp.campaign.name} ·{' '}
              {opp.owner.firstName} {opp.owner.lastName}
            </p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <DetailRow label="Value" value={formatMoney(toNumber(opp.value), opp.currency)} />
            <DetailRow label="Weighted" value={formatMoney(toNumber(opp.value) * (opp.probability / 100), opp.currency)} />
            <DetailRow label="Probability" value={`${opp.probability}%`} />
            <DetailRow label="Expected Close" value={formatDate(opp.expectedCloseDate)} />
            <DetailRow label="Source" value={opp.source?.replace(/_/g, ' ')} />
            <DetailRow label="Age in Stage" value={`${ageInDays(opp.updatedAt)} days`} />
            <DetailRow label="Client Review" value={opp.handoffStatus?.replace(/_/g, ' ')} />
            <DetailRow label="Next Step" value={opp.nextStep} />
          </div>

          {opp.nextStepAt && (
            <p className="mb-4 text-xs text-text-muted">Next step due: {formatDate(opp.nextStepAt)}</p>
          )}

          <div className="mb-4 rounded-lg border border-card-border bg-card-bg/30 p-4">
            <h3 className="mb-2 text-sm font-medium text-text-primary">Qualification Summary</h3>
            <p className="text-sm text-text-muted">{opp.qualificationSummary || 'No qualification summary recorded.'}</p>
          </div>

          <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-card-border bg-card-bg/30 p-4">
              <h3 className="mb-2 text-sm font-medium text-text-primary">Contact</h3>
              <DetailRow label="Name" value={opp.contact ? `${opp.contact.firstName} ${opp.contact.lastName}` : opp.contactName} />
              <DetailRow label="Title" value={opp.contact?.title ?? opp.contactTitle} />
              <DetailRow label="Email" value={opp.contact?.email ?? opp.contactEmail} />
              <DetailRow label="Phone" value={opp.contactPhone} />
            </div>
            <div className="rounded-lg border border-card-border bg-card-bg/30 p-4">
              <h3 className="mb-2 text-sm font-medium text-text-primary">Client Owner</h3>
              <DetailRow label="Name" value={opp.clientOwnerName} />
              <DetailRow label="Email" value={opp.clientOwnerEmail} />
              {opp.meeting ? (
                <div className="mt-2 border-t border-card-border pt-2">
                  <DetailRow label="Meeting" value={opp.meeting.title} />
                  <DetailRow label="Meeting Outcome" value={opp.meeting.outcome?.replace(/_/g, ' ') ?? '—'} />
                </div>
              ) : null}
            </div>
          </div>

          {opp.painPoints && (
            <div className="mb-4 rounded-lg border border-card-border bg-card-bg/30 p-4">
              <h3 className="mb-2 text-sm font-medium text-text-primary">Pain Points</h3>
              <p className="text-sm text-text-muted">{opp.painPoints}</p>
            </div>
          )}

          {wonLost && (
            <div className="mb-4 rounded-lg border border-red-500/25 bg-red-500/5 p-4">
              <h3 className="mb-2 text-sm font-medium text-red-400">Close Details</h3>
              <DetailRow label="Lost Reason" value={opp.lostReason?.replace(/_/g, ' ')} />
              <DetailRow label="Details" value={opp.lostReasonDetails} />
              <DetailRow label="Closed At" value={formatDate(opp.closedAt)} />
            </div>
          )}

          {isManager && (
            <div className="mb-4 rounded-lg border border-card-border bg-card-bg/30 p-4">
              <h3 className="mb-2 text-sm font-medium text-text-primary">Manager Actions</h3>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={open ? opp.stage : ''}
                  onChange={e => handleStageChange(e.target.value)}
                  disabled={!open || movingStage}
                  className="rounded-lg border border-card-border bg-card-bg px-3 py-2 text-sm text-text-primary focus:ring-1 focus:ring-emerald-500/50 outline-none disabled:opacity-50"
                >
                  {!open && <option value="">{opp.status === 'won' ? 'Won' : opp.status === 'lost' ? 'Lost' : 'Closed'}</option>}
                  {STAGES.map(s => (
                    <option key={s} value={s}>{STAGE_LABELS[s] ?? s}</option>
                  ))}
                </select>

                {showClientReview && (
                  <button
                    onClick={() => setShowHandoff(true)}
                    className="rounded-lg border border-sky-500/40 px-3 py-2 text-sm text-sky-400 hover:bg-sky-500/10"
                  >
                    Client Review
                  </button>
                )}
                {canMarkLost && (
                  <button
                    onClick={() => setShowLost(true)}
                    className="rounded-lg border border-red-500/40 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10"
                  >
                    Mark Lost
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="mb-4 rounded-lg border border-card-border bg-card-bg/30 p-4">
            <h3 className="mb-2 text-sm font-medium text-text-primary">Add Note</h3>
            <div className="flex gap-2">
              <input
                value={note}
                onChange={e => setNote(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleAddNote();
                }}
                placeholder="Type a note and press Enter..."
                className="flex-1 bg-card-bg border border-card-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted/50 focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 outline-none"
              />
              <button
                onClick={handleAddNote}
                disabled={submittingNote || !note.trim()}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-card-border bg-card-bg/30 p-4">
            <h3 className="mb-2 text-sm font-medium text-text-primary">Activity History</h3>
            {activities.length === 0 ? (
              <p className="text-sm text-text-muted">No activity yet.</p>
            ) : (
              <ul className="space-y-3">
                {activities.map(a => (
                  <li key={a.id} className="flex items-start gap-3 text-sm">
                    <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
                    <div>
                      <p className="text-text-primary">
                        {ACTIVITY_LABELS[a.type] ?? a.type.replace(/_/g, ' ')}
                        <span className="ml-2 text-xs text-text-muted">
                          {a.user.firstName} {a.user.lastName} · {new Date(a.createdAt).toLocaleString()}
                        </span>
                      </p>
                      {a.description && <p className="text-text-muted">{a.description}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <ClientAcceptanceModal
          open={showHandoff}
          onClose={() => setShowHandoff(false)}
          opportunity={opp}
          onDecision={async () => {
            await refresh();
            onChanged();
          }}
        />
        <LostReasonModal
          open={showLost}
          onClose={() => setShowLost(false)}
          opportunity={opp}
          onSubmit={async () => {
            await refresh();
            onChanged();
          }}
        />
      </div>
    </div>
  );
}
