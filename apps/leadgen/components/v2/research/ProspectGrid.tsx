"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clock, ExternalLink, Globe, Mail, MapPin, Phone, Radar, RefreshCw, Search, ShieldCheck, Sparkles, Users, XCircle } from "lucide-react";

import { dismissCandidatesAction, launchCompanyWebsiteRunAction, promoteCandidatesAction, researchSelectedCandidatesAction } from "@/app/v2/research/actions";
import { notifyV2 } from "@/components/v2/notifications/notificationClient";
import { ResearchCandidateDrawer } from "@/components/v2/research/ResearchCandidateDrawer";
import { useDrawerKeyboardNav } from "@/components/v2/shared/useDrawerKeyboardNav";
import { EmptyState } from "@/components/shared/EmptyState";
import { ScoreRing } from "@/components/shared/ScoreRing";
import { StatusBadge } from "@/components/shared/statusBadges";
import { useListKeyboard } from "@/components/shared/useListKeyboard";
import { candidateStatusMeta, prospectKindLabel } from "@/components/v2/research/researchLabels";
import type { ResearchCandidateDrawer as DrawerData, ResearchCandidateRow, ResearchRecommendedAction } from "@/lib/v2/research/queryResearch";
import { toExternalHref } from "@/lib/v2/format/url";

const TABS = [
  { id: "needs_review", label: "Needs review" },
  { id: "pipeline", label: "Pipeline" },
  { id: "dismissed", label: "Dismissed" },
  { id: "all", label: "All" },
] as const;

type TabId = typeof TABS[number]["id"];
type SortId = "fit" | "newest";
const PAGE_SIZE = 100;

function inTab(c: ResearchCandidateRow, tab: TabId): boolean {
  if (tab === "all") return true;
  if (tab === "needs_review") return c.status === "DISCOVERED" || c.status === "DUPLICATE";
  if (tab === "pipeline") return c.hasLeadAssignment || c.status === "PROMOTED";
  return c.status === "DISMISSED";
}

function insightLine(c: ResearchCandidateRow): string | null {
  if (c.insight?.summary) return c.insight.summary;
  if (c.insight?.whatTheySell?.length) return `Sells ${c.insight.whatTheySell.slice(0, 3).join(", ")}`;
  return c.sourceSnippet;
}

