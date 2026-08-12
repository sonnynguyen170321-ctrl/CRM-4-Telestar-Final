import React from 'react';
import { GitPullRequestArrow, Lightbulb, ShieldCheck } from 'lucide-react';
import StatusBadge from '@/components/operating/StatusBadge';
import EmptyState from '@/components/operating/EmptyState';
import type { Insight } from './types';

/**
 * What the system noticed, and what it would like permission to change.
 *
 * Deliberately framed as a proposal queue rather than "learning". The AI observes outcomes and
 * suggests a playbook edit; a manager approves it and the change lands as a new playbook
 * *version*. Nothing on this panel has been applied, and the approval requirement is stated on
 * every row rather than in a footnote.
 */
export default function PlaybookInsights({ insights }: { insights: Insight[] }) {
  const [decisions, setDecisions] = React.useState<Record<string, 'approved' | 'rejected'>>({});

  const handleDecision = (id: string, action: 'approved' | 'rejected') => {
    setDecisions((prev) => ({ ...prev, [id]: action }));
  };

  return (
    <section className="rounded-xl border border-card-border bg-card-bg overflow-hidden" data-testid="insights">
      <div className="px-5 py-3.5 border-b border-card-border">
        <h2 className="type-section flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-brand-gold-text" aria-hidden="true" />
          Playbook insight
        </h2>
        <p className="type-meta text-text-muted mt-1 prose-measure">
          Observed outcomes and the changes they suggest. AI proposes; a manager decides.
        </p>
      </div>

      {insights.length === 0 ? (
        <EmptyState
          title="No proposals yet."
          description="Proposals appear once enough outreach has produced comparable outcomes."
          icon={Lightbulb}
        />
      ) : (
        <ul className="divide-y divide-card-border">
          {insights.map((i) => {
            const key = `${i.leadId}-${i.observation}`;
            const currentDecision = decisions[key];
            const isPending = !currentDecision && i.status === 'pending';

            return (
              <li key={key} className="px-5 py-4 text-left">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge label={i.outcome} tone="done" />
                  <span className="type-meta text-text-secondary">
                    {i.prospectName}{i.company ? ` · ${i.company}` : ''}
                  </span>
                </div>

                <p className="type-body text-text-primary mt-3 prose-measure">{i.observation}</p>

                {i.supportingEvidence.length > 0 && (
                  <div className="mt-3">
                    <span className="type-micro text-text-muted">Evidence</span>
                    <ul className="mt-1 space-y-1">
                      {i.supportingEvidence.map((e, n) => (
                        <li key={n} className="type-meta text-text-secondary flex gap-2 prose-measure">
                          <span className="text-text-muted shrink-0" aria-hidden="true">—</span>
                          {e}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-3 flex gap-2.5">
                  <GitPullRequestArrow className="w-4 h-4 text-text-muted shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <span className="type-micro text-text-muted">Suggested change</span>
                    <p className="type-body text-text-primary mt-0.5 prose-measure">{i.suggestedChange}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 mt-4 pt-3 border-t border-card-border">
                  <span className="inline-flex items-center gap-1.5 type-meta text-text-secondary">
                    <ShieldCheck className="w-3.5 h-3.5 text-text-muted" aria-hidden="true" />
                    {currentDecision ? (
                      <span className={`font-bold capitalize ${currentDecision === 'approved' ? 'text-emerald-600' : 'text-red-600'}`}>
                        {currentDecision} by manager
                      </span>
                    ) : (
                      <span>{i.status} · {i.approvalRequired} approval required</span>
                    )}
                  </span>

                  {isPending && (
                    <div className="flex items-center gap-2 ml-auto">
                      <button
                        type="button"
                        onClick={() => handleDecision(key, 'rejected')}
                        className="px-2.5 py-1 text-xs font-semibold border border-card-border rounded-lg text-text-secondary hover:bg-card-border/30 transition-colors"
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDecision(key, 'approved')}
                        className="px-3 py-1 text-xs font-semibold bg-brand-red hover:bg-brand-red-hover text-white rounded-lg transition-colors shadow-sm"
                      >
                        Approve Proposal
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
