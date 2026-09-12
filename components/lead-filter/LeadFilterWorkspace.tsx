"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDownUp,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Filter,
  Loader2,
  Search,
  SlidersHorizontal,
  Upload,
  X,
  XCircle,
} from "lucide-react";

import { useAppContext } from "@/context/AppContext";
import { readApiError } from "@/lib/api/client";
import { canUseResearchRole } from "@/lib/research/access";
import type { LeadFilterVerdict } from "@/lib/leadFilter/classification";

type CampaignOption = {
  id: string;
  name: string;
  client: { name: string };
  icpVersion: { id: string; versionNumber: number; icpProfile: { name: string } } | null;
};

type Explanation = {
  dimensions: Array<{ key: string; label: string; score: number }>;
  gateHits: Array<{ label: string; reason: string | null }>;
  missingEvidence: string[];
  reasonCodes: string[];
};

type LeadFilterRow = {
  id: string;
  status: string;
  prospect: {
    id: string;
    name: string;
    company: string;
    title: string | null;
    email: string | null;
    country: string | null;
    industry: string | null;
    sourceType: string;
  };
  verdict: LeadFilterVerdict;
  verdictReason: string;
  fitScore: number | null;
  confidenceScore: number | null;
  dataQualityScore: number | null;
  assessedIcp: { name: string; versionNumber: number } | null;
  assessmentCreatedAt: string | null;
  explanation: Explanation;
  engagementScore: number | null;
  leadId: string | null;
};

type LeadFilterResponse = {
  campaigns: CampaignOption[];
  selectedCampaign: CampaignOption | null;
  counts: Record<"total" | LeadFilterVerdict, number>;
  items: LeadFilterRow[];
  page: number;
  pageSize: number;
  totalPages: number;
  filteredTotal: number;
};

type SortKey = "fit" | "name" | "company";

