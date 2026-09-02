"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Loader2, Search, Sparkles, Users, X } from "lucide-react";

import { launchResearchRunAction } from "@/app/v2/research/actions";
import { buildQueriesFromBuilderParams, normalizeResearchBuilderParams } from "@telestar/core-research/buildDiscoveryQueries";

export type ResearchIcpOption = {
  id: string;
  label: string;
  companyQueries: string[];
  contactQueries: string[];
};

type Mode = "ICP" | "BUILDER" | "COMPANY_CONTACTS" | "LOOKALIKE";
const QUERY_LIMIT_OPTIONS = [50, 100, 200, 1000] as const;
type QueryLimit = typeof QUERY_LIMIT_OPTIONS[number];

const MODES: Array<{ id: Mode; label: string }> = [
  { id: "ICP", label: "ICP plan" },
  { id: "BUILDER", label: "Custom buckets" },
  { id: "COMPANY_CONTACTS", label: "People at company" },
  { id: "LOOKALIKE", label: "Lookalike" },
];

export function ProspectBuilderModal({
  open,
  onClose,
  icpOptions,
  providerConfigured,
  seedName,
  seedDomain,
}: {
  open: boolean;
  onClose: () => void;
  icpOptions: ResearchIcpOption[];
  providerConfigured: boolean;
  seedName?: string;
  seedDomain?: string;
}) {
  const router = useRouter();
  const [icpId, setIcpId] = useState(icpOptions[0]?.id ?? "");
  const [kind, setKind] = useState<"COMPANY" | "CONTACT">("COMPANY");
  const [mode, setMode] = useState<Mode>(seedName ? "LOOKALIKE" : "ICP");
  const [queryLimit, setQueryLimit] = useState<QueryLimit>(50);
  const [aiFit, setAiFit] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState({
    industries: "", keywords: "", titles: "", geos: "",
    seniority: "", excludeKeywords: "", excludeDomains: "", companySize: "",
    companyName: "", domain: "",
    seedName: seedName ?? "", seedDomain: seedDomain ?? "",
  });

  const selected = useMemo(() => icpOptions.find((o) => o.id === icpId) ?? null, [icpOptions, icpId]);
  const effectiveKind: "COMPANY" | "CONTACT" = mode === "COMPANY_CONTACTS" ? "CONTACT" : mode === "LOOKALIKE" ? "COMPANY" : kind;

  const preview = useMemo(() => {
    if (mode === "ICP") {
      const list = selected ? (effectiveKind === "COMPANY" ? selected.companyQueries : selected.contactQueries) : [];
      return list.slice(0, queryLimit);
    }
    const params = normalizeResearchBuilderParams({
      industries: fields.industries, keywords: fields.keywords, titles: fields.titles, geos: fields.geos, queryLimit,
      seniority: fields.seniority, excludeKeywords: fields.excludeKeywords, excludeDomains: fields.excludeDomains, companySize: fields.companySize,
      ...(mode === "COMPANY_CONTACTS" ? { scope: { companyName: fields.companyName, domain: fields.domain } } : {}),
      ...(mode === "LOOKALIKE" ? { seed: { name: fields.seedName, domain: fields.seedDomain } } : {}),
    });
    if (!params) return [];
    return buildQueriesFromBuilderParams(effectiveKind, params).map((q) => q.query).slice(0, queryLimit);
  }, [mode, selected, effectiveKind, queryLimit, fields]);

  function setField(key: keyof typeof fields, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  const canLaunch = Boolean(icpId) && (
    mode === "ICP" ? preview.length > 0 :
    mode === "COMPANY_CONTACTS" ? fields.companyName.trim().length > 1 :
    mode === "LOOKALIKE" ? fields.seedName.trim().length > 1 || fields.seedDomain.trim().length > 3 :
    [fields.industries, fields.keywords, fields.titles, fields.geos, fields.seniority].some((v) => v.trim().length > 0)
  );

  function launch() {
    setError(null);
    const fd = new FormData();
    fd.set("icpVersionId", icpId);
    fd.set("kind", effectiveKind);
    fd.set("queryLimit", String(queryLimit));
    fd.set("aiFit", aiFit ? "1" : "0");
    if (mode !== "ICP") {
      fd.set("industries", fields.industries);
      fd.set("keywords", fields.keywords);
      fd.set("titles", fields.titles);
      fd.set("geos", fields.geos);
      fd.set("seniority", fields.seniority);
      fd.set("excludeKeywords", fields.excludeKeywords);
      fd.set("excludeDomains", fields.excludeDomains);
      fd.set("companySize", fields.companySize);
    }
    if (mode === "COMPANY_CONTACTS") {
      fd.set("scopeCompanyName", fields.companyName);
      fd.set("scopeDomain", fields.domain);
    }
    if (mode === "LOOKALIKE") {
      fd.set("seedName", fields.seedName);
      fd.set("seedDomain", fields.seedDomain);
    }
    startTransition(async () => {
      const res = await launchResearchRunAction(fd);
      if (!res.ok) { setError(res.error); return; }
      onClose();
      router.push(`/v2/research?runId=${res.runId}`);
    });
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/30 p-4 sm:p-8" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-accent text-primary"><Search className="h-4 w-4" /></span>
            <div>
              <h2 className="text-sm font-semibold text-foreground">New discovery run</h2>
              <p className="text-xs text-muted-foreground">The ICP anchors promotion; the plan below controls what gets found.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted/40" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {!providerConfigured ? <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">No search provider configured. Runs can be created but will fail until EXA, Brave, or Serper is set.</div> : null}
          {error ? <div className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div> : null}

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
            <label className="text-xs font-medium text-muted-foreground">
              Anchor ICP
              <select value={icpId} onChange={(e) => setIcpId(e.target.value)} className="mt-1 h-10 w-full rounded-md border border-border bg-white px-2 text-sm outline-none focus:border-primary/20">
                {icpOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              Query cap
              <select value={queryLimit} onChange={(e) => setQueryLimit(Number(e.target.value) as QueryLimit)} className="mt-1 h-10 w-full rounded-md border border-border bg-white px-2 text-sm outline-none focus:border-primary/20">
                {QUERY_LIMIT_OPTIONS.map((o) => <option key={o} value={o}>{o} queries</option>)}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {MODES.map((m) => (
              <button key={m.id} type="button" onClick={() => setMode(m.id)} className={`h-9 cursor-pointer rounded-md border px-2 text-xs font-semibold transition-colors ${mode === m.id ? "border-primary/20 bg-accent text-primary" : "border-border bg-white text-muted-foreground hover:bg-muted/40"}`}>{m.label}</button>
            ))}
          </div>

          {mode === "ICP" ? (
            <div className="grid grid-cols-2 gap-0.5 rounded-md border border-border p-0.5">
              <button type="button" onClick={() => setKind("COMPANY")} className={`flex h-9 cursor-pointer items-center justify-center gap-1 rounded text-xs font-semibold ${kind === "COMPANY" ? "bg-primary text-white" : "text-muted-foreground hover:bg-muted/40"}`}><Building2 className="h-3.5 w-3.5" /> Companies</button>
              <button type="button" onClick={() => setKind("CONTACT")} className={`flex h-9 cursor-pointer items-center justify-center gap-1 rounded text-xs font-semibold ${kind === "CONTACT" ? "bg-primary text-white" : "text-muted-foreground hover:bg-muted/40"}`}><Users className="h-3.5 w-3.5" /> Contacts</button>
            </div>
          ) : mode === "COMPANY_CONTACTS" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput label="Company name" value={fields.companyName} onChange={(v) => setField("companyName", v)} placeholder="Acme Inc" />
              <TextInput label="Domain" value={fields.domain} onChange={(v) => setField("domain", v)} placeholder="acme.com" />
              <TextInput label="Target titles" value={fields.titles} onChange={(v) => setField("titles", v)} placeholder="VP Sales, Head of Growth" />
              <TextInput label="Geos" value={fields.geos} onChange={(v) => setField("geos", v)} placeholder="United States" />
            </div>
          ) : mode === "LOOKALIKE" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput label="Seed company" value={fields.seedName} onChange={(v) => setField("seedName", v)} placeholder="Acme Payments" />
              <TextInput label="Seed domain" value={fields.seedDomain} onChange={(v) => setField("seedDomain", v)} placeholder="acme.io" />
              <TextInput label="Shared industries" value={fields.industries} onChange={(v) => setField("industries", v)} placeholder="fintech, payments" />
              <TextInput label="Geos" value={fields.geos} onChange={(v) => setField("geos", v)} placeholder="Vietnam" />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput label="Industries" value={fields.industries} onChange={(v) => setField("industries", v)} placeholder="Fintech, logistics" />
              <TextInput label="Keywords" value={fields.keywords} onChange={(v) => setField("keywords", v)} placeholder="AI routing, checkout" />
              <TextInput label="Titles" value={fields.titles} onChange={(v) => setField("titles", v)} placeholder="RevOps, SDR Manager" />
              <TextInput label="Geos" value={fields.geos} onChange={(v) => setField("geos", v)} placeholder="US, Vietnam" />
            </div>
          )}

          {mode !== "ICP" ? (
            <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Refinements</div>
              <div>
                <div className="text-xs font-medium text-muted-foreground">Seniority</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {SENIORITY_OPTIONS.map((s) => {
                    const active = splitTerms(fields.seniority).includes(s.toLowerCase());
                    return (
                      <button key={s} type="button" onClick={() => setField("seniority", toggleTerm(fields.seniority, s.toLowerCase()))}
                        className={`h-8 cursor-pointer rounded-md border px-2.5 text-xs font-semibold transition-colors ${active ? "border-primary/20 bg-accent text-primary" : "border-border bg-white text-muted-foreground hover:bg-muted/40"}`}>
                        {s}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextInput label="Exclude keywords" value={fields.excludeKeywords} onChange={(v) => setField("excludeKeywords", v)} placeholder="recruiter, agency, intern" />
                <TextInput label="Exclude domains" value={fields.excludeDomains} onChange={(v) => setField("excludeDomains", v)} placeholder="competitor.com, indeed.com" />
                <label className="text-xs font-medium text-muted-foreground">
                  Company size
                  <select value={fields.companySize} onChange={(e) => setField("companySize", e.target.value)} className="mt-1 h-10 w-full rounded-md border border-border bg-white px-2 text-sm outline-none focus:border-primary/20">
                    <option value="">Any size</option>
                    {SIZE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </label>
              </div>
            </div>
          ) : null}

          <QueryPreview preview={preview} queryLimit={queryLimit} />

          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium text-muted-foreground">
            <input type="checkbox" checked={aiFit} onChange={(e) => setAiFit(e.target.checked)} className="h-4 w-4" />
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            AI fit scoring — rank + reason each candidate with your AI provider (falls back to the heuristic if AI is off)
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
          <button type="button" onClick={onClose} className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-semibold text-foreground hover:bg-muted/40">Cancel</button>
          <button type="button" onClick={launch} disabled={pending || !canLaunch} className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Launch run
          </button>
        </div>
      </div>
    </div>
  );
}

const SENIORITY_OPTIONS = ["C-level", "VP", "Director", "Manager"] as const;
const SIZE_OPTIONS = ["1-10 employees", "11-50 employees", "51-200 employees", "201-500 employees", "501-1000 employees", "1000+ employees"] as const;

function splitTerms(value: string): string[] {
  return value.split(/[\n,;]+/g).map((v) => v.trim().toLowerCase()).filter(Boolean);
}
function toggleTerm(value: string, term: string): string {
  const set = splitTerms(value);
  const next = set.includes(term) ? set.filter((t) => t !== term) : [...set, term];
  return next.join(", ");
}

function TextInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return <label className="text-xs font-medium text-muted-foreground">{label}<input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mt-1 h-10 w-full rounded-md border border-border bg-white px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/20" /></label>;
}

function QueryPreview({ preview, queryLimit }: { preview: string[]; queryLimit: number }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Query preview ({preview.length}/{queryLimit})</div>
      {preview.length > 0
        ? <ul className="mt-2 flex max-h-28 flex-wrap gap-1.5 overflow-auto rounded-md border border-border bg-muted/40 p-2">{preview.map((query) => <li key={query} className="rounded bg-white px-2 py-1 font-mono text-[11px] text-muted-foreground">{query}</li>)}</ul>
        : <p className="mt-2 text-sm text-muted-foreground">Add targeting above to preview the search plan.</p>}
    </div>
  );
}
