'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, Bot, CheckCircle2, Clock, FileText, Loader2,
  MessageSquare, RefreshCw, Send, ShieldCheck, UserCheck,
} from 'lucide-react';

/**
 * The operating model, on one screen (Phase 9).
 *
 * Deliberately not a redesign of the CRM: three columns — the states a prospect can be in, the
 * prospect currently selected, and what the AI did or is waiting on. Everything it renders comes
 * from `/api/ai/console`, `/api/prospects/[id]/handoff` and `/api/prospects/[id]/assist`.
 *
 * Client-side only imports here: nothing in this file may reach a server AI module, or the browser
 * bundle pulls `async_hooks` and the build fails (ARCHITECTURE §10).
 */

interface ConsoleProspect {
  leadId: string;
  name: string;
  company: string | null;
  title: string | null;
  operatingState: string;
  stage: string;
  priority: string;
  ownerName: string | null;
  replyClass: string | null;
  replyLabel: string | null;
  classLabel: string | null;
  replyAt: string | null;
  lastTouchAt: string | null;
}

interface Bucket {
  key: string;
  label: string;
  hint: string;
  count: number;
  prospects: ConsoleProspect[];
}

interface WorkItem { id: string; label: string; detail: string; leadId: string | null; status: string; at: string }

interface Insight {
  leadId: string;
  prospectName: string;
  company: string | null;
  outcome: string;
  supportingEvidence: string[];
  observation: string;
  suggestedChange: string;
  status: string;
  approvalRequired: string;
}

interface ConsoleData {
  scope: string;
  buckets: Bucket[];
  approvals: WorkItem[];
  blocked: WorkItem[];
  timeline: Array<{ at: string; leadId: string | null; type: string; description: string }>;
  totals: { aiManaged: number; humanOwned: number; needsAttention: number; blocked: number };
  insights: Insight[];
}

interface HandoffPackage {
  leadId: string;
  prospect: { name: string; title: string | null; email: string; company: string | null; operatingState: string; stage: string; priority: string };
  account: { name: string; industry: string | null } | null;
  campaign: { name: string; clientName: string | null } | null;
  sequence: { name: string; currentStep: number | null; status: string | null } | null;
  whyContacted: Array<{ kind: string; summary: string; sourceUrl: string | null; confidence: number }>;
  thread: Array<{ direction: string; at: string; subject: string | null; body: string | null }>;
  latestReply: { at: string; body: string | null; classLabel: string | null; kindLabel: string | null; confidence: number | null; source: string | null } | null;
  handoffAt: string | null;
  workOrder: { id: string; type: string; status: string } | null;
  recommendedObjective: string;
  suggestedCallQuestions: string[];
}

interface AssistResult {
  available: boolean;
  kind: string;
  label: string;
  text: string | null;
  reason?: string;
  recommendedObjective: string;
  suggestedCallQuestions: string[];
}

const ASSIST_ACTIONS: Array<{ kind: string; label: string }> = [
  { kind: 'summary', label: 'Summarise thread' },
  { kind: 'reply_draft', label: 'Draft reply' },
  { kind: 'objection_help', label: 'Objection help' },
  { kind: 'meeting_prep', label: 'Meeting prep' },
];

const STATE_STYLE: Record<string, string> = {
  needs_attention: 'border-l-brand-red',
  ai_managed: 'border-l-blue-500',
  human_managed: 'border-l-emerald-600',
  waiting: 'border-l-amber-500',
  reengagement_eligible: 'border-l-brand-orange',
  draft_available: 'border-l-indigo-500',
  approval_pending: 'border-l-amber-600',
  blocked: 'border-l-red-700',
};

