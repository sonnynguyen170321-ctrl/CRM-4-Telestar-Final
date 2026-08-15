'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Clock, RefreshCw, ShieldAlert, Stethoscope } from 'lucide-react';
import SectionHeader from '@/components/operating/SectionHeader';
import EmptyState from '@/components/operating/EmptyState';
import { SkeletonMetricRow, SkeletonPanel } from '@/components/operating/Skeleton';
import OperatingLoop from './OperatingLoop';
import RoleSurface from './RoleSurface';
import ProspectQueue from './ProspectQueue';
import ProspectWorkspace, { WorkspaceLoading, WorkspacePlaceholder } from './ProspectWorkspace';
import PlaybookProposals from './PlaybookProposals';
import DemoReplyControls from './DemoReplyControls';
import type { AssistResult, ConsoleData, HandoffPackage } from './types';
import { relativeTime } from './types';

/**
 * The AI Command Center — the operating model on one screen (Phase 9, presentation pass).
 *
 * Three questions, top to bottom: what is AI doing, who needs a human, and what happened. The
 * loop stepper and the queue are two views of the same buckets; the workspace on the right is the
 * one prospect currently in focus.
 *
 * Everything rendered comes from `/api/ai/console`, `/api/prospects/[id]/handoff` and
 * `/api/prospects/[id]/assist`. No client-side import may reach a server AI module, or the
 * browser bundle pulls `async_hooks` and the build fails (ARCHITECTURE §10).
 */

