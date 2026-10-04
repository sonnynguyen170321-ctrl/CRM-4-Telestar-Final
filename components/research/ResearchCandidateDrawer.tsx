'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileSearch,
  History,
  Loader2,
  Search,
  X,
} from 'lucide-react';

import { readApiError } from '@/lib/api/client';
import EvidenceCard from '@/components/research/EvidenceCard';
import { DrawerNavButtons, useDrawerNavigation } from '@/components/shared/DrawerNavigation';

type CandidateDetail = {
  candidate: {
    id: string;
    name: string;
    domain: string | null;
    linkedinUrl: string | null;
    title: string | null;
    companyName: string | null;
    location: string | null;
    fitScore: number | null;
    fitReason: string | null;
    fitSource: string | null;
    status: string;
    matchHintsJson: unknown;
    sourceJson: unknown;
  };
  evidence: Array<{
    id: string;
    sourceKind: string;
    provider: string | null;
    sourceUrl: string | null;
    sourceTitle: string | null;
    sourceSnippet: string | null;
    query: string | null;
    confidence: number | null;
    observedAt: string;
  }>;
  attempts: Array<{
    id: string;
    stage: string;
    provider: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    /** True when the attempt belongs to the run that surfaced this candidate, not to the candidate itself. */
    runScoped: boolean;
  }>;
  /** The run's searches per provider, counted over all of them. */
  runAttemptTally?: Array<{ provider: string; ok: number; failed: number }>;
  history: {
    timesSeen: number;
    firstSeenAt: string;
    lastSeenAt: string;
    promotedAccountId: string | null;
  } | null;
};

type Props = {
  candidateId: string | null;
  onClose: () => void;
  /** The candidates the table is showing, in its order; with `onNavigate`, previous / next. */
  siblingIds?: readonly string[];
  onNavigate?: (candidateId: string) => void;
};

