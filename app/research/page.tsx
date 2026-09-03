'use client';

import { useCallback, useEffect, useState } from 'react';
import { Compass, ExternalLink, Play, Radar, Sparkles } from 'lucide-react';

import AdminTable, { type Column } from '@/components/admin/AdminTable';
import StatusBadge from '@/components/admin/StatusBadge';
import { useToast } from '@/context/ToastContext';
import { readApiError } from '@/lib/api/client';

// Research discovery.
//
// Two tables, one flow: runs on the left of the page, the candidates a selected run found underneath.
// Everything the operator can do here costs either money (executing a pass calls a search provider)
// or creates records (promoting), so both actions are explicit buttons — nothing runs on page load.

interface RunRow {
  id: string;
  kind: string;
  status: string;
  totalQueries: number;
  queryCursor: number;
  discoveredCount: number;
  duplicateCount: number;
  promotedCount: number;
  createdAt: string;
}

interface CandidateRow {
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
}

interface IcpVersionRow {
  id: string;
  versionNumber: number;
  icpProfile: { name: string; isDefault: boolean };
}

const selectClass =
  'bg-card-bg border border-card-border rounded-lg px-2.5 py-1.5 text-text-primary focus:outline-none focus:border-brand-red text-xs';
const buttonClass =
  'inline-flex items-center gap-1.5 px-3 py-1.5 border border-card-border bg-bg-main hover:bg-card-border/30 text-text-secondary text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export default function ResearchPage() {
  const { showToast } = useToast();

  const [runs, setRuns] = useState<RunRow[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [versions, setVersions] = useState<IcpVersionRow[]>([]);

  const [kind, setKind] = useState<'company' | 'contact'>('company');
  const [icpVersionId, setIcpVersionId] = useState('');
  const [queryLimit, setQueryLimit] = useState(50);
  const [creating, setCreating] = useState(false);

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [hideTaken, setHideTaken] = useState(true);
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const [promoting, setPromoting] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    setRunsLoading(true);
    try {
      const res = await fetch('/api/research/runs');
      if (!res.ok) {
        showToast(await readApiError(res, 'Failed to load research runs'), 'error');
        return;
      }
      const data = await res.json();
      setRuns(data.runs ?? []);
    } catch {
      showToast('Network error while loading research runs', 'error');
    } finally {
      setRunsLoading(false);
    }
  }, [showToast]);

  const loadVersions = useCallback(async () => {
    try {
      const res = await fetch('/api/icp/versions');
      if (!res.ok) return;
      const data = await res.json();
      setVersions(data.versions ?? []);
    } catch {
      // A missing ICP list is not fatal — the run form simply has nothing to pick, and creating a run
      // without one fails with a message that says so.
    }
  }, []);

  const loadCandidates = useCallback(
    async (runId: string, hidePromoted: boolean) => {
      setCandidatesLoading(true);
      try {
        const params = new URLSearchParams({ runId, pageSize: '200' });
        if (hidePromoted) params.set('hidePreviouslyPromoted', 'true');
        const res = await fetch(`/api/research/candidates?${params}`);
        if (!res.ok) {
          showToast(await readApiError(res, 'Failed to load candidates'), 'error');
          return;
        }
        const data = await res.json();
        setCandidates(data.items ?? []);
      } catch {
        showToast('Network error while loading candidates', 'error');
      } finally {
        setCandidatesLoading(false);
      }
    },
    [showToast]
  );

  useEffect(() => {
    loadRuns();
    loadVersions();
  }, [loadRuns, loadVersions]);

  useEffect(() => {
    if (selectedRunId) loadCandidates(selectedRunId, hideTaken);
  }, [selectedRunId, hideTaken, loadCandidates]);

  async function createRun() {
    setCreating(true);
    try {
      const res = await fetch('/api/research/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, icpVersionId: icpVersionId || undefined, queryLimit }),
      });
      if (!res.ok) {
        showToast(await readApiError(res, 'Could not create the run'), 'error');
        return;
      }
      const data = await res.json();
      showToast(`Run created with ${data.queries} queries`, 'success');
      await loadRuns();
      setSelectedRunId(data.id);
    } catch {
      showToast('Network error while creating the run', 'error');
    } finally {
      setCreating(false);
    }
  }

  /**
   * Executes passes until the run reports itself finished.
   *
   * The API deliberately returns after a bounded batch of queries so no single request holds a
   * connection for minutes; the loop is where that bound turns back into "run the whole thing".
   */
  async function executeRun(runId: string) {
    setBusyRunId(runId);
    try {
      for (;;) {
        const res = await fetch(`/api/research/runs/${runId}/execute`, { method: 'POST' });
        if (!res.ok) {
          showToast(await readApiError(res, 'Discovery pass failed'), 'error');
          return;
        }
        const pass = await res.json();
        await loadRuns();
        if (selectedRunId === runId) await loadCandidates(runId, hideTaken);
        if (pass.finished) {
          showToast('Run finished', 'success');
          return;
        }
      }
    } catch {
      showToast('Network error during discovery', 'error');
    } finally {
      setBusyRunId(null);
    }
  }

  async function promote(candidateId: string) {
    setPromoting(candidateId);
    try {
      const res = await fetch('/api/research/candidates/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateIds: [candidateId] }),
      });
      if (!res.ok) {
        showToast(await readApiError(res, 'Promotion failed'), 'error');
        return;
      }
      const data = await res.json();
      const outcome = data.results?.[0];
      if (outcome?.status === 'skipped') {
        showToast(`Not promoted: ${outcome.reason}`, 'error');
      } else {
        showToast('Promoted into the lead pool', 'success');
      }
      if (selectedRunId) await loadCandidates(selectedRunId, hideTaken);
      await loadRuns();
    } catch {
      showToast('Network error while promoting', 'error');
    } finally {
      setPromoting(null);
    }
  }

  const runColumns: Column<RunRow>[] = [
    {
      key: 'run',
      label: 'Run',
      render: (run) => (
        <div>
          <div className="font-semibold text-text-primary capitalize">{run.kind} discovery</div>
          <div className="type-meta text-text-muted font-mono">
            {new Date(run.createdAt).toLocaleString()}
          </div>
        </div>
      ),
    },
    { key: 'status', label: 'Status', render: (run) => <StatusBadge status={run.status} /> },
    {
      key: 'progress',
      label: 'Queries',
      render: (run) => `${run.queryCursor} / ${run.totalQueries}`,
      numeric: true,
    },
    { key: 'found', label: 'Found', render: (run) => run.discoveredCount, numeric: true },
    { key: 'dupes', label: 'Duplicates', render: (run) => run.duplicateCount, numeric: true },
    { key: 'promoted', label: 'Promoted', render: (run) => run.promotedCount, numeric: true },
    {
      key: 'actions',
      label: '',
      className: 'text-right',
      render: (run) => (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            className={buttonClass}
            disabled={busyRunId === run.id || run.queryCursor >= run.totalQueries}
            onClick={(event) => {
              event.stopPropagation();
              executeRun(run.id);
            }}
          >
            <Play className="w-3.5 h-3.5" aria-hidden="true" />
            {busyRunId === run.id ? 'Running…' : 'Run'}
          </button>
          <button
            type="button"
            className={buttonClass}
            onClick={(event) => {
              event.stopPropagation();
              setSelectedRunId(run.id);
            }}
          >
            Candidates
          </button>
        </div>
      ),
    },
  ];

  const candidateColumns: Column<CandidateRow>[] = [
    {
      key: 'name',
      label: 'Candidate',
      render: (candidate) => (
        <div>
          <div className="font-semibold text-text-primary">{candidate.name}</div>
          <div className="type-meta text-text-muted">
            {[candidate.title, candidate.companyName, candidate.location].filter(Boolean).join(' · ') || '—'}
          </div>
        </div>
      ),
    },
    {
      key: 'domain',
      label: 'Domain',
      render: (candidate) =>
        candidate.domain ? (
          <a
            href={`https://${candidate.domain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-text-secondary hover:text-text-primary"
          >
            {candidate.domain}
            <ExternalLink className="w-3 h-3" aria-hidden="true" />
          </a>
        ) : (
          '—'
        ),
    },
    {
      key: 'fit',
      label: 'Fit',
      numeric: true,
      // The heuristic score, not an ICP verdict — the ICP assessment is written after promotion, by
      // the same scorer that judges an uploaded lead.
      render: (candidate) => (
        <span className="font-mono" title={candidate.fitReason ?? undefined}>
          {candidate.fitScore ?? '—'}
        </span>
      ),
    },
    { key: 'status', label: 'Status', render: (candidate) => <StatusBadge status={candidate.status} /> },
    {
      key: 'actions',
      label: '',
      className: 'text-right',
      render: (candidate) => (
        <button
          type="button"
          className={buttonClass}
          disabled={candidate.status === 'promoted' || promoting === candidate.id}
          onClick={() => promote(candidate.id)}
        >
          <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
          {candidate.status === 'promoted' ? 'Promoted' : promoting === candidate.id ? 'Promoting…' : 'Promote'}
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="glass-card p-4 space-y-4">
        <h2 className="type-section font-bold text-text-primary flex items-center gap-2">
          <Radar className="w-4 h-4 text-text-muted" aria-hidden="true" />
          New discovery run
        </h2>

        <div className="flex items-end gap-3 flex-wrap">
          <label className="flex flex-col gap-1">
            <span className="type-meta text-text-muted">Looking for</span>
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as 'company' | 'contact')}
              className={selectClass}
            >
              <option value="company">Companies</option>
              <option value="contact">People</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="type-meta text-text-muted">ICP version</span>
            <select
              value={icpVersionId}
              onChange={(event) => setIcpVersionId(event.target.value)}
              className={selectClass}
            >
              <option value="">Select an ICP…</option>
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  {version.icpProfile.name} · v{version.versionNumber}
                  {version.icpProfile.isDefault ? ' (default)' : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="type-meta text-text-muted">Queries</span>
            <select
              value={queryLimit}
              onChange={(event) => setQueryLimit(Number(event.target.value))}
              className={selectClass}
            >
              {[50, 100, 200, 1000].map((limit) => (
                <option key={limit} value={limit}>
                  {limit}
                </option>
              ))}
            </select>
          </label>

          <button type="button" className={buttonClass} onClick={createRun} disabled={creating}>
            <Compass className="w-3.5 h-3.5" aria-hidden="true" />
            {creating ? 'Creating…' : 'Create run'}
          </button>
        </div>

        <p className="type-meta text-text-muted">
          Creating a run only plans the queries. Nothing is searched, and nothing is charged, until you
          press Run.
        </p>
      </div>

      <div className="glass-card p-4 space-y-3">
        <h2 className="type-section font-bold text-text-primary flex items-center gap-2">
          Runs
          <span className="type-meta font-normal text-text-muted font-mono">({runs.length})</span>
        </h2>
        <AdminTable
          columns={runColumns}
          rows={runs}
          rowKey={(run) => run.id}
          isLoading={runsLoading}
          emptyMessage="No discovery runs yet."
          onRowClick={(run) => setSelectedRunId(run.id)}
        />
      </div>

      {selectedRunId && (
        <div className="glass-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="type-section font-bold text-text-primary flex items-center gap-2">
              Candidates
              <span className="type-meta font-normal text-text-muted font-mono">({candidates.length})</span>
            </h2>
            <label className="flex items-center gap-2 type-meta text-text-secondary">
              <input
                type="checkbox"
                checked={hideTaken}
                onChange={(event) => setHideTaken(event.target.checked)}
              />
              Hide companies already taken in an earlier run
            </label>
          </div>
          <AdminTable
            columns={candidateColumns}
            rows={candidates}
            rowKey={(candidate) => candidate.id}
            isLoading={candidatesLoading}
            emptyMessage="Nothing found yet — press Run on this run."
          />
        </div>
      )}
    </div>
  );
}