export default function AiConsoleView() {
  const [data, setData] = useState<ConsoleData | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pkg, setPkg] = useState<HandoffPackage | null>(null);
  const [assist, setAssist] = useState<AssistResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/ai/console');
      if (!res.ok) throw new Error(`console ${res.status}`);
      setData(await res.json());
    } catch {
      // Never a stack trace or a status code on a presentation surface.
      setError('Could not load the operating board.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /**
   * Which package load is the current one.
   *
   * Two can overlap: a handback reloads the prospect it just acted on, and the user is free to
   * click a prospect while that is in flight. Without a token the slower response wins the panel
   * and the earlier `finally` clears the spinner for a load that is still running — which is
   * exactly how the workspace ends up stuck on "Loading prospect intelligence…" while its data
   * has already arrived.
   */
  const packageRequest = useRef(0);

  const openProspect = useCallback(async (leadId: string) => {
    const token = ++packageRequest.current;
    setSelected(leadId);
    setPkg(null);
    setAssist(null);
    setResultMsg(null);
    setBusy('package');
    try {
      const res = await fetch(`/api/prospects/${leadId}/handoff`);
      const body = res.ok ? await res.json() : null;
      // A superseded load neither paints nor clears: whatever replaced it owns both.
      if (token !== packageRequest.current) return;
      if (body) setPkg(body);
      else setError('Could not load prospect intelligence.');
    } catch {
      if (token === packageRequest.current) setError('Could not load prospect intelligence.');
    } finally {
      if (token === packageRequest.current) setBusy(null);
    }
  }, []);

  const runAssist = useCallback(async (kind: string) => {
    if (!selected) return;
    setBusy(kind);
    setAssist(null);
    try {
      const res = await fetch(`/api/prospects/${selected}/assist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      });
      setAssist(await res.json());
    } catch {
      setError('AI assistance could not be reached.');
    } finally {
      setBusy(null);
    }
  }, [selected]);

  const handback = useCallback(async () => {
    if (!selected) return;
    setBusy('handback');
    setResultMsg(null);
    try {
      const res = await fetch(`/api/prospects/${selected}/handback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'SDR resumed AI follow-up' }),
      });
      const body = await res.json();
      await load();
      await openProspect(selected);
      // Set *after* the reload: `openProspect` clears this line, so writing it first wipes it.
      // The wording is the literal outcome — a work order exists, nothing has been sent.
      setResultMsg(
        res.ok
          ? `AI follow-up requested. Re-engagement work order ${String(body.workOrderId).slice(0, 8)} opened, awaiting an approved plan. No outreach has started.`
          : `Could not hand back: ${body.error ?? 'the request was refused'}.`
      );
    } catch {
      setResultMsg('Could not hand back. Nothing was changed.');
    } finally {
      setBusy(null);
    }
  }, [selected, load, openProspect]);

  const onDemoReply = useCallback(async (message: string) => {
    if (!selected) return;
    await load();
    await openProspect(selected);
    setResultMsg(message);
  }, [selected, load, openProspect]);

  /**
   * Operating-state enum → count, for the loop stepper. Tallied from the prospects the buckets
   * already carry, deduplicated by lead, so a prospect who also appears under `draft_available`
   * is not counted twice.
   */
  const stateCounts = useMemo(() => {
    const seen = new Set<string>();
    const out: Record<string, number> = {};
    for (const b of data?.buckets ?? []) {
      for (const p of b.prospects) {
        if (seen.has(p.leadId)) continue;
        seen.add(p.leadId);
        out[p.operatingState] = (out[p.operatingState] ?? 0) + 1;
      }
    }
    return out;
  }, [data]);

  const ownerName = useMemo(() => {
    if (!selected) return null;
    for (const b of data?.buckets ?? []) {
      const hit = b.prospects.find((p) => p.leadId === selected);
      if (hit?.ownerName) return hit.ownerName;
    }
    return null;
  }, [data, selected]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1>AI Command Center</h1>
          <p className="type-meta text-text-muted prose-measure mt-1.5">
            How AI and your sales team are operating together. Every handoff, approval and stop is
            recorded here.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selected && (
            <a
              href={`/api/demo/diagnostics?leadId=${selected}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-card-border type-meta text-text-secondary transition-colors hover:bg-gray-50 hover:text-text-primary focus-ring"
              title="Raw operating state for the selected prospect — the presenter's escape hatch."
              data-testid="diagnostics-link"
            >
              <Stethoscope className="w-4 h-4" aria-hidden="true" /> Diagnostics
            </a>
          )}
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-card-border type-meta text-text-secondary transition-colors hover:bg-gray-50 hover:text-text-primary focus-ring"
            data-testid="console-refresh"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" /> Refresh
          </button>
        </div>
      </header>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 type-meta text-red-700" role="alert">
          {error}{' '}
          <button type="button" onClick={() => void load()} className="underline focus-ring rounded">
            Retry
          </button>
        </p>
      )}

      {/* ─── your responsibility, as exceptions ───
          Role-aware and server-decided: the surface is built from the session's role and the
          CRM's own pod scoping, so an SDR reads their conversations and a Director reads
          outcomes and cost. There is no client-side role switch to get another one's view. */}
      {isLoading && <SkeletonMetricRow count={5} />}
      {!isLoading && data?.surface && <RoleSurface surface={data.surface} />}

      {/* ─── the loop ─── */}
      {!isLoading && data && (
        <section className="rounded-xl border border-card-border bg-card-bg px-5 py-4" aria-label="Operating loop">
          <SectionHeader
            title="The operating loop"
            description="AI runs the left of this line. A reply moves a prospect across it, and only a human moves them back."
            level={2}
          />
          <div className="mt-4">
            <OperatingLoop
              stateCounts={stateCounts}
              activeState={activeTab === 'all' ? null : activeTab}
              onSelect={(key) => setActiveTab(key)}
            />
          </div>
        </section>
      )}

      {data && data.totals.blocked > 0 && (
        <p className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-3 type-meta text-red-800">
          <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
          {data.totals.blocked} work {data.totals.blocked === 1 ? 'order has' : 'orders have'} stopped and need a look.
        </p>
      )}

      {/* ─── queue | workspace ─── */}
      <div className="grid grid-cols-[minmax(320px,360px)_minmax(0,1fr)] gap-5 items-start">
        {/* Sticky: the workspace is far taller than the queue, and a presenter scrolled to the
            assistance panel should still be one click from the other prospect rather than having
            to scroll back up to switch. `top-20` clears the fixed 64px header. */}
        <div className="sticky top-20">
        <ProspectQueue
          buckets={data?.buckets ?? null}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          selectedLeadId={selected}
          onSelect={(id) => void openProspect(id)}
          isLoading={isLoading}
        />
        </div>

        <div className="space-y-5 min-w-0">
          {!selected && !isLoading && <WorkspacePlaceholder />}
          {busy === 'package' && <WorkspaceLoading />}

          {pkg && (
            <>
              <ProspectWorkspace
                pkg={pkg}
                ownerName={ownerName}
                assist={assist}
                busy={busy}
                onAssist={(kind) => void runAssist(kind)}
                onHandback={() => void handback()}
                handbackMessage={resultMsg}
              />
              <DemoReplyControls
                leadId={pkg.leadId}
                disabled={busy !== null}
                busy={busy}
                onBusyChange={setBusy}
                onDelivered={onDemoReply}
              />
            </>
          )}

          {data && <PlaybookProposals />}

          {/* ─── what happened ─── */}
          {isLoading && <SkeletonPanel lines={4} />}
          {!isLoading && data && (
            <section className="rounded-xl border border-card-border bg-card-bg overflow-hidden" data-testid="timeline">
              <div className="px-5 py-3.5 border-b border-card-border">
                <h2 className="type-section">Recent movement</h2>
              </div>
              {data.timeline.length === 0 ? (
                <EmptyState
                  title="Nothing has moved yet."
                  description="Handoffs, sends, replies and state changes appear here as they happen."
                  icon={Clock}
                />
              ) : (
                <ul className="divide-y divide-card-border">
                  {data.timeline.slice(0, 12).map((t, i) => (
                    <li key={`${t.at}-${i}`} className="flex gap-4 px-5 py-2.5">
                      <span className="type-micro font-mono text-text-muted w-24 shrink-0 pt-0.5">
                        {relativeTime(t.at)}
                      </span>
                      <span className="type-meta text-text-secondary prose-measure">{t.description}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