const verdictMeta: Record<LeadFilterVerdict, { label: string; className: string }> = {
  qualified: { label: "Qualified", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
  needs_review: { label: "Needs review", className: "border-amber-500/30 bg-amber-500/10 text-amber-300" },
  unqualified: { label: "Unqualified", className: "border-red-500/30 bg-red-500/10 text-red-300" },
  not_scored: { label: "Not scored", className: "border-card-border bg-bg-main text-text-muted" },
};

const control = "min-h-11 rounded-lg border border-card-border bg-bg-main px-3 text-sm text-text-primary outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-red";

export default function LeadFilterWorkspace() {
  const router = useRouter();
  const { currentRole, isSessionLoading } = useAppContext();
  const canAccess = canUseResearchRole(currentRole, "manage");
  const [data, setData] = useState<LeadFilterResponse | null>(null);
  const [campaignId, setCampaignId] = useState("");
  const [verdict, setVerdict] = useState<LeadFilterVerdict | "all">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<LeadFilterRow | null>(null);
  const [sort, setSort] = useState<SortKey>("fit");

  useEffect(() => {
    if (!isSessionLoading && !canAccess) router.replace("/");
  }, [canAccess, isSessionLoading, router]);

  const load = useCallback(async () => {
    if (!canAccess) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ verdict, page: String(page), pageSize: "50" });
    if (campaignId) params.set("campaignId", campaignId);
    if (search.trim()) params.set("search", search.trim());
    try {
      const response = await fetch(`/api/lead-filter?${params}`);
      if (!response.ok) throw new Error(await readApiError(response, "Lead Filter could not be loaded"));
      const next: LeadFilterResponse = await response.json();
      setData(next);
      if (!campaignId && next.selectedCampaign) setCampaignId(next.selectedCampaign.id);
      setSelected((current) => next.items.find((item) => item.id === current?.id) ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Lead Filter could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [campaignId, canAccess, page, search, verdict]);

  useEffect(() => {
    if (isSessionLoading || !canAccess) return;
    const timer = window.setTimeout(() => void load(), search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [canAccess, isSessionLoading, load, search]);

  const rows = useMemo(() => {
    const next = [...(data?.items ?? [])];
    next.sort((a, b) => {
      if (sort === "name") return a.prospect.name.localeCompare(b.prospect.name);
      if (sort === "company") return a.prospect.company.localeCompare(b.prospect.company);
      return (b.fitScore ?? -1) - (a.fitScore ?? -1);
    });
    return next;
  }, [data?.items, sort]);

  if (!canAccess && !isSessionLoading) return null;

  return (
    <div className="flex h-full min-w-[1024px] flex-col overflow-hidden bg-bg-main">
      <header className="flex items-center justify-between border-b border-card-border px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-brand-red/25 bg-brand-red/10">
            <SlidersHorizontal className="h-4 w-4 text-brand-red" aria-hidden="true" />
          </span>
          <div>
            <h1 className="font-display text-base font-bold text-text-primary">Lead Filter</h1>
            <p className="text-xs text-text-muted">Review each prospect against the selected campaign ICP</p>
          </div>
        </div>
        <Link href="/leadgen-manager?tab=pool&import=1" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-card-border px-4 text-sm font-semibold text-text-secondary hover:bg-card-border/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red">
          <Upload className="h-4 w-4" aria-hidden="true" /> Import prospects
        </Link>
      </header>

      <main className="flex-1 overflow-auto p-6">
        <section aria-label="Lead filters" className="mb-5 grid grid-cols-[minmax(260px,1fr)_minmax(220px,0.7fr)_minmax(260px,1fr)] gap-3">
          <label className="flex flex-col gap-1 text-xs font-semibold text-text-muted">
            Campaign
            <select aria-label="Filter by campaign" value={campaignId} onChange={(event) => { setCampaignId(event.target.value); setPage(1); setSelected(null); }} className={control}>
              {(data?.campaigns ?? []).map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name} ? {campaign.client.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-text-muted">
            ICP used for this campaign
            <div className={`${control} flex items-center text-text-secondary`}>
              {data?.selectedCampaign?.icpVersion ? `${data.selectedCampaign.icpVersion.icpProfile.name} ? v${data.selectedCampaign.icpVersion.versionNumber}` : "No ICP assigned"}
            </div>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-text-muted">
            Search
            <span className="relative">
              <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-text-muted" aria-hidden="true" />
              <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Name, company, title, or email" className={`${control} w-full pl-9`} />
            </span>
          </label>
        </section>

        <section aria-label="Verdict summary" className="mb-5 grid grid-cols-5 gap-3">
          <Metric label="All prospects" value={data?.counts.total ?? 0} active={verdict === "all"} onClick={() => { setVerdict("all"); setPage(1); }} />
          <Metric label="Qualified" value={data?.counts.qualified ?? 0} active={verdict === "qualified"} onClick={() => { setVerdict("qualified"); setPage(1); }} tone="positive" />
          <Metric label="Needs review" value={data?.counts.needs_review ?? 0} active={verdict === "needs_review"} onClick={() => { setVerdict("needs_review"); setPage(1); }} tone="warning" />
          <Metric label="Unqualified" value={data?.counts.unqualified ?? 0} active={verdict === "unqualified"} onClick={() => { setVerdict("unqualified"); setPage(1); }} tone="negative" />
          <Metric label="Not scored" value={data?.counts.not_scored ?? 0} active={verdict === "not_scored"} onClick={() => { setVerdict("not_scored"); setPage(1); }} />
        </section>

        <div className="mb-3 flex items-center justify-between">
          <label className="flex items-center gap-2 text-xs font-semibold text-text-muted">
            <Filter className="h-4 w-4" aria-hidden="true" /> Verdict
            <select aria-label="Filter by verdict" value={verdict} onChange={(event) => { setVerdict(event.target.value as LeadFilterVerdict | "all"); setPage(1); }} className={`${control} min-w-40`}>
              <option value="all">All</option><option value="qualified">Qualified</option><option value="needs_review">Needs review</option><option value="unqualified">Unqualified</option><option value="not_scored">Not scored</option>
            </select>
          </label>
          <span className="text-xs text-text-muted">{data?.filteredTotal ?? 0} matching prospects</span>
        </div>

        <section className="overflow-hidden rounded-xl border border-card-border bg-card-bg" aria-label="Campaign prospects">
          {error ? <State icon={AlertTriangle} title="Could not load Lead Filter" detail={error} action={<button onClick={() => void load()} className={control}>Try again</button>} /> : loading && !data ? <State icon={Loader2} title="Loading campaign prospects" detail="Reading the latest campaign-scoped assessments?" spin /> : rows.length === 0 ? <State icon={CircleHelp} title="No prospects match these filters" detail="Try another verdict or search, or import prospects into the internal database." /> : (
            <table className="w-full border-collapse text-left text-sm">
              <thead className="border-b border-card-border bg-bg-main/60 text-xs uppercase tracking-wide text-text-muted"><tr>
                <SortHead label="Prospect" active={sort === "name"} onClick={() => setSort("name")} />
                <SortHead label="Company" active={sort === "company"} onClick={() => setSort("company")} />
                <th className="px-4 py-3 font-semibold">Verdict</th>
                <SortHead label="Fit score" active={sort === "fit"} onClick={() => setSort("fit")} />
                <th className="px-4 py-3 font-semibold">Engagement</th><th className="px-4 py-3 font-semibold">Reason</th><th className="px-4 py-3"><span className="sr-only">Details</span></th>
              </tr></thead>
              <tbody className="divide-y divide-card-border">{rows.map((row) => <tr key={row.id} className="hover:bg-bg-main/35">
                <td className="px-4 py-3"><div className="font-semibold text-text-primary">{row.prospect.name}</div><div className="text-xs text-text-muted">{row.prospect.title || row.prospect.email || "Contact details missing"}</div></td>
                <td className="px-4 py-3"><div className="text-text-primary">{row.prospect.company}</div><div className="text-xs text-text-muted">{[row.prospect.industry, row.prospect.country].filter(Boolean).join(" ? ") || "Company details missing"}</div></td>
                <td className="px-4 py-3"><VerdictBadge verdict={row.verdict} stale={row.verdictReason === "stale_assessment"} /></td>
                <td className="px-4 py-3 font-mono font-bold text-text-primary">{row.fitScore ?? "?"}<span className="font-sans text-xs font-normal text-text-muted">{row.fitScore === null ? "" : "/100"}</span></td>
                <td className="px-4 py-3 text-text-secondary">{row.engagementScore === null ? "?" : `${row.engagementScore}/100`}</td>
                <td className="max-w-[260px] px-4 py-3 text-xs text-text-secondary"><Reason row={row} /></td>
                <td className="px-4 py-3 text-right"><button onClick={() => setSelected(row)} className="min-h-11 rounded-lg px-3 text-xs font-semibold text-brand-red hover:bg-brand-red/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red">Why they fit</button></td>
              </tr>)}</tbody>
            </table>
          )}
        </section>

        {(data?.totalPages ?? 0) > 1 && <nav aria-label="Lead Filter pagination" className="mt-4 flex items-center justify-end gap-2"><button aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className={control}><ChevronLeft className="h-4 w-4" /></button><span className="text-xs text-text-muted">Page {data?.page} of {data?.totalPages}</span><button aria-label="Next page" disabled={page >= (data?.totalPages ?? 0)} onClick={() => setPage((value) => value + 1)} className={control}><ChevronRight className="h-4 w-4" /></button></nav>}
      </main>
      {selected && <ExplanationDrawer row={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Metric({ label, value, active, onClick, tone = "neutral" }: { label: string; value: number; active: boolean; onClick: () => void; tone?: "neutral" | "positive" | "warning" | "negative" }) {
  const tones = { neutral: "text-text-primary", positive: "text-emerald-300", warning: "text-amber-300", negative: "text-red-300" };
  return <button onClick={onClick} aria-pressed={active} className={`min-h-20 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red ${active ? "border-brand-red bg-brand-red/10" : "border-card-border bg-card-bg hover:bg-card-border/20"}`}><div className={`text-xl font-bold ${tones[tone]}`}>{value}</div><div className="mt-1 text-xs font-semibold text-text-muted">{label}</div></button>;
}

function SortHead({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) { return <th className="px-4 py-3"><button onClick={onClick} aria-pressed={active} className="inline-flex min-h-11 items-center gap-1 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red">{label}<ArrowDownUp className={`h-3.5 w-3.5 ${active ? "text-brand-red" : ""}`} aria-hidden="true" /></button></th>; }
function VerdictBadge({ verdict, stale }: { verdict: LeadFilterVerdict; stale: boolean }) { const meta = verdictMeta[verdict]; return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${meta.className}`}>{stale ? "Needs rescore" : meta.label}</span>; }
function Reason({ row }: { row: LeadFilterRow }) { if (row.verdictReason === "stale_assessment") return <>Campaign ICP changed; rescore before use.</>; if (row.verdictReason === "no_campaign_icp") return <>Assign an ICP to this campaign.</>; if (row.verdict === "not_scored") return <>No campaign assessment yet.</>; return <>{row.explanation.gateHits[0]?.label || row.explanation.missingEvidence[0] || row.explanation.reasonCodes[0] || "Assessment complete"}</>; }

function State({ icon: Icon, title, detail, action, spin = false }: { icon: typeof AlertTriangle; title: string; detail: string; action?: React.ReactNode; spin?: boolean }) { return <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center"><Icon className={`h-7 w-7 text-text-muted ${spin ? "animate-spin" : ""}`} aria-hidden="true" /><div><h2 className="font-semibold text-text-primary">{title}</h2><p className="mt-1 text-sm text-text-muted">{detail}</p></div>{action}</div>; }

function ExplanationDrawer({ row, onClose }: { row: LeadFilterRow; onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return <div className="fixed inset-0 z-40 bg-black/55" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside role="dialog" aria-modal="true" aria-labelledby="score-explanation-title" className="absolute inset-y-0 right-0 w-[460px] overflow-y-auto border-l border-card-border bg-card-bg p-6 shadow-2xl">
    <div className="mb-6 flex items-start justify-between"><div><p className="text-xs font-semibold uppercase tracking-wide text-brand-red">Why they fit</p><h2 id="score-explanation-title" className="mt-1 text-xl font-bold text-text-primary">{row.prospect.name}</h2><p className="text-sm text-text-muted">{row.prospect.company}</p></div><button ref={closeButton} onClick={onClose} aria-label="Close score explanation" className="flex h-11 w-11 items-center justify-center rounded-lg text-text-muted hover:bg-bg-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"><X className="h-5 w-5" /></button></div>
    <div className="mb-6 grid grid-cols-3 gap-3"><ScoreCard label="Fit" value={row.fitScore} /><ScoreCard label="Confidence" value={row.confidenceScore} /><ScoreCard label="Data quality" value={row.dataQualityScore} /></div>
    <div className="mb-6"><VerdictBadge verdict={row.verdict} stale={row.verdictReason === "stale_assessment"} /><p className="mt-2 text-sm text-text-secondary"><Reason row={row} /></p></div>
    <DrawerSection title="Score dimensions">{row.explanation.dimensions.length ? row.explanation.dimensions.map((dimension) => <div key={dimension.key} className="mb-3"><div className="mb-1 flex justify-between text-xs"><span className="text-text-secondary">{dimension.label}</span><span className="font-mono text-text-primary">{dimension.score}/100</span></div><div className="h-1.5 overflow-hidden rounded-full bg-bg-main"><div className="h-full rounded-full bg-brand-red" style={{ width: `${dimension.score}%` }} /></div></div>) : <EmptyEvidence />}</DrawerSection>
    <DrawerSection title="Hard gates">{row.explanation.gateHits.length ? row.explanation.gateHits.map((hit, index) => <EvidenceLine key={`${hit.label}-${index}`} icon={XCircle} text={hit.label} detail={hit.reason} tone="negative" />) : <EvidenceLine icon={CheckCircle2} text="No hard disqualifier recorded" tone="positive" />}</DrawerSection>
    <DrawerSection title="Missing evidence">{row.explanation.missingEvidence.length ? row.explanation.missingEvidence.map((item) => <EvidenceLine key={item} icon={AlertTriangle} text={item} tone="warning" />) : <EvidenceLine icon={CheckCircle2} text="No missing evidence recorded" tone="positive" />}</DrawerSection>
    <div className="rounded-lg border border-card-border bg-bg-main p-3 text-xs text-text-muted">Engagement score is shown separately because it measures behavior after outreach; it does not change ICP fit.</div>
  </aside></div>;
}
function ScoreCard({ label, value }: { label: string; value: number | null }) { return <div className="rounded-lg border border-card-border bg-bg-main p-3"><div className="text-lg font-bold text-text-primary">{value ?? "?"}{value === null ? "" : "/100"}</div><div className="mt-1 text-xs text-text-muted">{label}</div></div>; }
function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="mb-6"><h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-text-muted">{title}</h3>{children}</section>; }
function EvidenceLine({ icon: Icon, text, detail, tone }: { icon: typeof AlertTriangle; text: string; detail?: string | null; tone: "positive" | "warning" | "negative" }) { const color = tone === "positive" ? "text-emerald-300" : tone === "warning" ? "text-amber-300" : "text-red-300"; return <div className="mb-2 flex gap-2 rounded-lg border border-card-border bg-bg-main p-3"><Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} aria-hidden="true" /><div><div className="text-sm text-text-primary">{text}</div>{detail && <div className="mt-0.5 text-xs text-text-muted">{detail}</div>}</div></div>; }
function EmptyEvidence() { return <p className="text-sm text-text-muted">No dimension evidence recorded for this assessment.</p>; }
