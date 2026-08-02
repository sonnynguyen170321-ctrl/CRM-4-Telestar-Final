'use client';

import { formatMoney, toNumber, type Opportunity } from './types';
import OpportunityStageBadge from './OpportunityStageBadge';

const COLUMNS: { stage: string; label: string; accent: string }[] = [
  { stage: 'pending_client_review', label: 'Pending Client Review', accent: 'bg-amber-400' },
  { stage: 'accepted_by_client', label: 'Accepted by Client', accent: 'bg-sky-400' },
  { stage: 'discovery', label: 'Discovery', accent: 'bg-cyan-400' },
  { stage: 'proposal', label: 'Proposal', accent: 'bg-violet-400' },
  { stage: 'negotiation', label: 'Negotiation', accent: 'bg-orange-400' },
  { stage: 'won', label: 'Won', accent: 'bg-emerald-400' },
  { stage: 'lost', label: 'Lost', accent: 'bg-red-400' },
  { stage: 'nurture', label: 'Nurture', accent: 'bg-pink-400' },
];

export default function OpportunityBoard({
  opportunities,
  onSelect,
}: {
  opportunities: Opportunity[];
  onSelect: (opp: Opportunity) => void;
}) {
  const byStage = (stage: string) =>
    opportunities.filter(o => o.stage === stage && o.status === 'open');

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
      {COLUMNS.map(col => {
        const items = byStage(col.stage);
        return (
          <div key={col.stage} className="flex flex-col rounded-xl border border-card-border bg-card-bg/60">
            <div className="flex items-center gap-2 border-b border-card-border px-3 py-2.5">
              <span className={`h-2 w-2 rounded-full ${col.accent}`} />
              <span className="text-xs font-medium uppercase tracking-wide text-muted">{col.label}</span>
              <span className="ml-auto rounded-full bg-surface px-2 py-0.5 text-xs text-muted">
                {items.length}
              </span>
            </div>
            <div className="flex flex-col gap-2 p-2">
              {items.length === 0 ? (
                <p className="px-2 py-4 text-center text-xs text-muted/60">No opportunities</p>
              ) : (
                items.map(opp => (
                  <button
                    key={opp.id}
                    onClick={() => onSelect(opp)}
                    className="rounded-lg border border-card-border bg-card-bg p-3 text-left transition-colors hover:border-brand-orange/40 hover:bg-surface/50"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-white leading-snug">{opp.title}</p>
                      <OpportunityStageBadge stage={opp.stage} status={opp.status} handoffStatus={opp.handoffStatus} />
                    </div>
                    <p className="mt-1 text-xs text-muted">{opp.client.name}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-sm text-white">
                        {formatMoney(toNumber(opp.value), opp.currency)}
                      </span>
                      <span className="text-xs text-muted">
                        {opp.owner.firstName} {opp.owner.lastName[0]}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
