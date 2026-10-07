'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CirclePause,
  CirclePlay,
  Clock3,
  Database,
  ExternalLink,
  Loader2,
  Plus,
  Radar,
  Search,
  Sparkles,
} from 'lucide-react';

import ResearchCandidateDrawer from '@/components/research/ResearchCandidateDrawer';
import ResearchPromotionDialog, {
  type ResearchCampaignOption,
} from '@/components/research/ResearchPromotionDialog';
import ResearchRunBuilder from '@/components/research/ResearchRunBuilder';
import StatusBadge from '@/components/admin/StatusBadge';
import { useAppContext } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { readApiError } from '@/lib/api/client';
import {
  canUseResearchRole,
  researchQueryOptionsForRole,
} from '@/lib/research/access';

type RunRow = {
  id: string;
  kind: string;
  status: string;
  totalQueries: number;
  /** The budget asked for; null on runs created before it was recorded. */
  queryBudget?: number | null;
  queryCursor: number;
  discoveredCount: number;
  duplicateCount: number;
  promotedCount: number;
  createdAt: string;
  errorMessage?: string | null;
  /** Pause was pressed; the worker stops after the batch in flight. */
  pauseRequested?: boolean;
  /** `running`, but nobody has written to the run for minutes — the worker died. */
  stalled?: boolean;
};

/** How often the page re-reads a run the worker is executing. The page watches; it never drives. */
const RUN_POLL_MS = 4000;

type CandidateRow = {
  id: string;
  name: string;
  domain: string | null;
  companyName: string | null;
  title: string | null;
  location: string | null;
  fitScore: number | null;
  fitReason: string | null;
  status: string;
  previouslyPromoted: boolean;
};

type IcpVersionRow = {
  id: string;
  versionNumber: number;
  icpProfile: { name: string; isDefault: boolean };
};

type CandidateTab = 'review' | 'pipeline' | 'dismissed' | 'all';
type ProviderStatus = { ready: boolean; providers: string[] };

const actionButton =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-card-border bg-bg-main px-3 type-meta font-semibold text-text-secondary transition-colors hover:bg-card-border/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red disabled:cursor-not-allowed disabled:opacity-50';
const primaryButton =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-red px-4 type-meta font-semibold text-white transition-colors hover:bg-brand-red/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-card-bg disabled:cursor-not-allowed disabled:opacity-50';

