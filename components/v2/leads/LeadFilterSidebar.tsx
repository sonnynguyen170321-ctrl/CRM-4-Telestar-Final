"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

import { FilterSidebar } from "../premium-filters/FilterSidebar";
import { FilterAccordion } from "../premium-filters/FilterAccordion";
import { FilterCombobox } from "../premium-filters/FilterCombobox";
import { ServedVerticalTree } from "../premium-filters/ServedVerticalTree";
import type { LeadWorkspaceFilters, LeadWorkspaceFilterOptions } from "@/lib/v2/crm";
import type { ContactLeadMetrics } from "@/lib/v2/crm/queryContactLeads";

const WORKFLOW_STATUS_FILTERS = [
  "NEW", "ASSIGNED", "WORKING", "CONTACTED", "RESPONDED", "MEETING_BOOKED",
  "MEETING_DONE", "NURTURE", "NOT_INTERESTED", "BOUNCED", "SUPPRESSED",
  "DISQUALIFIED", "ARCHIVED",
];

const QUALIFICATION_FILTERS = [
  "QUALIFIED", "COMPANY_QUALIFIED_NEEDS_CONTACT", "NEEDS_REVIEW", "UNQUALIFIED", "NOT_SCORED",
];

const CONFIDENCE_BANDS = ["HIGH", "MEDIUM", "LOW"];

const CONTACT_READINESS_FILTERS = [
  { id: "ready", label: "Ready email" },
  { id: "review", label: "Review channel" },
  { id: "linkedin_only", label: "LinkedIn only" },
  { id: "company_phone", label: "Company phone" },
  { id: "missing", label: "Missing contact" },
  { id: "missing_email", label: "Missing email" },
];

function formatEnumLabel(value: string) {
  return value.split("_").map((part) => part.charAt(0) + part.slice(1).toLowerCase()).join(" ");
}

function ScopeSelect({ label, value, placeholder, options, onChange }: { label: string; value: string; placeholder: string; options: Array<{ id: string; label: string }>; onChange: (value: string) => void; }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="h-9 w-full rounded-md border border-hairline bg-surface px-2 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20">
        <option value="">{placeholder}</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </label>
  );
}

