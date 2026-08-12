import React from 'react';
import {
  ArrowUpRight, FileSearch, Loader2, Mail, MessageSquare, Sparkles, Target,
} from 'lucide-react';
import OperatingStateBadge from '@/components/operating/OperatingStateBadge';
import PriorityIndicator from '@/components/operating/PriorityIndicator';
import StatusBadge from '@/components/operating/StatusBadge';
import EmptyState from '@/components/operating/EmptyState';
import { isAiOwned } from '@/components/operating/states';
import HandoffBanner from './HandoffBanner';
import AiStatusCard from './AiStatusCard';
import ReengagementPanel from './ReengagementPanel';
import AssistPanel from './AssistPanel';
import type { AssistResult, HandoffPackage } from './types';
import { clockTime, relativeTime } from './types';

/**
 * The intelligence workspace for one prospect.
 *
 * Left: why this person, what was found, what AI is doing. Right: the conversation. The split is
 * the argument — evidence on one side, the actual words exchanged on the other — and the identity
 * header above both answers "who, how urgent, who owns them, what happens next" without the
 * reader having to assemble it from four unrelated cards.
 */

const EVIDENCE_KIND: Record<string, string> = {
  signal: 'Company signal',
  pain: 'Pain hypothesis',
  hook: 'Personalisation hook',
};

function NextActionLine({ pkg }: { pkg: HandoffPackage }) {
  const state = pkg.prospect.operatingState;
  const at = pkg.sequence?.nextActionAt ?? null;

  const text =
    state === 'human_attention'
      ? 'SDR response required'
      : state === 'reengagement_eligible'
      ? 'Awaiting an explicit handback to AI'
      : state === 'human_managed'
      ? 'Yours to drive — AI schedules nothing here'
      : at
      ? `Follow-up scheduled ${new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${clockTime(at)}`
      : 'Nothing scheduled';

  return (
    <div className="mt-3 pt-3 border-t border-card-border">
      <span className="type-micro text-text-muted">Next action</span>
      <p className="type-body text-text-primary mt-0.5" data-testid="next-action">{text}</p>
    </div>
  );
}