export default function ResearchWorkspace() {
  const router = useRouter();
  const { currentRole, isSessionLoading } = useAppContext();
  const { showToast } = useToast();
  const canAccessResearch = canUseResearchRole(currentRole, 'read');
  const queryOptions = researchQueryOptionsForRole(currentRole);

  const [runs, setRuns] = useState<RunRow[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [versions, setVersions] = useState<IcpVersionRow[]>([]);
  const [campaigns, setCampaigns] = useState<ResearchCampaignOption[]>([]);
  const [promotionIds, setPromotionIds] = useState<string[]>([]);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>({ ready: false, providers: [] });
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [candidateCounts, setCandidateCounts] = useState<Record<string, number>>({});
  // Counted by the server over the whole run (lib/research/readModel.ts), so the tabs add up.
  const [serverTabCounts, setServerTabCounts] = useState<Record<CandidateTab, number> | null>(null);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidateTab, setCandidateTab] = useState<CandidateTab>('review');
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set());
  const [builderOpen, setBuilderOpen] = useState(false);
  const [drawerCandidateId, setDrawerCandidateId] = useState<string | null>(null);
  // A Start / Pause request in flight, so the button cannot be pressed twice. The run itself is
  // executed by the `research` worker; nothing on this page drives it any more.
  const [controlBusyRunId, setControlBusyRunId] = useState<string | null>(null);
  const [promoting, setPromoting] = useState(false);
  // Last status seen per run, so a poll that finds a run settled can say so once.
  const lastStatuses = useRef<Map<string, string>>(new Map());

  const loadRuns = useCallback(async (options: { quiet?: boolean } = {}): Promise<RunRow[]> => {
    if (!options.quiet) setRunsLoading(true);
    try {
      const response = await fetch('/api/research/runs');
      if (!response.ok) {
        showToast(await readApiError(response, 'Failed to load research runs'), 'error');
        return [];
      }
      const data = await response.json();
      const nextRuns: RunRow[] = data.runs ?? [];
      setRuns(nextRuns);
      setProviderStatus(data.providerStatus ?? { ready: false, providers: [] });
      setSelectedRunId((current) =>
        current && nextRuns.some((run) => run.id === current) ? current : nextRuns[0]?.id ?? null,
      );

      // Announce transitions out of `running` that happened while the page was watching. A run that
      // settled while the SDR was elsewhere is simply shown in its new state on the next visit.
      for (const run of nextRuns) {
        const previous = lastStatuses.current.get(run.id);
        if (previous === 'running' && run.status !== 'running') {
          // A run that found nothing carries the reason; say it instead of a green "finished".
          if (run.status === 'succeeded') showToast(run.errorMessage || 'Research run finished.', run.errorMessage ? 'info' : 'success');
          else if (run.status === 'paused') showToast('Research run paused between batches.', 'info');
          else if (run.status === 'failed') showToast(run.errorMessage || 'Research run failed.', 'error');
        }
        lastStatuses.current.set(run.id, run.status);
      }
      return nextRuns;
    } catch {
      if (!options.quiet) showToast('Network error while loading research runs', 'error');
      return [];
    } finally {
      if (!options.quiet) setRunsLoading(false);
    }
  }, [showToast]);

  const loadVersions = useCallback(async () => {
    try {
      const response = await fetch('/api/icp/versions');
      if (!response.ok) return;
      const data = await response.json();
      setVersions(data.versions ?? []);
    } catch {
      showToast('Published ICPs could not be loaded. Try refreshing the page.', 'error');
    }
  }, [showToast]);

  const loadCampaigns = useCallback(async () => {
    try {
      const response = await fetch('/api/research/campaigns');
      if (!response.ok) {
        showToast(await readApiError(response, 'Failed to load campaigns'), 'error');
        return;
      }
      const data = await response.json();
      setCampaigns(data.campaigns ?? []);
    } catch {
      showToast('Network error while loading campaigns', 'error');
    }
  }, [showToast]);

  const loadCandidates = useCallback(
    async (runId: string, options: { quiet?: boolean } = {}) => {
      if (!options.quiet) setCandidatesLoading(true);
      try {
        const params = new URLSearchParams({ runId, pageSize: '200' });
        const response = await fetch(`/api/research/candidates?${params}`);
        if (!response.ok) {
          showToast(await readApiError(response, 'Failed to load candidates'), 'error');
          return;
        }
        const data = await response.json();
        const items: CandidateRow[] = data.items ?? [];
        setCandidates(items);
        setCandidateCounts(data.counts ?? {});
        setServerTabCounts(data.tabCounts ?? null);
        // A background refresh must not throw away what the SDR has ticked; it only drops rows that
        // are gone. A deliberate reload starts clean, as it always did.
        setSelectedCandidates((current) =>
          options.quiet
            ? new Set(items.filter((item) => current.has(item.id)).map((item) => item.id))
            : new Set(),
        );
      } catch {
        if (!options.quiet) showToast('Network error while loading candidates', 'error');
      } finally {
        if (!options.quiet) setCandidatesLoading(false);
      }
    },
    [showToast],
  );

  useEffect(() => {
    if (!isSessionLoading && !canAccessResearch) router.replace('/');
  }, [canAccessResearch, isSessionLoading, router]);

  useEffect(() => {
    if (!isSessionLoading && canAccessResearch) {
      void loadRuns();
      void loadVersions();
      void loadCampaigns();
    }
  }, [canAccessResearch, isSessionLoading, loadCampaigns, loadRuns, loadVersions]);

  useEffect(() => {
    if (canAccessResearch && selectedRunId) void loadCandidates(selectedRunId);
  }, [canAccessResearch, loadCandidates, selectedRunId]);

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? null,
    [runs, selectedRunId],
  );

  // Watch while anything is running. Stops by itself once every run has settled.
  const anyRunActive = runs.some((run) => run.status === 'running' && !run.stalled);
  const selectedRunActive = selectedRun?.status === 'running' && !selectedRun.stalled;
  useEffect(() => {
    if (!anyRunActive) return;
    const timer = window.setInterval(() => {
      void loadRuns({ quiet: true });
      if (selectedRunActive && selectedRunId) void loadCandidates(selectedRunId, { quiet: true });
    }, RUN_POLL_MS);
    return () => window.clearInterval(timer);
  }, [anyRunActive, loadCandidates, loadRuns, selectedRunActive, selectedRunId]);

  const visibleCandidates = useMemo(
    () =>
      candidates.filter((candidate) => {
        if (candidateTab === 'all') return true;
        if (candidateTab === 'pipeline') {
          return candidate.status === 'promoted' || candidate.previouslyPromoted;
        }
        if (candidateTab === 'dismissed') return candidate.status === 'dismissed';
        return candidate.status === 'discovered';
      }),
    [candidateTab, candidates],
  );
  const visibleCandidateIds = useMemo(() => visibleCandidates.map((candidate) => candidate.id), [visibleCandidates]);

  const tabCounts: Record<CandidateTab, number> = serverTabCounts ?? {
    review: 0,
    pipeline: 0,
    dismissed: candidateCounts.dismissed ?? 0,
    all: Object.values(candidateCounts).reduce((sum, count) => sum + count, 0),
  };

  async function startRun(runId: string) {
    setControlBusyRunId(runId);
    try {
      const response = await fetch(`/api/research/runs/${runId}/execute`, { method: 'POST' });
      if (!response.ok) {
        showToast(await readApiError(response, 'Could not start the research run'), 'error');
        return;
      }
      const data = await response.json();
      // Recorded before the reload, so the poll that later sees the run settle announces it.
      lastStatuses.current.set(runId, 'running');
      showToast(
        data.alreadyRunning
          ? 'This run is already running.'
          : 'Research is running in the background — you can leave this page.',
        'info',
      );
      await loadRuns({ quiet: true });
    } catch {
      showToast('Network error while starting the research run', 'error');
    } finally {
      setControlBusyRunId(null);
    }
  }

  async function pauseRun(runId: string) {
    setControlBusyRunId(runId);
    try {
      const response = await fetch(`/api/research/runs/${runId}/pause`, { method: 'POST' });
      if (!response.ok) {
        showToast(await readApiError(response, 'Could not pause the research run'), 'error');
        return;
      }
      await loadRuns({ quiet: true });
    } catch {
      showToast('Network error while pausing the research run', 'error');
    } finally {
      setControlBusyRunId(null);
    }
  }

  function requestPromotion(ids: string[]) {
    if (ids.length > 0) setPromotionIds(ids);
  }

  async function confirmPromotion(campaignId: string) {
    if (promotionIds.length === 0) return;
    setPromoting(true);
    try {
      const response = await fetch('/api/research/candidates/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateIds: promotionIds, campaignId }),
      });
      if (!response.ok) {
        showToast(await readApiError(response, 'Promotion failed'), 'error');
        return;
      }
      const data = await response.json();
      const promotedCount = (data.results ?? []).filter(
        (result: { status?: string }) => result.status === 'promoted',
      ).length;
      const existingCount = (data.results ?? []).filter(
        (result: { status?: string }) => result.status === 'already_in_campaign',
      ).length;
      const suppressedCount = (data.results ?? []).filter(
        (result: { status?: string }) => result.status === 'suppressed',
      ).length;
      // Everything else the server reported (skipped, not found): the parts add up to the selection.
      const otherCount = Math.max(promotionIds.length - promotedCount - existingCount - suppressedCount, 0);
      showToast(
        `${promotedCount} added, ${existingCount} already in campaign, ${suppressedCount} blocked by suppression` +
          (otherCount > 0 ? `, ${otherCount} skipped.` : '.'),
        suppressedCount > 0 && promotedCount === 0 ? 'error' : 'success',
      );
      setPromotionIds([]);
      if (selectedRunId) await Promise.all([loadCandidates(selectedRunId), loadRuns()]);
    } catch {
      showToast('Network error while promoting candidates', 'error');
    } finally {
      setPromoting(false);
    }
  }

  function toggleCandidate(id: string) {
    setSelectedCandidates((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleVisibleCandidates() {
    const eligible = visibleCandidates
      .filter((candidate) => candidate.status !== 'dismissed' && candidate.status !== 'duplicate')
      .map((candidate) => candidate.id);
    const allSelected = eligible.length > 0 && eligible.every((id) => selectedCandidates.has(id));
    setSelectedCandidates(allSelected ? new Set() : new Set(eligible));
  }

  if (isSessionLoading || !canAccessResearch) return null;

  return (
    <>
      <main className="space-y-4">
        <header className="flex items-center justify-between gap-4 rounded-2xl border border-card-border bg-card-bg p-5">
          <div>
            <div className="flex items-center gap-2 text-brand-red">
              <Radar className="h-5 w-5" aria-hidden="true" />
              <span className="type-meta font-bold uppercase tracking-wider">Prospecting</span>
            </div>
            <h1 className="mt-1 type-title font-bold text-text-primary">Research workspace</h1>
            <p className="mt-1 max-w-2xl type-body text-text-muted">
              Find net-new companies and contacts, inspect the evidence, then promote only the records worth keeping.
            </p>
          </div>
          <button type="button" className={primaryButton} onClick={() => setBuilderOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            New run
          </button>
        </header>

        <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-4">
          <div className="min-w-0 space-y-4">
            <section className="rounded-2xl border border-card-border bg-card-bg p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="type-section font-bold capitalize text-text-primary">
                      {selectedRun ? `${selectedRun.kind} discovery` : 'Select a research run'}
                    </h2>
                    {selectedRun && <StatusBadge status={selectedRun.status} />}
                  </div>
                  <p className="mt-1 type-meta text-text-muted">
                    {selectedRun
                      ? new Date(selectedRun.createdAt).toLocaleString()
                      : 'Choose a run from the history rail to inspect its progress.'}
                  </p>
                </div>
                <span
                  className={`inline-flex min-h-8 items-center gap-2 rounded-full border px-3 type-meta font-semibold ${
                    providerStatus.ready
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                      : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                  }`}
                >
                  {providerStatus.ready ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4" aria-hidden="true" />}
                  {providerStatus.ready
                    ? `Provider ready  /  ${providerStatus.providers.join(', ')}`
                    : 'Provider missing'}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-4 border-y border-card-border py-3">
                <CockpitMetric label="Candidates" value={String(selectedRun?.discoveredCount ?? 0)} icon={Search} />
                {/* The Pipeline tab's own number: promoted here or already taken in an earlier run. */}
                <CockpitMetric label="In pipeline" value={String(serverTabCounts?.pipeline ?? selectedRun?.promotedCount ?? 0)} icon={Database} />
                <CockpitMetric
                  label="Progress"
                  value={selectedRun ? `${selectedRun.queryCursor}/${selectedRun.totalQueries}` : '0/0'}
                  icon={Clock3}
                />
                <CockpitMetric label="Same company twice" value={String(selectedRun?.duplicateCount ?? 0)} icon={CheckCircle2} />
              </div>
              {selectedRun?.queryBudget != null && selectedRun.totalQueries < selectedRun.queryBudget && (
                <p className="mt-2 type-meta text-text-muted">
                  {selectedRun.totalQueries} searches planned of a {selectedRun.queryBudget}-query budget: the ICP&apos;s
                  industries, keywords and locations only combine into {selectedRun.totalQueries} distinct searches. Add
                  more of them to use more of the budget.
                </p>
              )}

              {selectedRun && (selectedRun.queryCursor < selectedRun.totalQueries || selectedRun.status === 'running') && (
                <div className="mt-4 border-t border-card-border pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="type-meta font-semibold text-text-primary">
                        {runStateLabel(selectedRun)}
                      </p>
                      <p className="mt-1 type-meta text-text-muted">
                        {selectedRunActive
                          ? 'Runs on the server — leave this page and come back; progress keeps going.'
                          : 'Progress is saved after every query. Pause or resume without starting over.'}
                      </p>
                    </div>
                    {selectedRunActive ? (
                      <button
                        type="button"
                        className={actionButton}
                        disabled={selectedRun.pauseRequested || controlBusyRunId === selectedRun.id}
                        onClick={() => pauseRun(selectedRun.id)}
                      >
                        <CirclePause className="h-4 w-4" aria-hidden="true" />
                        {selectedRun.pauseRequested ? 'Pausing after this batch…' : 'Pause after this batch'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={primaryButton}
                        disabled={!providerStatus.ready || controlBusyRunId === selectedRun.id}
                        onClick={() => startRun(selectedRun.id)}
                      >
                        <CirclePlay className="h-4 w-4" aria-hidden="true" />
                        {selectedRun.status === 'queued' ? 'Run research' : 'Resume run'}
                      </button>
                    )}
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-card-border" aria-label="Research run progress">
                    <div
                      className="h-full rounded-full bg-brand-red transition-[width] duration-200 motion-reduce:transition-none"
                      style={{
                        width: `${selectedRun.totalQueries === 0 ? 0 : Math.round((selectedRun.queryCursor / selectedRun.totalQueries) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {selectedRun?.errorMessage &&
                (selectedRun.status === 'failed' ? (
                  <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 type-meta text-red-300" role="alert">
                    {selectedRun.errorMessage}
                  </p>
                ) : (
                  // Finished, nothing found: a note about the result, not an error.
                  <p className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 type-meta text-amber-300" role="status">
                    {selectedRun.errorMessage}
                  </p>
                ))}
            </section>

            <section className="overflow-hidden rounded-2xl border border-card-border bg-card-bg">
              <div className="flex items-center justify-between gap-3 border-b border-card-border p-4">
                <div className="flex max-w-full gap-1 overflow-x-auto" role="tablist" aria-label="Candidate pipeline views">
                  {([
                    ['review', 'Needs review'],
                    ['pipeline', 'Pipeline'],
                    ['dismissed', 'Dismissed'],
                    ['all', 'All'],
                  ] as Array<[CandidateTab, string]>).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={candidateTab === id}
                      onClick={() => setCandidateTab(id)}
                      className={`min-h-11 whitespace-nowrap rounded-lg px-3 type-meta font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red ${
                        candidateTab === id ? 'bg-brand-red text-white' : 'text-text-muted hover:bg-bg-main hover:text-text-primary'
                      }`}
                    >
                      {label} <span className="font-mono">({tabCounts[id]})</span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className={primaryButton}
                  disabled={selectedCandidates.size === 0 || promoting}
                  onClick={() => requestPromotion([...selectedCandidates])}
                >
                  {promoting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
                  Promote selected ({selectedCandidates.size})
                </button>
              </div>

              <CandidateTable
                rows={visibleCandidates}
                loading={candidatesLoading}
                selected={selectedCandidates}
                onToggle={toggleCandidate}
                onToggleAll={toggleVisibleCandidates}
                onOpen={setDrawerCandidateId}
                onPromote={(id) => requestPromotion([id])}
                promoting={promoting}
              />
            </section>
          </div>

          <aside className="sticky top-4 max-h-[calc(100dvh-2rem)] self-start overflow-y-auto rounded-2xl border border-card-border bg-card-bg p-3">
            <div className="flex items-center justify-between gap-2 px-2 py-2">
              <div>
                <h2 className="type-section font-bold text-text-primary">Run history</h2>
                <p className="type-meta text-text-muted">{runs.length} recent runs</p>
              </div>
              {runsLoading && <Loader2 className="h-4 w-4 animate-spin text-text-muted" aria-label="Loading runs" />}
            </div>
            <div className="mt-2 space-y-2">
              {runs.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  aria-pressed={selectedRunId === run.id}
                  onClick={() => setSelectedRunId(run.id)}
                  className={`flex min-h-16 w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red ${
                    selectedRunId === run.id
                      ? 'border-brand-red bg-brand-red/10'
                      : 'border-card-border bg-bg-main hover:border-text-muted'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate type-meta font-bold capitalize text-text-primary">
                      {run.kind} discovery
                    </span>
                    <span className="mt-1 block type-meta font-mono text-text-muted">
                      {run.queryCursor}/{run.totalQueries}  /  {new Date(run.createdAt).toLocaleDateString()}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
                </button>
              ))}
              {!runsLoading && runs.length === 0 && (
                <div className="rounded-xl border border-dashed border-card-border p-5 text-center">
                  <Radar className="mx-auto h-6 w-6 text-text-muted" aria-hidden="true" />
                  <p className="mt-2 type-meta text-text-muted">
                    No runs yet. Create one to start prospecting.
                  </p>
                </div>
              )}
            </div>
          </aside>
        </div>
      </main>

      <ResearchRunBuilder
        isOpen={builderOpen}
        versions={versions}
        queryOptions={queryOptions}
        onClose={() => setBuilderOpen(false)}
        showToast={showToast}
        onCreated={async (run) => {
          showToast(`Run created with ${run.queries} planned queries.`, 'success');
          await loadRuns();
          setSelectedRunId(run.id);
        }}
      />
      <ResearchCandidateDrawer
        candidateId={drawerCandidateId}
        siblingIds={visibleCandidateIds}
        onNavigate={setDrawerCandidateId}
        onClose={() => setDrawerCandidateId(null)}
      />
      <ResearchPromotionDialog
        isOpen={promotionIds.length > 0}
        campaigns={campaigns}
        candidateCount={promotionIds.length}
        busy={promoting}
        onClose={() => setPromotionIds([])}
        onConfirm={confirmPromotion}
      />
    </>
  );
}

function CockpitMetric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Search;
}) {
  return (
    <div className="border-l border-card-border px-3 first:border-l-0">
      <div className="flex items-center gap-2 type-meta text-text-muted">
        <Icon className="h-4 w-4" aria-hidden="true" />
        {label}
      </div>
      <p className="mt-2 font-mono type-section font-bold tabular-nums text-text-primary">
        {value}
      </p>
    </div>
  );
}

function CandidateTable({
  rows,
  loading,
  selected,
  onToggle,
  onToggleAll,
  onOpen,
  onPromote,
  promoting,
}: {
  rows: CandidateRow[];
  loading: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onOpen: (id: string) => void;
  onPromote: (id: string) => void;
  promoting: boolean;
}) {
  if (loading) {
    return (
      <div
        className="flex min-h-64 items-center justify-center gap-2 type-meta text-text-muted"
        role="status"
      >
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        Loading candidates.
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center px-5 text-center">
        <Search className="h-7 w-7 text-text-muted" aria-hidden="true" />
        <p className="mt-3 type-body font-semibold text-text-primary">Nothing in this view</p>
        <p className="mt-1 type-meta text-text-muted">
          Run research or choose another pipeline tab.
        </p>
      </div>
    );
  }

  const eligible = rows.filter(
    (row) => row.status !== 'dismissed' && row.status !== 'duplicate',
  );
  const allSelected =
    eligible.length > 0 && eligible.every((row) => selected.has(row.id));

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[780px] border-collapse">
        <thead className="bg-bg-main">
          <tr className="border-b border-card-border">
            <th className="w-12 px-3 py-3 text-left">
              <input
                type="checkbox"
                aria-label="Select all visible candidates"
                checked={allSelected}
                onChange={onToggleAll}
              />
            </th>
            <th className="px-3 py-3 text-left type-meta font-semibold text-text-muted">Candidate</th>
            <th className="px-3 py-3 text-left type-meta font-semibold text-text-muted">Fit signal</th>
            <th className="px-3 py-3 text-left type-meta font-semibold text-text-muted">Why it surfaced</th>
            <th className="px-3 py-3 text-left type-meta font-semibold text-text-muted">Pipeline</th>
            <th className="px-3 py-3 text-right type-meta font-semibold text-text-muted">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((candidate) => {
            const eligibleForPromotion =
              candidate.status !== 'dismissed' && candidate.status !== 'duplicate';
            return (
              <tr
                key={candidate.id}
                className="border-b border-card-border/60 align-middle transition-colors hover:bg-bg-main/60"
              >
                <td className="px-3 py-3">
                  <input
                    type="checkbox"
                    aria-label={`Select ${candidate.name}`}
                    checked={selected.has(candidate.id)}
                    disabled={!eligibleForPromotion}
                    onChange={() => onToggle(candidate.id)}
                  />
                </td>
                <td className="px-3 py-3">
                  <button
                    type="button"
                    className="min-h-11 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
                    onClick={() => onOpen(candidate.id)}
                  >
                    <span className="block type-body font-semibold text-text-primary">
                      {candidate.name}
                    </span>
                    <span className="mt-1 block type-meta text-text-muted">
                      {[candidate.title, candidate.companyName, candidate.location]
                        .filter(Boolean)
                        .join('  /  ') || 'No profile details'}
                    </span>
                    {candidate.domain && (
                      <span className="mt-1 inline-flex items-center gap-1 type-meta text-text-secondary">
                        {candidate.domain}
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </span>
                    )}
                  </button>
                </td>
                <td className="px-3 py-3">
                  <FitRing score={candidate.fitScore} />
                </td>
                <td className="max-w-xs px-3 py-3 type-meta leading-relaxed text-text-secondary">
                  {candidate.fitReason || "Matched this run's search terms."}
                </td>
                <td className="px-3 py-3">
                  <StatusBadge
                    status={candidate.status === 'promoted' ? 'promoted' : candidate.previouslyPromoted ? 'already_known' : candidate.status}
                  />
                  {candidate.previouslyPromoted && (
                    <span className="mt-1 block type-meta text-text-muted">Already in prospect library</span>
                  )}
                </td>
                <td className="px-3 py-3 text-right">
                  <button
                    type="button"
                    className={actionButton}
                    disabled={!eligibleForPromotion || promoting}
                    onClick={() => onPromote(candidate.id)}
                  >
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                    {eligibleForPromotion ? 'Choose campaign' : 'Unavailable'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FitRing({ score }: { score: number | null }) {
  const bounded = Math.max(0, Math.min(score ?? 0, 100));
  const circumference = 2 * Math.PI * 16;
  return (
    <div
      className="relative h-11 w-11 text-brand-red"
      aria-label={score == null ? 'No fit signal' : `Fit signal ${score} out of 100`}
    >
      <svg viewBox="0 0 40 40" className="h-11 w-11 -rotate-90" aria-hidden="true">
        <circle
          cx="20"
          cy="20"
          r="16"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.15"
          strokeWidth="4"
        />
        <circle
          cx="20"
          cy="20"
          r="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - bounded / 100)}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono type-meta font-bold text-text-primary">
        {score ?? '-'}
      </span>
    </div>
  );
}

/** What the run's own row says it is doing — never what this page last asked it to do. */
function runStateLabel(run: RunRow): string {
  if (run.status === 'running') {
    if (run.stalled) return 'Run needs attention — the worker stopped. Resume to continue.';
    if (run.pauseRequested) return 'Pausing after the batch in flight';
    return 'Running in the background';
  }
  if (run.status === 'paused') return 'Paused safely between batches';
  if (run.status === 'failed') return 'Run needs attention';
  if (run.status === 'queued') return 'Ready to start';
  return 'Ready to continue';
}