export function LeadFilterSidebar({ filterOptions, metrics }: { filters: LeadWorkspaceFilters; filterOptions: LeadWorkspaceFilterOptions; metrics?: ContactLeadMetrics; }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = React.useTransition();

  const getArray = (key: string) => {
    const val = searchParams.get(key);
    if (!val) return [];
    return val.split(",").map(v => v.trim()).filter(Boolean);
  };

  const updateParams = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    mutate(params);
    startTransition(() => {
      const query = params.toString();
      router.push(query ? `?${query}` : "?");
    });
  };

  const addInclude = (key: string, id: string) => {
    const includes = getArray(key);
    const exKey = `exclude${key.charAt(0).toUpperCase() + key.slice(1)}`;
    const excludes = getArray(exKey);
    updateParams((params) => {
      if (!includes.includes(id)) params.set(key, [...includes, id].join(","));
      if (excludes.includes(id)) {
        const nextExcludes = excludes.filter(x => x !== id);
        if (nextExcludes.length) params.set(exKey, nextExcludes.join(","));
        else params.delete(exKey);
      }
    });
  };

  const addExclude = (key: string, id: string) => {
    const includes = getArray(key);
    const exKey = `exclude${key.charAt(0).toUpperCase() + key.slice(1)}`;
    const excludes = getArray(exKey);
    updateParams((params) => {
      if (!excludes.includes(id)) params.set(exKey, [...excludes, id].join(","));
      if (includes.includes(id)) {
        const nextIncludes = includes.filter(x => x !== id);
        if (nextIncludes.length) params.set(key, nextIncludes.join(","));
        else params.delete(key);
      }
    });
  };

  const removeFilter = (key: string, id: string) => {
    const includes = getArray(key);
    const exKey = `exclude${key.charAt(0).toUpperCase() + key.slice(1)}`;
    const excludes = getArray(exKey);
    updateParams((params) => {
      const nextIncludes = includes.filter(x => x !== id);
      const nextExcludes = excludes.filter(x => x !== id);
      if (nextIncludes.length) params.set(key, nextIncludes.join(",")); else params.delete(key);
      if (nextExcludes.length) params.set(exKey, nextExcludes.join(",")); else params.delete(exKey);
    });
  };

  const clearFilterCategory = (key: string) => updateParams((params) => { params.delete(key); params.delete(`exclude${key.charAt(0).toUpperCase() + key.slice(1)}`); });

  const setSingle = (key: "clientAccountId" | "projectId" | "icpVersionId", value: string) => {
    updateParams((params) => {
      if (value) params.set(key, value); else params.delete(key);
      if (key === "clientAccountId") { params.delete("projectId"); params.delete("icpVersionId"); }
      if (key === "projectId") params.delete("icpVersionId");
    });
  };

  const clearScope = () => updateParams((params) => { params.delete("clientAccountId"); params.delete("projectId"); params.delete("icpVersionId"); });
  const setParam = (key: string, value: string) => updateParams((params) => { if (value) params.set(key, value); else params.delete(key); });

  const contactReadiness = searchParams.get("contactReadiness") ?? "";
  const search = searchParams.get("search") ?? "";

  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = (new FormData(event.currentTarget).get("search")?.toString() ?? "").trim();
    setParam("search", value);
  };

  const clearAll = () => {
    const keysToRemove = ["clientAccountId", "projectId", "icpVersionId", "companyId", "qualification", "excludeQualification", "workflowStatus", "excludeWorkflowStatus", "country", "excludeCountry", "factToken", "excludeFactToken", "servedVertical", "intelligenceStatus", "excludeIntelligenceStatus", "confidenceBand", "contactReadiness", "search", "domain", "scored", "enrollment", "createdFrom", "createdTo"];
    updateParams((params) => { for (const key of keysToRemove) params.delete(key); });
  };

  const getActiveCount = (key: string) => getArray(key).length + getArray(`exclude${key.charAt(0).toUpperCase() + key.slice(1)}`).length;

  const accountId = searchParams.get("clientAccountId") ?? "";
  const projectId = searchParams.get("projectId") ?? "";
  const icpVersionId = searchParams.get("icpVersionId") ?? "";
  const accounts = filterOptions.context.accounts;
  const selectedAccount = accounts.find((a) => a.id === accountId) ?? null;
  const scopeProjects = selectedAccount ? selectedAccount.projects : accounts.flatMap((a) => a.projects);
  const selectedProject = scopeProjects.find((p) => p.id === projectId) ?? null;
  const scopeIcps = selectedProject ? selectedProject.icpVersions : scopeProjects.flatMap((p) => p.icpVersions);
  const scopeActiveCount = (accountId ? 1 : 0) + (projectId ? 1 : 0) + (icpVersionId ? 1 : 0);

  const totalActive = scopeActiveCount + (contactReadiness ? 1 : 0) + (search ? 1 : 0) + getActiveCount("qualification") + getActiveCount("workflowStatus") + getActiveCount("country") + getActiveCount("factToken") + getArray("servedVertical").length + getActiveCount("intelligenceStatus") + getActiveCount("confidenceBand") + (searchParams.get("createdFrom") ? 1 : 0) + (searchParams.get("createdTo") ? 1 : 0);

  return (
    <FilterSidebar activeCount={totalActive} onClearAll={clearAll} className={isPending ? "opacity-70 pointer-events-none" : ""}>
      {metrics ? <div className="grid grid-cols-3 gap-1.5 rounded-lg border border-border bg-white px-2 py-2 text-center shadow-sm"><MetricChip label="total" value={metrics.total} /><MetricChip label="qualified" value={metrics.qualified} tone="emerald" /><MetricChip label="review" value={metrics.needsReview} tone="amber" /></div> : null}

      <form onSubmit={submitSearch} className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <input name="search" defaultValue={search} placeholder="Search name, title, email..." className="h-9 w-full rounded-lg border border-border bg-white pl-9 pr-3 text-sm text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20" />
      </form>

      <FilterAccordion title="Scope (Account / Project / ICP)" activeCount={scopeActiveCount} onClear={clearScope} defaultExpanded>
        <div className="space-y-2.5">
          <ScopeSelect label="Account" value={accountId} placeholder="All accounts" options={accounts.map((a) => ({ id: a.id, label: a.name }))} onChange={(v) => setSingle("clientAccountId", v)} />
          <ScopeSelect label="Project" value={projectId} placeholder={selectedAccount ? "All projects in account" : "All projects"} options={scopeProjects.map((p) => ({ id: p.id, label: p.name }))} onChange={(v) => setSingle("projectId", v)} />
          <ScopeSelect label="ICP version" value={icpVersionId} placeholder={selectedProject ? "All ICPs in project" : "All ICPs"} options={scopeIcps.map((i) => ({ id: i.id, label: i.label }))} onChange={(v) => setSingle("icpVersionId", v)} />
        </div>
      </FilterAccordion>

      <FilterAccordion title="Contactability" activeCount={contactReadiness ? 1 : 0} onClear={() => setParam("contactReadiness", "")}>
        <ScopeSelect label="Outreach channel" value={contactReadiness} placeholder="Any channel" options={CONTACT_READINESS_FILTERS} onChange={(v) => setParam("contactReadiness", v)} />
      </FilterAccordion>

      <FilterAccordion title="Qualification" activeCount={getActiveCount("qualification")} onClear={() => clearFilterCategory("qualification")} defaultExpanded>
        <FilterCombobox options={QUALIFICATION_FILTERS.map(q => ({ id: q, label: formatEnumLabel(q) }))} includes={getArray("qualification")} excludes={getArray("excludeQualification")} onInclude={(id) => addInclude("qualification", id)} onExclude={(id) => addExclude("qualification", id)} onRemove={(id) => removeFilter("qualification", id)} placeholder="Search qualification..." />
      </FilterAccordion>

      <FilterAccordion title="Workflow status" activeCount={getActiveCount("workflowStatus")} onClear={() => clearFilterCategory("workflowStatus")}>
        <FilterCombobox options={WORKFLOW_STATUS_FILTERS.map(q => ({ id: q, label: formatEnumLabel(q) }))} includes={getArray("workflowStatus")} excludes={getArray("excludeWorkflowStatus")} onInclude={(id) => addInclude("workflowStatus", id)} onExclude={(id) => addExclude("workflowStatus", id)} onRemove={(id) => removeFilter("workflowStatus", id)} placeholder="Search status..." />
      </FilterAccordion>

      <FilterAccordion title="Date added" activeCount={(searchParams.get("createdFrom") ? 1 : 0) + (searchParams.get("createdTo") ? 1 : 0)} onClear={() => { setParam("createdFrom", ""); setParam("createdTo", ""); }}>
        <div className="flex flex-col gap-2 px-1 py-1">
          <label className="text-xs font-medium text-muted-foreground">From
            <input type="date" value={searchParams.get("createdFrom") ?? ""} max={searchParams.get("createdTo") ?? undefined} onChange={(e) => setParam("createdFrom", e.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-white px-2 text-sm outline-none focus:border-primary/40" />
          </label>
          <label className="text-xs font-medium text-muted-foreground">To
            <input type="date" value={searchParams.get("createdTo") ?? ""} min={searchParams.get("createdFrom") ?? undefined} onChange={(e) => setParam("createdTo", e.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-white px-2 text-sm outline-none focus:border-primary/40" />
          </label>
        </div>
      </FilterAccordion>

      <FilterAccordion title="Confidence" activeCount={getActiveCount("confidenceBand")} onClear={() => clearFilterCategory("confidenceBand")}>
        <FilterCombobox options={CONFIDENCE_BANDS.map(q => ({ id: q, label: formatEnumLabel(q) }))} includes={getArray("confidenceBand")} excludes={[]} onInclude={(id) => addInclude("confidenceBand", id)} onExclude={() => {}} onRemove={(id) => removeFilter("confidenceBand", id)} placeholder="Search confidence..." allowExclude={false} />
      </FilterAccordion>

      <FilterAccordion title="Fact tokens" activeCount={getActiveCount("factToken")} onClear={() => clearFilterCategory("factToken")}>
        <FilterCombobox options={filterOptions.factTokens.map(q => ({ id: q, label: q }))} includes={getArray("factToken")} excludes={getArray("excludeFactToken")} onInclude={(id) => addInclude("factToken", id)} onExclude={(id) => addExclude("factToken", id)} onRemove={(id) => removeFilter("factToken", id)} placeholder="Search facts..." />
      </FilterAccordion>

      <FilterAccordion title="Industry & vertical" activeCount={getArray("servedVertical").length} onClear={() => clearFilterCategory("servedVertical")}>
        <ServedVerticalTree selected={getArray("servedVertical")} onToggle={(key) => { if (getArray("servedVertical").includes(key)) removeFilter("servedVertical", key); else addInclude("servedVertical", key); }} />
      </FilterAccordion>
    </FilterSidebar>
  );
}

function MetricChip({ label, value, tone = "primary" }: { label: string; value: number; tone?: "primary" | "emerald" | "amber"; }) {
  const toneClass = { primary: "text-primary", emerald: "text-emerald-600", amber: "text-amber-600" }[tone];
  return <div className="min-w-0"><div className={`truncate text-[11px] font-bold tabular-nums ${toneClass}`}>{value.toLocaleString()}</div><div className="truncate text-[10px] font-medium text-muted-foreground">{label}</div></div>;
}