function relative(iso: string | null): string {
  if (!iso) return '—';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

export default function AiConsoleView() {
  const [data, setData] = useState<ConsoleData | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pkg, setPkg] = useState<HandoffPackage | null>(null);
  const [assist, setAssist] = useState<AssistResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handbackMsg, setHandbackMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/ai/console');
      if (!res.ok) throw new Error(`console ${res.status}`);
      setData(await res.json());
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openProspect = useCallback(async (leadId: string) => {
    setSelected(leadId);
    setPkg(null);
    setAssist(null);
    setHandbackMsg(null);
    setBusy('package');
    try {
      const res = await fetch(`/api/prospects/${leadId}/handoff`);
      if (res.ok) setPkg(await res.json());
      else setError(`handoff ${res.status}`);
    } finally {
      setBusy(null);
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
    } finally {
      setBusy(null);
    }
  }, [selected]);

  const handback = useCallback(async () => {
    if (!selected) return;
    setBusy('handback');
    setHandbackMsg(null);
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
      setHandbackMsg(
        res.ok
          ? `Re-engagement work order ${String(body.workOrderId).slice(0, 8)} opened — awaiting an approved plan. No outreach has started.`
          : `Could not hand back: ${body.error ?? res.status}`
      );
    } finally {
      setBusy(null);
    }
  }, [selected, load, openProspect]);

  return (
    <div className="p-6 space-y-5">
      <header className="flex items-start justify-between gap-6">
        <div>
          <h1>Telestar AI Console</h1>
          <p className="type-meta text-text-muted prose-measure mt-1">
            AI does the repetitive prospecting work. SDRs do the selling. Every handoff, approval
            and stop is recorded here.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="flex items-center gap-2 px-3 py-2 border border-card-border rounded-md type-meta hover:bg-hover-bg transition-colors"
          data-testid="console-refresh"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </header>

      {error && (
        <div className="border border-card-border rounded-md p-3 type-meta text-brand-red">{error}</div>
      )}

      {data && (
        <section className="grid grid-cols-4 gap-3" aria-label="Operating model totals">
          {[
            { label: 'AI managed', value: data.totals.aiManaged, icon: Bot },
            { label: 'Human owned', value: data.totals.humanOwned, icon: UserCheck },
            { label: 'Needs attention', value: data.totals.needsAttention, icon: AlertTriangle },
            { label: 'Blocked', value: data.totals.blocked, icon: ShieldCheck },
          ].map((t) => (
            <div key={t.label} className="border border-card-border bg-card-bg rounded-md px-4 py-3">
              <div className="flex items-center gap-2 type-meta text-text-muted">
                <t.icon className="w-4 h-4" /> {t.label}
              </div>
              <div className="font-mono text-2xl mt-1" data-testid={`total-${t.label.replace(/\s+/g, '-').toLowerCase()}`}>
                {t.value}
              </div>
            </div>
          ))}
        </section>
      )}

      <div className="grid grid-cols-[380px_1fr] gap-5 items-start">
        {/* ---------------- states ---------------- */}
        <div className="space-y-3" data-testid="console-buckets">
          {data?.buckets.map((bucket) => (
            <section key={bucket.key} className={`border border-card-border bg-card-bg rounded-md border-l-4 ${STATE_STYLE[bucket.key] ?? 'border-l-card-border'}`}>
              <div className="px-4 py-3 border-b border-card-border">
                <div className="flex items-center justify-between">
                  <h2 className="type-subsection">{bucket.label}</h2>
                  <span className="font-mono type-meta" data-testid={`bucket-${bucket.key}-count`}>{bucket.count}</span>
                </div>
                <p className="type-micro text-text-muted mt-0.5">{bucket.hint}</p>
              </div>
              {bucket.prospects.length > 0 && (
                <ul className="divide-y divide-card-border">
                  {bucket.prospects.slice(0, 6).map((p) => (
                    <li key={`${bucket.key}-${p.leadId}`}>
                      <button
                        onClick={() => void openProspect(p.leadId)}
                        className={`w-full text-left px-4 py-2.5 hover:bg-hover-bg transition-colors ${selected === p.leadId ? 'bg-hover-bg' : ''}`}
                        data-testid={`prospect-${p.leadId}`}
                      >
                        <div className="type-body">{p.name}</div>
                        <div className="type-micro text-text-muted">
                          {p.company ?? '—'}
                          {p.replyLabel ? ` · ${p.replyLabel}` : ''}
                          {p.lastTouchAt ? ` · touched ${relative(p.lastTouchAt)}` : ''}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {bucket.key === 'approval_pending' && data.approvals.length > 0 && (
                <ul className="divide-y divide-card-border">
                  {data.approvals.map((a) => (
                    <li key={a.id} className="px-4 py-2.5">
                      <div className="type-body">{a.label}</div>
                      <div className="type-micro text-text-muted">{a.detail}</div>
                    </li>
                  ))}
                </ul>
              )}
              {bucket.key === 'blocked' && data.blocked.length > 0 && (
                <ul className="divide-y divide-card-border">
                  {data.blocked.map((b) => (
                    <li key={b.id} className="px-4 py-2.5">
                      <div className="type-body">{b.label}</div>
                      <div className="type-micro text-text-muted">{b.detail}</div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        {/* ---------------- selected prospect ---------------- */}
        <div className="space-y-4">
          {!selected && (
            <div className="border border-card-border bg-card-bg rounded-md p-8 text-center type-meta text-text-muted">
              Select a prospect to see why AI contacted them, what happened, and what to do next.
            </div>
          )}

          {busy === 'package' && (
            <div className="flex items-center gap-2 type-meta text-text-muted">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading handoff package…
            </div>
          )}

          {pkg && (
            <section className="border border-card-border bg-card-bg rounded-md" data-testid="handoff-package">
              <div className="px-5 py-4 border-b border-card-border">
                <h2 className="type-section">{pkg.prospect.name}</h2>
                <p className="type-meta text-text-muted">
                  {[pkg.prospect.title, pkg.prospect.company, pkg.account?.industry].filter(Boolean).join(' · ')}
                </p>
                <div className="flex flex-wrap gap-2 mt-2 type-micro">
                  <span className="px-2 py-0.5 border border-card-border rounded" data-testid="operating-state">
                    {pkg.prospect.operatingState}
                  </span>
                  {pkg.campaign && <span className="px-2 py-0.5 border border-card-border rounded">{pkg.campaign.name}</span>}
                  {pkg.sequence && (
                    <span className="px-2 py-0.5 border border-card-border rounded">
                      {pkg.sequence.name} · step {pkg.sequence.currentStep ?? '—'} · {pkg.sequence.status ?? '—'}
                    </span>
                  )}
                  {pkg.workOrder && (
                    <span className="px-2 py-0.5 border border-card-border rounded font-mono">
                      {pkg.workOrder.type}/{pkg.workOrder.status}
                    </span>
                  )}
                </div>
              </div>

              {pkg.latestReply && (
                <div className="px-5 py-4 border-b border-card-border" data-testid="latest-reply">
                  <h3 className="type-subsection flex items-center gap-2">
                    <MessageSquare className="w-4 h-4" /> Latest reply
                    {pkg.latestReply.kindLabel && (
                      <span className="type-micro px-2 py-0.5 border border-card-border rounded" data-testid="reply-kind">
                        {pkg.latestReply.kindLabel}
                      </span>
                    )}
                    {pkg.latestReply.confidence !== null && (
                      <span className="type-micro font-mono text-text-muted">
                        {(pkg.latestReply.confidence * 100).toFixed(0)}% · {pkg.latestReply.source}
                      </span>
                    )}
                  </h3>
                  <p className="type-body mt-2 prose-measure whitespace-pre-wrap">{pkg.latestReply.body}</p>
                </div>
              )}

              <div className="px-5 py-4 border-b border-card-border">
                <h3 className="type-subsection">Why AI contacted them</h3>
                {pkg.whyContacted.length === 0 ? (
                  <p className="type-meta text-text-muted mt-1">No research evidence on file.</p>
                ) : (
                  <ul className="mt-2 space-y-1.5" data-testid="why-contacted">
                    {pkg.whyContacted.map((e, i) => (
                      <li key={i} className="type-body flex gap-2">
                        <span className="type-micro font-mono text-text-muted mt-0.5 w-12 shrink-0">{e.kind}</span>
                        <span className="prose-measure">{e.summary}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="px-5 py-4 border-b border-card-border">
                <h3 className="type-subsection">Recommended objective</h3>
                <p className="type-body mt-1 prose-measure" data-testid="recommended-objective">{pkg.recommendedObjective}</p>
                <ul className="mt-2 space-y-1">
                  {pkg.suggestedCallQuestions.map((q) => (
                    <li key={q} className="type-meta text-text-muted">— {q}</li>
                  ))}
                </ul>
              </div>

              <div className="px-5 py-4">
                <h3 className="type-subsection flex items-center gap-2"><Bot className="w-4 h-4" /> AI assistance</h3>
                <p className="type-micro text-text-muted mt-1">
                  Drafts only. Nothing here is sent — you copy, edit and send it yourself.
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                  {ASSIST_ACTIONS.map((a) => (
                    <button
                      key={a.kind}
                      onClick={() => void runAssist(a.kind)}
                      disabled={busy !== null}
                      className="flex items-center gap-2 px-3 py-1.5 border border-card-border rounded-md type-meta hover:bg-hover-bg transition-colors disabled:opacity-50"
                      data-testid={`assist-${a.kind}`}
                    >
                      {busy === a.kind ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                      {a.label}
                    </button>
                  ))}
                  <button
                    onClick={() => void handback()}
                    disabled={busy !== null}
                    className="flex items-center gap-2 px-3 py-1.5 border border-brand-orange text-brand-orange rounded-md type-meta hover:bg-hover-bg transition-colors disabled:opacity-50"
                    data-testid="handback"
                  >
                    {busy === 'handback' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    Resume AI follow-up
                  </button>
                </div>

                {/* Demo control: delivers a controlled inbound reply through the real chokepoint.
                    The endpoint refuses outside the demo tenant, so this is inert elsewhere. */}
                <div className="mt-3 pt-3 border-t border-card-border">
                  <p className="type-micro text-text-muted">
                    Demo — deliver a controlled inbound reply. Goes through the same sync chokepoint
                    as real mail.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {[
                      { key: 'interest', label: 'Interested reply', body: "This is interesting. We're actually reviewing this problem right now. Can you send me more detail on how the implementation works?", auto: false },
                      { key: 'pricing', label: 'Pricing question', body: 'How much does this cost?', auto: false },
                      { key: 'ooo', label: 'Out of office', body: "I'm out of office until next Monday.", auto: true },
                      { key: 'unsubscribe', label: 'Unsubscribe', body: 'Please unsubscribe me.', auto: false },
                    ].map((r) => (
                      <button
                        key={r.key}
                        disabled={busy !== null}
                        onClick={async () => {
                          if (!selected) return;
                          setBusy(`reply-${r.key}`);
                          try {
                            const res = await fetch('/api/demo/inbound-reply', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ leadId: selected, body: r.body, autoReply: r.auto }),
                            });
                            const out = await res.json();
                            await load();
                            await openProspect(selected);
                            setHandbackMsg(
                              res.ok
                                ? `Reply delivered — class ${out.replyClass} (${out.replyKind}), ${out.handoffApplied ? 'handed to the SDR' : 'no SDR interrupt'}.`
                                : `Could not deliver: ${out.error ?? res.status}`
                            );
                          } finally {
                            setBusy(null);
                          }
                        }}
                        className="px-3 py-1.5 border border-card-border rounded-md type-micro hover:bg-hover-bg transition-colors disabled:opacity-50"
                        data-testid={`demo-reply-${r.key}`}
                      >
                        {busy === `reply-${r.key}` ? 'Delivering…' : r.label}
                      </button>
                    ))}
                  </div>
                </div>

                {handbackMsg && (
                  <p className="type-meta mt-3 border border-card-border rounded-md p-3" data-testid="handback-result">
                    {handbackMsg}
                  </p>
                )}

                {assist && (
                  <div className="mt-3 border border-card-border rounded-md p-4" data-testid="assist-output">
                    <div className="flex items-center gap-2 type-meta text-text-muted">
                      <CheckCircle2 className="w-4 h-4" /> {assist.label}
                    </div>
                    {assist.available ? (
                      <p className="type-body mt-2 whitespace-pre-wrap prose-measure">{assist.text}</p>
                    ) : (
                      <p className="type-meta mt-2 prose-measure">
                        AI is unavailable ({assist.reason}). The CRM is unaffected — the objective below is
                        computed by the CRM, not by a model.
                        <br />
                        <span className="type-body">{assist.recommendedObjective}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ---------------- what happened / what next ---------------- */}
          {data && data.insights.length > 0 && (
            <section className="border border-card-border bg-card-bg rounded-md" data-testid="insights">
              <div className="px-5 py-3 border-b border-card-border">
                <h2 className="type-subsection">Outcomes and proposed playbook changes</h2>
                <p className="type-micro text-text-muted mt-0.5">
                  Proposals only. No playbook changes without manager approval.
                </p>
              </div>
              <ul className="divide-y divide-card-border">
                {data.insights.map((i) => (
                  <li key={`${i.leadId}-${i.observation}`} className="px-5 py-3">
                    <div className="type-body">
                      <strong>{i.outcome}</strong> — {i.prospectName}{i.company ? `, ${i.company}` : ''}
                    </div>
                    <ul className="mt-1 space-y-0.5">
                      {i.supportingEvidence.map((e, n) => (
                        <li key={n} className="type-micro text-text-muted prose-measure">{e}</li>
                      ))}
                    </ul>
                    <div className="type-meta mt-1.5">Observation: {i.observation}</div>
                    <div className="type-meta">Suggested change: {i.suggestedChange}</div>
                    <div className="type-micro mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 border border-card-border rounded">
                      <Clock className="w-3 h-3" /> {i.status} · {i.approvalRequired} approval required
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data && data.timeline.length > 0 && (
            <section className="border border-card-border bg-card-bg rounded-md" data-testid="timeline">
              <div className="px-5 py-3 border-b border-card-border">
                <h2 className="type-subsection">What happened</h2>
              </div>
              <ul className="divide-y divide-card-border">
                {data.timeline.slice(0, 12).map((t, i) => (
                  <li key={i} className="px-5 py-2 flex gap-3">
                    <span className="type-micro font-mono text-text-muted w-24 shrink-0">{relative(t.at)}</span>
                    <span className="type-meta prose-measure">{t.description}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