export function ProspectGrid({ candidates }: { candidates: ResearchCandidateRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("needs_review");
  const [sort, setSort] = useState<SortId>("fit");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [drawerDetail, setDrawerDetail] = useState<DrawerData | null>(null);

  const counts = useMemo(() => ({
    needs_review: candidates.filter((c) => inTab(c, "needs_review")).length,
    pipeline: candidates.filter((c) => inTab(c, "pipeline")).length,
    dismissed: candidates.filter((c) => inTab(c, "dismissed")).length,
    all: candidates.length,
  }), [candidates]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = candidates.filter((c) => {
      if (!inTab(c, tab)) return false;
      if (!needle) return true;
      return [c.name, c.translatedName, c.company.displayName, c.company.domain, c.title, c.location].some((v) => v?.toLowerCase().includes(needle));
    });
    rows.sort((a, b) => sort === "fit" ? (b.fitScore ?? -1) - (a.fitScore ?? -1) : 0);
    return rows;
  }, [candidates, q, tab, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount);
  const visible = filtered.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE);
  const selectable = visible.filter((c) => c.status !== "PROMOTED" && c.status !== "DISMISSED" && c.recommendedAction !== "open_lead" && canPromoteCandidate(c));
  const firstLead = candidates.find((c) => c.leadAssignmentId)?.leadAssignmentId ?? null;

  // j/k row navigation + Enter opens drawer + x selects (ignored while typing / Cmd+K palette).
  const { activeIndex, setActiveIndex } = useListKeyboard({
    items: visible,
    enabled: !drawerOpen,
    onOpen: (c) => void openDrawer(c.id),
    onToggleSelect: (c) => toggle(c.id),
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function run(action: (fd: FormData) => Promise<unknown>, label: string, ids = Array.from(selected)) {
    if (ids.length === 0) return;
    startTransition(async () => {
      const fd = new FormData();
      for (const id of ids) fd.append("candidateId", id);
      const res = (await action(fd)) as { promoted?: number; count?: number; queued?: number; skipped?: number; errors?: string[]; results?: Array<{ leadUrl?: string | null }> };
      const n = res.promoted ?? res.count ?? res.queued ?? 0;
      const suffix = res.skipped ? ` / ${res.skipped} skipped` : res.errors?.length ? ` / ${res.errors.length} failed` : "";
      const firstLink = res.results?.find((item) => item.leadUrl)?.leadUrl;
      setNotice(`${label}: ${n}${suffix}${firstLink ? " - lead ready" : ""}`);
      notifyV2({
        type: firstLink ? "research.promoted" : label === "Research queued" ? "research.candidate.ready" : "research.stage.completed",
        kind: res.errors?.length ? "warning" : "success",
        title: label,
        description: `${n}${suffix}${firstLink ? " - lead ready" : ""}`,
        href: firstLink ?? undefined,
        actionLabel: firstLink ? "Open lead" : undefined,
      });
      setSelected(new Set());
      router.refresh();
    });
  }

  async function openDrawer(id: string) {
    setDrawerOpen(true);
    setDrawerLoading(true);
    setDrawerError(null);
    setDrawerDetail(null);
    try {
      const res = await fetch(`/v2/research/candidates/${id}/drawer`, { cache: "no-store" });
      if (!res.ok) throw new Error("Could not load candidate detail.");
      setDrawerDetail(await res.json() as DrawerData);
    } catch (error) {
      setDrawerError(error instanceof Error ? error.message : "Could not load candidate detail.");
    } finally {
      setDrawerLoading(false);
    }
  }

  // Left/right and j/k move between candidates (in the current filtered order) while the drawer is open.
  const openCandidateId = drawerDetail?.candidate.id ?? null;
  const stepCandidate = useCallback((delta: number) => {
    if (!openCandidateId) return;
    const idx = filtered.findIndex((c) => c.id === openCandidateId);
    const target = idx >= 0 ? filtered[idx + delta] : undefined;
    if (target) void openDrawer(target.id);
  }, [openCandidateId, filtered]);
  useDrawerKeyboardNav({
    enabled: drawerOpen && Boolean(openCandidateId),
    onPrev: useCallback(() => stepCandidate(-1), [stepCandidate]),
    onNext: useCallback(() => stepCandidate(1), [stepCandidate]),
  });

  function handleDrawerAction(action: ResearchRecommendedAction, id: string) {
    if (action === "research_company") run(researchSelectedCandidatesAction, "Research queued", [id]);
    if (action === "find_company_website") run(launchCompanyWebsiteRunAction, "Website search started", [id]);
    if (action === "add_to_pipeline") run(promoteCandidatesAction, "Added to pipeline", [id]);
    if (action === "dismiss") run(dismissCandidatesAction, "Dismissed", [id]);
    if (action === "open_lead" && drawerDetail?.candidate.leadAssignmentId) window.location.href = `/v2/workspace/leads?leadAssignmentId=${drawerDetail.candidate.leadAssignmentId}`;
    setDrawerOpen(false);
  }

  if (candidates.length === 0) {
    return <EmptyState icon={Radar} title="No candidates yet" description="Discovery is still running, or launch a wider search from the builder to source more companies and contacts." />;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="sticky top-0 z-10 border-b border-border bg-card p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-1">
            {TABS.map((item) => (
              <button key={item.id} type="button" onClick={() => { setTab(item.id); setPage(1); }} className={`inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors ${tab === item.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                {item.label}
                <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${tab === item.id ? "bg-white/20" : "bg-muted text-muted-foreground"}`}>{counts[item.id]}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <label className="relative block min-w-0 flex-1 lg:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search name, company, domain" className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary" />
            </label>
            <div className="flex h-9 shrink-0 items-center rounded-md border border-border p-0.5 text-xs font-semibold">
              <button type="button" onClick={() => setSort("fit")} className={`h-8 cursor-pointer rounded px-2.5 ${sort === "fit" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>Best fit</button>
              <button type="button" onClick={() => setSort("newest")} className={`h-8 cursor-pointer rounded px-2.5 ${sort === "newest" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>Newest</button>
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={selectable.length > 0 && selectable.every((c) => selected.has(c.id))} onChange={(e) => setSelected(e.target.checked ? new Set([...selected, ...selectable.map((c) => c.id)]) : new Set())} className="h-4 w-4" />
            Select page ({selectable.length})
          </label>
          <button type="button" disabled={pending || selected.size === 0} onClick={() => run(promoteCandidatesAction, "Added to pipeline")} className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-md bg-emerald-600 px-2.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40">
            <CheckCircle2 className="h-3.5 w-3.5" /> Add to pipeline
          </button>
          <button type="button" disabled={pending || selected.size === 0} onClick={() => run(researchSelectedCandidatesAction, "Research queued")} className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-md border border-primary/30 bg-accent px-2.5 text-xs font-semibold text-accent-foreground transition-colors hover:bg-accent/70 disabled:cursor-not-allowed disabled:opacity-40">
            <RefreshCw className="h-3.5 w-3.5" /> Research
          </button>
          <button type="button" disabled={pending || selected.size === 0} onClick={() => run(dismissCandidatesAction, "Dismissed")} className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-md border border-border px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40">
            <XCircle className="h-3.5 w-3.5" /> Dismiss
          </button>
          <Link href={firstLead ? `/v2/workspace/leads?leadAssignmentId=${firstLead}` : "/v2/workspace/leads"} className="inline-flex h-9 items-center rounded-md border border-border px-2.5 text-xs font-semibold text-muted-foreground hover:bg-muted"><Users className="mr-1 h-3.5 w-3.5" /> Leads</Link>
          {notice ? <span className="text-xs font-medium text-emerald-700">{notice}</span> : null}
          {selected.size > 0 ? <span className="text-xs font-semibold text-primary">{selected.size} selected</span> : null}
          <span className="ml-auto text-xs text-muted-foreground">{filtered.length} match</span>
        </div>
      </div>

      <div className="divide-y divide-border lg:hidden">
        {visible.map((c) => (
          <MobileCandidateCard key={c.id} candidate={c} selected={selected.has(c.id)} selectable={selectable.some((it) => it.id === c.id)} onToggle={() => toggle(c.id)} onOpen={() => void openDrawer(c.id)} />
        ))}
      </div>

      <div className="hidden max-h-[640px] overflow-auto lg:block">
        <table className="w-full min-w-[1120px] border-separate border-spacing-0 text-left text-sm">
          <thead className="sticky top-0 bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-10 border-b border-border px-3 py-2"></th>
              <th className="w-16 border-b border-border px-3 py-2">Fit</th>
              <th className="border-b border-border px-3 py-2">Prospect</th>
              <th className="border-b border-border px-3 py-2">Why it surfaced</th>
              <th className="border-b border-border px-3 py-2">Links</th>
              <th className="border-b border-border px-3 py-2">Contactability</th>
              <th className="border-b border-border px-3 py-2">Pipeline</th>
              <th className="border-b border-border px-3 py-2">Next step</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.map((c, i) => {
              const meta = candidateStatusMeta(c.status);
              const line = insightLine(c);
              return (
                <tr key={c.id} tabIndex={0} ref={(el) => { if (el && i === activeIndex) el.scrollIntoView({ block: "nearest" }); }} onMouseEnter={() => setActiveIndex(i)} onClick={() => void openDrawer(c.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void openDrawer(c.id); } }} style={{ animationDelay: `${Math.min(i, 12) * 18}ms` }} className={`cursor-pointer outline-none transition-colors animate-in fade-in slide-in-from-bottom-1 ${i === activeIndex ? "bg-accent/60 ring-1 ring-inset ring-primary/40" : selected.has(c.id) ? "bg-accent/60" : "bg-card hover:bg-muted/50"}`}>
                  <td className="px-3 py-3 align-top" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(c.id)} disabled={!selectable.some((it) => it.id === c.id)} onChange={() => toggle(c.id)} className="h-4 w-4" aria-label={`Select ${c.name}`} />
                  </td>
                  <td className="px-3 py-3 align-top">
                    <div className="flex flex-col items-center" title={`${c.fitScore == null ? "Unscored" : `Fit ${c.fitScore}`}${c.fitSource === "ai" ? " (AI)" : ""}${c.fitReason ? ` - ${c.fitReason}` : ""}`}>
                      <ScoreRing score={c.fitScore ?? 0} size="sm" />
                      {c.fitSource === "ai" ? <span className="mt-0.5 inline-flex items-center gap-0.5 text-[9px] font-semibold text-primary"><Sparkles className="h-2.5 w-2.5" />AI</span> : null}
                    </div>
                  </td>
                  <td className="px-3 py-3 align-top">
                    <div className="flex items-start gap-2.5">
                      <Avatar name={c.name} domain={c.company.domain} />
                      <div className="min-w-0">
                        <div className="font-semibold text-foreground">{c.translatedName ?? c.name}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                          {c.title ? <span>{c.title}</span> : null}
                          {c.company.displayName !== "Company unresolved" ? <span className="opacity-80">@ {c.company.displayName}</span> : null}
                          {c.location ? <span className="inline-flex items-center gap-0.5"><MapPin className="h-3 w-3" />{c.location}</span> : null}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {c.company.domain ? <DomainLink domain={c.company.domain} /> : null}
                          <StatusBadge tone={meta.tone} className="text-[10px]">{meta.label}</StatusBadge>
                          {c.researchedAgoLabel ? <span className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground" title={c.firstSeenAt ?? undefined}><Clock className="h-3 w-3" /> seen {c.researchedAgoLabel}</span> : null}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="max-w-[280px] px-3 py-3 align-top">
                    {line ? <p className="line-clamp-2 text-xs leading-5 text-foreground/80">{line}</p> : <span className="text-xs text-muted-foreground">Not enriched yet</span>}
                    {c.insight?.industry?.length ? <div className="mt-1 flex flex-wrap gap-1">{c.insight.industry.slice(0, 2).map((h) => <span key={h} className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground">{h}</span>)}{c.insight.size ? <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{c.insight.size}</span> : null}</div> : null}
                  </td>
                  <td className="px-3 py-3 align-top text-xs text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {c.sourceProvider ? <span className="rounded bg-muted px-1.5 py-0.5 font-semibold text-muted-foreground">{c.sourceProvider}</span> : null}
                      {toExternalHref(c.linkedinUrl) ? <a href={toExternalHref(c.linkedinUrl)!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">LinkedIn <ExternalLink className="h-3 w-3" /></a> : null}
                      {toExternalHref(c.sourceUrl) ? <a href={toExternalHref(c.sourceUrl)!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-foreground">src <ExternalLink className="h-3 w-3" /></a> : null}
                    </div>
                  </td>
                  <td className="px-3 py-3 align-top text-xs"><ContactabilityCell candidate={c} /></td>
                  <td className="px-3 py-3 align-top text-xs"><CrmState candidate={c} /></td>
                  <td className="px-3 py-3 align-top text-xs">
                    <div className="font-semibold text-foreground">{actionLabel(c.recommendedAction)}</div>
                    {c.leadAssignmentId ? <Link onClick={(e) => e.stopPropagation()} href={`/v2/workspace/leads?leadAssignmentId=${c.leadAssignmentId}`} className="mt-0.5 inline-block font-semibold text-primary hover:underline">Open lead</Link> : c.hasLeadAssignment ? <div className="mt-0.5 text-emerald-600">In pipeline</div> : <div className="mt-0.5 text-muted-foreground">{prospectKindLabel(c.kind)}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {visible.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">No candidates match this filter.</p> : null}

      {pageCount > 1 ? (
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted-foreground">
          <span>Page {clampedPage} / {pageCount}</span>
          <div className="flex gap-1">
            <button type="button" disabled={clampedPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="h-8 cursor-pointer rounded border border-border px-2 font-semibold hover:bg-muted disabled:opacity-40">Prev</button>
            <button type="button" disabled={clampedPage >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))} className="h-8 cursor-pointer rounded border border-border px-2 font-semibold hover:bg-muted disabled:opacity-40">Next</button>
          </div>
        </div>
      ) : null}

      <ResearchCandidateDrawer open={drawerOpen} loading={drawerLoading} detail={drawerDetail} error={drawerError} onClose={() => setDrawerOpen(false)} onAction={handleDrawerAction} />
    </div>
  );
}

function MobileCandidateCard({ candidate: c, selected, selectable, onToggle, onOpen }: { candidate: ResearchCandidateRow; selected: boolean; selectable: boolean; onToggle: () => void; onOpen: () => void }) {
  return (
    <article tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }} className={`cursor-pointer bg-card p-4 outline-none transition-colors focus:bg-accent ${selected ? "bg-accent/60" : "hover:bg-muted/40"}`}>
      <div className="flex items-start gap-3">
        <input type="checkbox" checked={selected} disabled={!selectable} onClick={(e) => e.stopPropagation()} onChange={onToggle} className="mt-1 h-4 w-4" aria-label={`Select ${c.name}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-foreground">{c.translatedName ?? c.name}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{[c.title, c.company.displayName !== "Company unresolved" ? c.company.displayName : null].filter(Boolean).join(" @ ") || prospectKindLabel(c.kind)}</div>
            </div>
            <ScoreRing score={c.fitScore ?? 0} size="sm" />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {c.company.domain ? <DomainLink domain={c.company.domain} /> : null}
            <ContactabilityCell candidate={c} compact />
            <CrmState candidate={c} compact />
          </div>
          {insightLine(c) ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{insightLine(c)}</p> : null}
          <div className="mt-3 flex items-center justify-between gap-3 text-xs">
            <span className="font-semibold text-foreground">{actionLabel(c.recommendedAction)}</span>
            {c.leadAssignmentId ? <Link onClick={(e) => e.stopPropagation()} href={`/v2/workspace/leads?leadAssignmentId=${c.leadAssignmentId}`} className="font-semibold text-primary hover:underline">Open lead</Link> : null}
          </div>
        </div>
      </div>
    </article>
  );
}

function Avatar({ name, domain }: { name: string; domain: string | null }) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  if (domain) {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-sm font-semibold text-muted-foreground">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`https://icons.duckduckgo.com/ip3/${domain}.ico`} alt="" width={20} height={20} className="h-5 w-5" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
      </span>
    );
  }
  return <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold text-muted-foreground">{initial}</span>;
}

function DomainLink({ domain }: { domain: string }) {
  const href = toExternalHref(domain);
  if (!href) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground ring-1 ring-border">
        <Globe className="h-3 w-3" /> {domain}
      </span>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground ring-1 ring-border hover:bg-accent hover:text-accent-foreground">
      <Globe className="h-3 w-3" /> {domain}
    </a>
  );
}

function ContactabilityCell({ candidate, compact = false }: { candidate: ResearchCandidateRow; compact?: boolean }) {
  const meta = contactabilityMeta(candidate.emailGuess, candidate.emailStatus, candidate.phone);
  if (compact) {
    return <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${meta.toneClass}`}>{meta.icon}{meta.label}</span>;
  }
  return (
    <div className="space-y-1.5">
      <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${meta.toneClass}`}>{meta.icon}{meta.label}</span>
      {candidate.emailGuess ? <div className="max-w-[170px] truncate text-[11px] text-muted-foreground">{candidate.emailGuess}</div> : null}
      {candidate.phone ? <div className="flex max-w-[170px] items-center gap-1 truncate text-[11px] text-muted-foreground"><Phone className="h-3 w-3 shrink-0" />{candidate.phone}</div> : null}
      <div className="max-w-[180px] text-[11px] leading-4 text-muted-foreground">{meta.detail}</div>
    </div>
  );
}

function contactabilityMeta(email: string | null, status: string | null, phone: string | null) {
  if (email && status === "VERIFIED") {
    return {
      label: "Ready",
      detail: "Verified person email",
      toneClass: "bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900",
      icon: <CheckCircle2 className="h-3 w-3" />,
    };
  }
  if (email) {
    return {
      label: "Review",
      detail: status === "LIKELY" ? "Corroborated email; approve before outreach" : "Unverified email; verify before outreach",
      toneClass: "bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
      icon: <AlertTriangle className="h-3 w-3" />,
    };
  }
  if (phone) {
    return {
      label: "Company phone",
      detail: "Public phone, not a direct person number",
      toneClass: "bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
      icon: <Phone className="h-3 w-3" />,
    };
  }
  return {
    label: "Missing",
    detail: "Run lookup to find contact channels",
    toneClass: "bg-muted/40 text-muted-foreground ring-border",
    icon: <Mail className="h-3 w-3" />,
  };
}
function CrmState({ candidate, compact = false }: { candidate: ResearchCandidateRow; compact?: boolean }) {
  const label = candidate.hasLeadAssignment ? "In leads" : candidate.hasCompany || candidate.hasContact ? "In directory" : "New";
  const tone = candidate.hasLeadAssignment ? "bg-emerald-50 text-emerald-700 ring-emerald-100" : candidate.hasCompany || candidate.hasContact ? "bg-accent text-primary ring-primary/20" : "bg-muted/40 text-muted-foreground ring-border";
  return <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${tone}`}><ShieldCheck className="h-3 w-3" />{compact ? label : label}</span>;
}

function canPromoteCandidate(candidate: ResearchCandidateRow) {
  return candidate.kind !== "CONTACT" || Boolean(candidate.company.domain);
}

function actionLabel(action: ResearchRecommendedAction) {
  if (action === "research_company") return "Research company";
  if (action === "find_company_website") return "Find company website";
  if (action === "add_to_pipeline") return "Add to pipeline";
  if (action === "review_duplicate") return "Review duplicate";
  if (action === "open_lead") return "Open lead";
  if (action === "wait_for_jobs") return "Processing";
  return "Dismiss";
}