export default function ProspectWorkspace({
  pkg, ownerName, assist, busy, onAssist, onHandback, handbackMessage,
}: {
  pkg: HandoffPackage;
  ownerName: string | null;
  assist: AssistResult | null;
  busy: string | null;
  onAssist: (kind: string) => void;
  onHandback: () => void;
  handbackMessage: string | null;
}) {
  const state = pkg.prospect.operatingState;
  const canHandBack = state === 'reengagement_eligible' || state === 'waiting_for_prospect';

  return (
    <div className="space-y-4" data-testid="handoff-package">
      {/* ─── identity ─── */}
      <section className="rounded-xl border border-card-border bg-card-bg px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="type-section">{pkg.prospect.name}</h2>
            <p className="type-meta text-text-secondary mt-0.5">
              {[pkg.prospect.title, pkg.prospect.company, pkg.account?.industry].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
          <PriorityIndicator priority={pkg.prospect.priority} className="shrink-0 pt-1" />
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-3">
          <OperatingStateBadge state={state} size="md" testId="operating-state" />
          {/* While AI owns the prospect the state badge already says so, and a second blue "AI
              Managed" chip beside it read as a duplicate. What is still worth knowing is who it
              hands back to — that is a different fact, so it gets neutral treatment. */}
          {ownerName &&
            (isAiOwned(state) ? (
              <StatusBadge label={`Hands back to ${ownerName}`} tone="neutral" />
            ) : (
              <StatusBadge label={ownerName} tone="human" />
            ))}
          {pkg.campaign && <StatusBadge label={pkg.campaign.name} tone="neutral" />}
          {pkg.sequence && (
            <StatusBadge
              label={`${pkg.sequence.name}${pkg.sequence.currentStep !== null ? ` · step ${pkg.sequence.currentStep}` : ''}`}
              tone="neutral"
            />
          )}
        </div>

        <NextActionLine pkg={pkg} />
      </section>

      {/* ─── the handoff moment ─── */}
      <HandoffBanner pkg={pkg} ownerName={ownerName} />

      {/* ─── re-engagement, when the prospect has gone quiet ─── */}
      {canHandBack && (
        <ReengagementPanel
          pkg={pkg}
          busy={busy === 'handback'}
          disabled={busy !== null}
          onHandback={onHandback}
        />
      )}

      {handbackMessage && (
        <p
          className="type-meta text-text-primary rounded-lg border border-card-border bg-gray-50 px-4 py-3"
          data-testid="handback-result"
          role="status"
        >
          {handbackMessage}
        </p>
      )}

      {/* ─── intelligence | conversation ─── */}
      <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4 items-start">
        <div className="space-y-4">
          {/* why this prospect */}
          <section className="rounded-xl border border-card-border bg-card-bg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-card-border">
              <h3 className="type-subsection flex items-center gap-2">
                <FileSearch className="w-4 h-4 text-text-secondary" aria-hidden="true" />
                Why this prospect
              </h3>
              <p className="type-micro text-text-muted mt-0.5">
                {pkg.whyContacted.length > 0
                  ? `${pkg.whyContacted.length} verified evidence ${pkg.whyContacted.length === 1 ? 'item' : 'items'} — outreach was grounded in these.`
                  : 'Research evidence grounds every outbound touch.'}
              </p>
            </div>

            {pkg.whyContacted.length === 0 ? (
              <EmptyState
                title="No evidence collected yet."
                description="Research evidence will appear here once prospect research runs."
                icon={FileSearch}
              />
            ) : (
              <ul className="divide-y divide-card-border" data-testid="why-contacted">
                {pkg.whyContacted.map((e, i) => (
                  <li key={`${e.kind}-${i}`} className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <StatusBadge label={EVIDENCE_KIND[e.kind] ?? e.kind} tone="neutral" />
                      {e.observedAt && (
                        <span className="type-micro text-text-muted">Captured {relativeTime(e.observedAt)}</span>
                      )}
                    </div>
                    <p className="type-body text-text-primary mt-2 prose-measure">{e.summary}</p>
                    {e.sourceUrl && (
                      <a
                        href={e.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 mt-2 type-micro text-blue-700 hover:underline focus-ring rounded"
                      >
                        Source <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* what a human should be trying to achieve */}
          <section className="rounded-xl border border-card-border bg-card-bg px-5 py-4">
            <h3 className="type-subsection flex items-center gap-2">
              <Target className="w-4 h-4 text-text-secondary" aria-hidden="true" />
              Recommended objective
            </h3>
            <p className="type-body text-text-primary mt-2 prose-measure" data-testid="recommended-objective">
              {pkg.recommendedObjective}
            </p>
            {pkg.suggestedCallQuestions.length > 0 && (
              <>
                <p className="type-micro text-text-muted mt-4">Questions worth asking</p>
                <ul className="mt-1.5 space-y-1.5">
                  {pkg.suggestedCallQuestions.map((q) => (
                    <li key={q} className="type-meta text-text-secondary flex gap-2 prose-measure">
                      <span className="text-text-muted shrink-0" aria-hidden="true">—</span>
                      {q}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p className="type-micro text-text-muted mt-4">
              Computed by the CRM from the reply classification — not by a model.
            </p>
          </section>

          <AiStatusCard pkg={pkg} />
        </div>

        {/* ─── conversation ─── */}
        <section className="rounded-xl border border-card-border bg-card-bg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-card-border">
            <h3 className="type-subsection flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-text-secondary" aria-hidden="true" />
              Conversation
            </h3>
          </div>

          {pkg.thread.length === 0 ? (
            <EmptyState
              title="Nothing has been sent yet."
              description="Outbound touches and replies appear here as the sequence runs."
              icon={Mail}
            />
          ) : (
            <ol className="divide-y divide-card-border max-h-[520px] overflow-y-auto">
              {pkg.thread.map((m, i) => (
                <li key={`${m.at}-${i}`} className="px-5 py-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`type-micro ${m.direction === 'in' ? 'text-brand-red' : 'text-blue-700'}`}
                    >
                      {m.direction === 'in' ? `${pkg.prospect.name.split(' ')[0]} replied` : 'Telestar sent'}
                    </span>
                    <span className="type-micro text-text-muted font-mono">{relativeTime(m.at)}</span>
                  </div>
                  {m.subject && <p className="type-meta text-text-primary mt-1">{m.subject}</p>}
                  {m.body && (
                    <p className="type-meta text-text-secondary mt-1 whitespace-pre-wrap line-clamp-6">{m.body}</p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {/* ─── AI assistance ─── */}
      <AssistPanel assist={assist} busy={busy} onAssist={onAssist} />
    </div>
  );
}

/** Shown while the package is in flight, at roughly the geometry of the real thing. */
export function WorkspaceLoading() {
  return (
    <div className="flex items-center gap-2 type-meta text-text-muted px-5 py-8">
      <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
      Loading prospect intelligence…
    </div>
  );
}

/** Shown before anything is selected. */
export function WorkspacePlaceholder() {
  return (
    <div className="rounded-xl border border-card-border bg-card-bg">
      <EmptyState
        title="Select a prospect."
        description="You will see why AI contacted them, what evidence it found, what happened, and what to do next."
        icon={Sparkles}
      />
    </div>
  );
}