export default function ResearchCandidateDrawer({ candidateId, onClose, siblingIds, onNavigate }: Props) {
  const [detail, setDetail] = useState<CandidateDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigation = useDrawerNavigation({ currentId: candidateId, siblingIds, onNavigate });
  // Stepping quickly fires several loads; only the one for the candidate on screen may land, or a
  // slow answer for the previous candidate would show its evidence under this one's name.
  const latestRequest = useRef<string | null>(null);

  const load = useCallback(async () => {
    // Closing the drawer retires whatever was in flight, so it cannot land on a reopened drawer.
    latestRequest.current = candidateId;
    if (!candidateId) return;
    const isCurrent = () => latestRequest.current === candidateId;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/research/candidates/${candidateId}`);
      if (!isCurrent()) return;
      if (!response.ok) {
        const message = await readApiError(response, 'Could not load candidate evidence');
        if (isCurrent()) setError(message);
        return;
      }
      const body = await response.json();
      if (isCurrent()) setDetail(body);
    } catch {
      if (isCurrent()) setError('Network error while loading candidate evidence');
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [candidateId]);

  useEffect(() => {
    setDetail(null);
    void load();
  }, [load]);

  useEffect(() => {
    if (!candidateId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [candidateId, onClose]);

  if (!candidateId) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Close candidate evidence"
        className="absolute inset-0"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="candidate-evidence-title"
        className="relative z-10 flex h-full w-full max-w-2xl flex-col border-l border-card-border bg-card-bg shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-card-border px-5 py-4">
          <div className="min-w-0">
            <p className="type-meta font-semibold uppercase tracking-wider text-brand-red">
              Research evidence
            </p>
            <h2 id="candidate-evidence-title" className="truncate type-section font-bold text-text-primary">
              {detail?.candidate.name ?? 'Candidate detail'}
            </h2>
            {detail?.candidate.companyName && (
              <p className="type-meta text-text-muted">{detail.candidate.companyName}</p>
            )}
          </div>
          <div className="flex items-center gap-1">
          {navigation && <DrawerNavButtons navigation={navigation} noun="candidate" />}
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-main hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          {loading && (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-text-muted" role="status">
              <Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" />
              <span className="type-meta">Loading evidence.</span>
            </div>
          )}

          {!loading && error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4" role="alert">
              <div className="flex items-start gap-3 text-red-300">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                <div>
                  <p className="type-body font-semibold">Evidence could not be loaded</p>
                  <p className="mt-1 type-meta">{error}</p>
                </div>
              </div>
              <button
                type="button"
                className="mt-4 min-h-11 rounded-lg border border-red-400/40 px-4 type-meta font-semibold text-red-200"
                onClick={load}
              >
                Try again
              </button>
            </div>
          )}

          {!loading && detail && (
            <div className="space-y-5">
              <section className="grid grid-cols-4 border-y border-card-border py-3">
                <Metric label="Fit signal" value={detail.candidate.fitScore == null ? '-' : String(detail.candidate.fitScore)} />
                <Metric label="Source" value={detail.candidate.fitSource ?? 'Heuristic'} />
                <Metric label="Seen" value={String(detail.history?.timesSeen ?? 1)} />
                <Metric label="Status" value={detail.candidate.status.replaceAll('_', ' ')} />
              </section>

              <section className="rounded-xl border border-card-border bg-bg-main p-4">
                <h3 className="flex items-center gap-2 type-meta font-bold text-text-primary">
                  <Search className="h-4 w-4" aria-hidden="true" />
                  Why it surfaced
                </h3>
                <p className="mt-2 type-body leading-relaxed text-text-secondary">
                  {detail.candidate.fitReason || "The source matched terms from this run's query plan."}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {toLabels(detail.candidate.matchHintsJson).map((hint) => (
                    <span key={hint} className="rounded-full border border-card-border bg-card-bg px-2.5 py-1 type-meta text-text-muted">
                      {hint}
                    </span>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="mb-3 flex items-center gap-2 type-meta font-bold text-text-primary">
                  <FileSearch className="h-4 w-4" aria-hidden="true" />
                  Evidence ledger ({detail.evidence.length})
                </h3>
                {detail.evidence.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-card-border p-6 text-center type-meta text-text-muted">
                    No source evidence was recorded for this candidate.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {detail.evidence.map((item) => (
                      <EvidenceCard key={item.id} item={item} />
                    ))}
                  </div>
                )}
              </section>

              <ProvenanceSection detail={detail} />
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-l border-card-border px-3 first:border-l-0">
      <p className="type-meta text-text-muted">{label}</p>
      <p className="mt-1 truncate type-body font-bold capitalize text-text-primary">{value}</p>
    </div>
  );
}

function toLabels(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}


/**
 * How this candidate was found — replacing a flat "Provider attempts (19)" list.
 *
 * That list mixed two different things: lookups made for this candidate, and every search the whole
 * run made before this candidate existed. Nineteen rows of `exa / discovery / ok` under one person
 * read as nineteen searches about them, and told the SDR nothing they could act on. Now: the search
 * that surfaced it, the lookups that are genuinely this candidate's, and the run's search activity
 * folded into one tally that is there for diagnosing a run, not for judging a lead.
 */
function ProvenanceSection({ detail }: { detail: CandidateDetail }) {
  const own = detail.attempts.filter((attempt) => !attempt.runScoped);
  // Counted by the server over every search the run made (lib/research/readModel.ts).
  const tally = detail.runAttemptTally ?? [];
  const runTotal = tally.reduce((sum, row) => sum + row.ok + row.failed, 0);
  const queries = Array.from(
    new Set(detail.evidence.map((item) => item.query).filter((query): query is string => Boolean(query))),
  );


  return (
    <section>
      <h3 className="mb-3 flex items-center gap-2 type-meta font-bold text-text-primary">
        <History className="h-4 w-4" aria-hidden="true" />
        How it was found
      </h3>

      {queries.length > 0 ? (
        <ul className="space-y-1.5">
          {queries.map((query) => (
            <li key={query} className="rounded-lg border border-card-border px-3 py-2 type-meta font-mono text-text-secondary">
              {query}
            </li>
          ))}
        </ul>
      ) : (
        <p className="type-meta text-text-muted">The search that surfaced this candidate was not recorded.</p>
      )}

      {own.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="type-meta font-semibold text-text-secondary">Lookups for this candidate ({own.length})</p>
          {own.map((attempt) => (
            <div key={attempt.id} className="flex items-center justify-between gap-3 rounded-lg border border-card-border px-3 py-2">
              <span className="type-meta text-text-secondary">
                {attempt.provider}  /  {attempt.stage}
              </span>
              <span className="inline-flex items-center gap-1.5 type-meta font-semibold text-text-muted">
                {attempt.status === 'ok' ? (
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5 text-red-300" aria-hidden="true" />
                )}
                {attempt.status}
              </span>
            </div>
          ))}
        </div>
      )}

      {runTotal > 0 && (
        <details className="mt-3 rounded-lg border border-card-border px-3 py-2">
          <summary className="cursor-pointer type-meta text-text-muted">
            Provider attempts for the whole run ({runTotal}) — for diagnosing the run, not this lead
          </summary>
          <ul className="mt-2 space-y-1">
            {tally.map((counts) => (
              <li key={counts.provider} className="flex items-center justify-between type-meta text-text-secondary">
                <span>{counts.provider}</span>
                <span className="font-mono text-text-muted">
                  {counts.ok} ok{counts.failed > 0 ? `  ·  ${counts.failed} failed` : ''}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
