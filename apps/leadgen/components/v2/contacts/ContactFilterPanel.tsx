"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, useMemo, useEffect } from "react";
import {
  Filter, Search as SearchIcon, X, Mail, Users, Target,
  Building2, Globe, Briefcase, ChevronDown, Check, MinusCircle, PlusCircle, Bookmark, BookmarkPlus, Trash2
} from "lucide-react";
import { FilterSidebar } from "../premium-filters/FilterSidebar";
import { FilterAccordion } from "../premium-filters/FilterAccordion";
import { formatCount } from "@/lib/v2/format/datetime";

type Tri = "" | "yes" | "no";
type IcpOption = { id: string; label: string };

type SuggestionItem = { id: string; label?: string; name?: string; count?: number };
type OwnerItem = { userId: string; name: string | null; email: string; role: string };

export type ContactFilterSuggestionsData = {
  companies: Array<{ id: string; name: string; count: number }>;
  industries: Array<{ id: string; label: string; count: number }>;
  countries: Array<{ id: string; label: string; count: number }>;
  owners: OwnerItem[];
  titles?: Array<{ label: string; count: number }>;
};

type FacetSummary = {
  total: number;
  withEmail: number;
  qualified: number;
  meetingBooked: number;
};

const QUALIFICATIONS: Array<{ value: string; label: string }> = [
  { value: "QUALIFIED", label: "Qualified" },
  { value: "COMPANY_QUALIFIED_NEEDS_CONTACT", label: "Company qualified" },
  { value: "NEEDS_REVIEW", label: "Needs review" },
  { value: "UNQUALIFIED", label: "Unqualified" },
  { value: "NOT_SCORED", label: "Not scored" },
];

const SENIORITIES: Array<{ value: string; label: string }> = [
  { value: "C_LEVEL", label: "C-Level" },
  { value: "OWNER", label: "Owner / Founder" },
  { value: "VP", label: "VP" },
  { value: "DIRECTOR", label: "Director" },
  { value: "HEAD", label: "Head" },
  { value: "LEAD", label: "Lead" },
  { value: "MANAGER", label: "Manager" },
  { value: "IC", label: "Individual contributor" },
  { value: "UNKNOWN", label: "Unknown" },
];

const DEPARTMENTS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "EXECUTIVE", label: "Executive" },
  { value: "SALES", label: "Sales" },
  { value: "MARKETING", label: "Marketing" },
  { value: "GROWTH", label: "Growth" },
  { value: "BUSINESS_DEVELOPMENT", label: "Business Development" },
  { value: "PARTNERSHIPS", label: "Partnerships" },
  { value: "IT", label: "IT" },
  { value: "ENGINEERING", label: "Engineering" },
  { value: "SECURITY", label: "Security" },
  { value: "PRODUCT", label: "Product" },
  { value: "OPERATIONS", label: "Operations" },
  { value: "PRODUCTION", label: "Production" },
  { value: "HR", label: "HR" },
  { value: "FINANCE", label: "Finance" },
  { value: "ADMIN", label: "Admin" },
  { value: "CUSTOMER", label: "Customer Success" },
  { value: "LEGAL", label: "Legal" },
  { value: "UNKNOWN", label: "Unknown" },
];

const ensureArray = (val: string | string[] | undefined) => Array.isArray(val) ? val : (val ? [val] : []);

export function ContactFilterPanel({
  icpVersions,
  query,
  suggestions,
  facets,
  canAssign = false,
}: {
  icpVersions: IcpOption[];
  query: Record<string, string | string[]>;
  suggestions?: ContactFilterSuggestionsData;
  facets?: FacetSummary;
  canAssign?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [search, setSearch] = useState((query.search as string) ?? "");
  const [icps, setIcps] = useState<string[]>(ensureArray(query.icpVersionId));
  const [notIcps, setNotIcps] = useState<string[]>(ensureArray(query.notIcpVersionId));
  const [quals, setQuals] = useState<string[]>(ensureArray(query.qualification));
  const [notQuals, setNotQuals] = useState<string[]>(ensureArray(query.notQualification));
  const [seniorities, setSeniorities] = useState<string[]>(ensureArray(query.seniority));
  const [notSeniorities, setNotSeniorities] = useState<string[]>(ensureArray(query.notSeniority));
  const [departments, setDepartments] = useState<string[]>(ensureArray(query.department));
  const [notDepartments, setNotDepartments] = useState<string[]>(ensureArray(query.notDepartment));
  const [companies, setCompanies] = useState<string[]>(ensureArray(query.company));
  const [notCompanies, setNotCompanies] = useState<string[]>(ensureArray(query.notCompany));
  const [titles, setTitles] = useState<string[]>(ensureArray(query.title));
  const [notTitles, setNotTitles] = useState<string[]>(ensureArray(query.notTitle));
  const [industries, setIndustries] = useState<string[]>(ensureArray(query.industry));
  const [notIndustries, setNotIndustries] = useState<string[]>(ensureArray(query.notIndustry));
  const [countries, setCountries] = useState<string[]>(ensureArray(query.country));
  const [notCountries, setNotCountries] = useState<string[]>(ensureArray(query.notCountry));
  
  const [hasEmail, setHasEmail] = useState<Tri>((query.hasEmail as Tri) || "");
  const [hasPhone, setHasPhone] = useState<Tri>((query.hasPhone as Tri) || "");
  const [hasLinkedin, setHasLinkedin] = useState<Tri>((query.hasLinkedin as Tri) || "");
  const [hasEnrichment, setHasEnrichment] = useState<Tri>((query.hasEnrichment as Tri) || "");
  const [hasOpenReview, setHasOpenReview] = useState<Tri>((query.hasOpenReview as Tri) || "");
  const [ownerUserId, setOwnerUserId] = useState((query.ownerUserId as string) ?? "");
  
  const [savedFilters, setSavedFilters] = useState<Array<{ id: string; name: string; query: string }>>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("telestar_saved_filters");
      // Hydration-safe localStorage read on mount — intentional.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored) setSavedFilters(JSON.parse(stored));
    } catch (e) {
      console.error("Failed to load saved filters", e);
    }
  }, []);

  const saveFilter = () => {
    const name = window.prompt("Enter a name for this filter:");
    if (!name?.trim()) return;
    
    const p = buildUrlParams();
    if (p.toString() === "") {
      window.alert("Cannot save an empty filter.");
      return;
    }
    
    const newFilter = { id: Date.now().toString(), name: name.trim(), query: p.toString() };
    const updated = [...savedFilters, newFilter];
    setSavedFilters(updated);
    localStorage.setItem("telestar_saved_filters", JSON.stringify(updated));
  };
  
  const deleteSavedFilter = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = savedFilters.filter(f => f.id !== id);
    setSavedFilters(updated);
    localStorage.setItem("telestar_saved_filters", JSON.stringify(updated));
  };

  const applySavedFilter = (queryString: string) => {
    startTransition(() => {
      router.push(`/v2/crm/contacts?${queryString}`);
    });
  };

  function buildUrlParams() {
    const p = new URLSearchParams();
    const setArr = (key: string, values: string[]) => {
      values.forEach(v => { if (v.trim()) p.append(key, v.trim()); });
    };
    
    if (search.trim()) p.set("search", search.trim());
    setArr("icpVersionId", icps); setArr("notIcpVersionId", notIcps);
    setArr("qualification", quals); setArr("notQualification", notQuals);
    setArr("seniority", seniorities); setArr("notSeniority", notSeniorities);
    setArr("department", departments); setArr("notDepartment", notDepartments);
    setArr("company", companies); setArr("notCompany", notCompanies);
    setArr("title", titles); setArr("notTitle", notTitles);
    setArr("industry", industries); setArr("notIndustry", notIndustries);
    setArr("country", countries); setArr("notCountry", notCountries);
    
    if (hasEmail) p.set("hasEmail", hasEmail);
    if (hasPhone) p.set("hasPhone", hasPhone);
    if (hasLinkedin) p.set("hasLinkedin", hasLinkedin);
    if (hasEnrichment) p.set("hasEnrichment", hasEnrichment);
    if (hasOpenReview) p.set("hasOpenReview", hasOpenReview);
    if (ownerUserId) p.set("ownerUserId", ownerUserId);
    
    return p;
  }

  function apply() {
    const p = buildUrlParams();
    
    startTransition(() => {
      router.push(`/v2/crm/contacts?${p.toString()}`);
    });
  }

  const activeFilters = useMemo(() => {
    const pills: Array<{ key: string; label: string; color: string; onRemove: () => void }> = [];
    if (search) pills.push({ key: "search", label: `"${search}"`, color: "bg-muted text-foreground", onRemove: () => setSearch("") });
    
    companies.forEach(c => pills.push({ key: `company-${c}`, label: c, color: "bg-accent text-primary", onRemove: () => setCompanies(p => p.filter(x => x !== c)) }));
    notCompanies.forEach(c => pills.push({ key: `not-company-${c}`, label: `≠ ${c}`, color: "bg-red-50 text-red-700", onRemove: () => setNotCompanies(p => p.filter(x => x !== c)) }));
    
    industries.forEach(i => pills.push({ key: `industry-${i}`, label: i, color: "bg-purple-50 text-purple-700", onRemove: () => setIndustries(p => p.filter(x => x !== i)) }));
    notIndustries.forEach(i => pills.push({ key: `not-industry-${i}`, label: `≠ ${i}`, color: "bg-red-50 text-red-700", onRemove: () => setNotIndustries(p => p.filter(x => x !== i)) }));
    
    countries.forEach(c => pills.push({ key: `country-${c}`, label: c, color: "bg-emerald-50 text-emerald-700", onRemove: () => setCountries(p => p.filter(x => x !== c)) }));
    notCountries.forEach(c => pills.push({ key: `not-country-${c}`, label: `≠ ${c}`, color: "bg-red-50 text-red-700", onRemove: () => setNotCountries(p => p.filter(x => x !== c)) }));
    
    seniorities.forEach(s => pills.push({ key: `seniority-${s}`, label: SENIORITIES.find((x) => x.value === s)?.label ?? s, color: "bg-violet-50 text-violet-700", onRemove: () => setSeniorities(p => p.filter(x => x !== s)) }));
    notSeniorities.forEach(s => pills.push({ key: `not-seniority-${s}`, label: `≠ ${SENIORITIES.find((x) => x.value === s)?.label ?? s}`, color: "bg-red-50 text-red-700", onRemove: () => setNotSeniorities(p => p.filter(x => x !== s)) }));
    
    departments.forEach(d => pills.push({ key: `department-${d}`, label: DEPARTMENTS_OPTIONS.find((x) => x.value === d)?.label ?? d, color: "bg-accent text-primary", onRemove: () => setDepartments(p => p.filter(x => x !== d)) }));
    notDepartments.forEach(d => pills.push({ key: `not-department-${d}`, label: `≠ ${DEPARTMENTS_OPTIONS.find((x) => x.value === d)?.label ?? d}`, color: "bg-red-50 text-red-700", onRemove: () => setNotDepartments(p => p.filter(x => x !== d)) }));
    
    quals.forEach(q => pills.push({ key: `qual-${q}`, label: QUALIFICATIONS.find((x) => x.value === q)?.label ?? q, color: "bg-amber-50 text-amber-700", onRemove: () => setQuals(p => p.filter(x => x !== q)) }));
    notQuals.forEach(q => pills.push({ key: `not-qual-${q}`, label: `≠ ${QUALIFICATIONS.find((x) => x.value === q)?.label ?? q}`, color: "bg-red-50 text-red-700", onRemove: () => setNotQuals(p => p.filter(x => x !== q)) }));
    
    icps.forEach(i => pills.push({ key: `icp-${i}`, label: icpVersions.find(v => v.id === i)?.label ?? "ICP", color: "bg-muted text-foreground", onRemove: () => setIcps(p => p.filter(x => x !== i)) }));
    notIcps.forEach(i => pills.push({ key: `not-icp-${i}`, label: `≠ ${icpVersions.find(v => v.id === i)?.label ?? "ICP"}`, color: "bg-red-50 text-red-700", onRemove: () => setNotIcps(p => p.filter(x => x !== i)) }));
    
    titles.forEach(t => pills.push({ key: `title-${t}`, label: t, color: "bg-muted text-foreground", onRemove: () => setTitles(p => p.filter(x => x !== t)) }));
    notTitles.forEach(t => pills.push({ key: `not-title-${t}`, label: `≠ ${t}`, color: "bg-red-50 text-red-700", onRemove: () => setNotTitles(p => p.filter(x => x !== t)) }));

    if (hasEmail === "yes") pills.push({ key: "hasEmail", label: "Has email", color: "bg-emerald-50 text-emerald-700", onRemove: () => setHasEmail("") });
    if (hasEmail === "no") pills.push({ key: "noEmail", label: "No email", color: "bg-red-50 text-red-700", onRemove: () => setHasEmail("") });
    if (hasEnrichment === "yes") pills.push({ key: "enriched", label: "Enriched", color: "bg-indigo-50 text-indigo-700", onRemove: () => setHasEnrichment("") });
    if (hasOpenReview === "yes") pills.push({ key: "review", label: "Open review", color: "bg-amber-50 text-amber-700", onRemove: () => setHasOpenReview("") });
    
    return pills;
  }, [search, companies, notCompanies, industries, notIndustries, countries, notCountries, seniorities, notSeniorities, departments, notDepartments, quals, notQuals, icps, notIcps, titles, notTitles, hasEmail, hasEnrichment, hasOpenReview, icpVersions]);

  const activeCount = [
    search, ...icps, ...notIcps, ...quals, ...notQuals, ...seniorities, ...notSeniorities, ...departments, ...notDepartments, ...companies, ...notCompanies, ...titles, ...notTitles, ...industries, ...notIndustries, ...countries, ...notCountries,
    hasEmail, hasPhone, hasLinkedin, hasEnrichment, hasOpenReview, ownerUserId,
  ].filter(Boolean).length;

  const clearAll = () => {
    setSearch(""); setIcps([]); setNotIcps([]); setQuals([]); setNotQuals([]); setSeniorities([]); setNotSeniorities([]); setDepartments([]); setNotDepartments([]); setCompanies([]); setNotCompanies([]);
    setTitles([]); setNotTitles([]); setIndustries([]); setNotIndustries([]); setCountries([]); setNotCountries([]); setHasEmail(""); setHasPhone("");
    setHasLinkedin(""); setHasEnrichment(""); setHasOpenReview(""); setOwnerUserId("");
    startTransition(() => { router.push("/v2/crm/contacts"); });
  };

  return (
    <FilterSidebar activeCount={activeCount} onClearAll={clearAll} className={isPending ? "opacity-70 pointer-events-none" : ""}>
      {/* Facet summary bar */}
      {facets && (
        <div className="mx-3 mb-3 flex items-center gap-3 rounded-lg border border-border bg-gradient-to-r from-muted to-white px-3 py-2">
          <FacetChip icon={<Users className="h-3 w-3" />} value={facets.total} label="total" />
          <FacetChip icon={<Mail className="h-3 w-3 text-emerald-500" />} value={facets.withEmail} label="email" />
          <FacetChip icon={<Target className="h-3 w-3 text-primary" />} value={facets.qualified} label="qualified" />
        </div>
      )}

      {/* Search */}
      <div className="px-3 py-2">
        <span className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 shadow-sm transition-shadow focus-within:border-primary/20 focus-within:shadow-md focus-within:shadow-primary/10">
          <SearchIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && apply()}
            placeholder="Search name, title, email..."
            className="h-9 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} className="text-muted-foreground/50 hover:text-muted-foreground transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      </div>

      {/* Active filter pills */}
      {activeFilters.length > 0 && (
        <div className="mx-3 mb-2 flex flex-wrap gap-1.5">
          {activeFilters.map((pill) => (
            <span
              key={pill.key}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold transition-all duration-200 animate-in fade-in zoom-in-95 ${pill.color}`}
            >
              {pill.label}
              <button
                type="button"
                onClick={() => { pill.onRemove(); apply(); }}
                className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-black/10"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Lead Assignment */}
      <FilterAccordion title="Lead Assignment" activeCount={[...icps, ...notIcps, ...quals, ...notQuals].length} defaultExpanded>
        <div className="space-y-3">
          <MultiAutocompleteFilter
            label="Project & ICP"
            included={icps} onIncluded={setIcps} excluded={notIcps} onExcluded={setNotIcps}
            suggestions={icpVersions.map((v) => ({ value: v.id, label: v.label }))}
            placeholder={icpVersions.length ? "Search ICPs..." : "No published ICP"}
            disableInput={icpVersions.length === 0}
            showListOnFocus
          />
          <MultiAutocompleteFilter
            label="Qualification"
            included={quals} onIncluded={setQuals} excluded={notQuals} onExcluded={setNotQuals}
            suggestions={QUALIFICATIONS} placeholder="Search qualifications..."
            showListOnFocus
          />
        </div>
      </FilterAccordion>

      {/* Company & Industry */}
      <FilterAccordion title="Company & Industry" activeCount={[...companies, ...notCompanies, ...industries, ...notIndustries, ...countries, ...notCountries].length}>
        <div className="space-y-3">
          <MultiAutocompleteFilter
            label="Company" included={companies} onIncluded={setCompanies} excluded={notCompanies} onExcluded={setNotCompanies}
            placeholder="Search companies..."
            suggestions={suggestions?.companies.map((c) => ({ value: c.name, label: c.name, count: c.count })) ?? []}
            icon={<Building2 className="h-3.5 w-3.5 text-muted-foreground" />}
          />
          <MultiAutocompleteFilter
            label="Industry" included={industries} onIncluded={setIndustries} excluded={notIndustries} onExcluded={setNotIndustries}
            placeholder="e.g. Health, SaaS"
            suggestions={suggestions?.industries.map((i) => ({ value: i.label, label: i.label, count: i.count })) ?? []}
            icon={<Briefcase className="h-3.5 w-3.5 text-muted-foreground" />}
          />
          <MultiAutocompleteFilter
            label="Country" included={countries} onIncluded={setCountries} excluded={notCountries} onExcluded={setNotCountries}
            placeholder="e.g. Indonesia"
            suggestions={suggestions?.countries.map((c) => ({ value: c.label, label: c.label, count: c.count })) ?? []}
            icon={<Globe className="h-3.5 w-3.5 text-muted-foreground" />}
          />
        </div>
      </FilterAccordion>

      {/* Persona */}
      <FilterAccordion title="Persona" activeCount={[...titles, ...notTitles, ...seniorities, ...notSeniorities, ...departments, ...notDepartments].length}>
        <div className="space-y-3">
          <MultiAutocompleteFilter
            label="Job Title" included={titles} onIncluded={setTitles} excluded={notTitles} onExcluded={setNotTitles}
            placeholder="e.g. Marketing Manager"
            suggestions={suggestions?.titles?.map((t) => ({ value: t.label, label: t.label, count: t.count })) ?? []}
          />
          <MultiAutocompleteFilter
            label="Seniority"
            included={seniorities} onIncluded={setSeniorities} excluded={notSeniorities} onExcluded={setNotSeniorities}
            suggestions={SENIORITIES} placeholder="Search seniority..."
            showListOnFocus
          />
          <MultiAutocompleteFilter
            label="Department"
            included={departments} onIncluded={setDepartments} excluded={notDepartments} onExcluded={setNotDepartments}
            suggestions={DEPARTMENTS_OPTIONS} placeholder="Search department..."
            showListOnFocus
          />
        </div>
      </FilterAccordion>

      {/* Contact Info */}
      <FilterAccordion title="Contact Info" activeCount={[hasEmail, hasPhone, hasLinkedin].filter(Boolean).length}>
        <div className="space-y-3">
          <TriRow label="Email" value={hasEmail} onChange={setHasEmail} />
          <TriRow label="Phone" value={hasPhone} onChange={setHasPhone} />
          <TriRow label="LinkedIn" value={hasLinkedin} onChange={setHasLinkedin} />
        </div>
      </FilterAccordion>

      {/* Intelligence */}
      <FilterAccordion title="Intelligence" activeCount={[hasEnrichment, hasOpenReview, ownerUserId].filter(Boolean).length}>
        <div className="space-y-3">
          <TriRow label="Company enriched" value={hasEnrichment} onChange={setHasEnrichment} />
          <TriRow label="Open review" value={hasOpenReview} onChange={setHasOpenReview} />
          {canAssign && suggestions?.owners && (
            <label className="block text-sm">
              <span className="mb-1.5 flex items-center gap-2">
                <span className="font-medium text-foreground">Owner</span>
              </span>
              <select
                value={ownerUserId}
                onChange={(e) => setOwnerUserId(e.target.value)}
                className="h-9 w-full cursor-pointer rounded-md border border-border bg-card px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                <option value="">Any owner</option>
                <option value="__unassigned__">Unassigned</option>
                {suggestions.owners.map((o) => (
                  <option key={o.userId} value={o.userId}>
                    {o.name ?? o.email} ({o.role})
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </FilterAccordion>

      {/* Saved filters */}
      {savedFilters.length > 0 && (
        <FilterAccordion title="Saved Filters" activeCount={0}>
          <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
            {savedFilters.map(f => (
              <div
                key={f.id}
                onClick={() => applySavedFilter(f.query)}
                className="group relative flex items-center justify-between cursor-pointer rounded-md border border-border bg-card px-2.5 py-2 text-[12px] font-medium text-foreground transition-all hover:bg-accent hover:border-primary/20 hover:text-primary active:scale-95"
              >
                <div className="flex items-center gap-2 overflow-hidden">
                  <Bookmark className="h-3 w-3 shrink-0 text-muted-foreground group-hover:text-primary" />
                  <span className="truncate">{f.name}</span>
                </div>
                <button
                  type="button"
                  onClick={(e) => deleteSavedFilter(f.id, e)}
                  className="shrink-0 rounded-md p-1 text-muted-foreground/50 opacity-0 group-hover:opacity-100 hover:bg-red-100 hover:text-red-500 transition-all"
                  title="Delete filter"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </FilterAccordion>
      )}

      {/* Apply button */}
      <div className="px-3 py-4 mt-2 border-t border-border flex items-center gap-2">
        <button
          onClick={saveFilter}
          title="Save current filters"
          className="flex shrink-0 h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:bg-muted/50 hover:text-primary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <BookmarkPlus className="h-4 w-4" />
        </button>
        <button
          onClick={apply}
          className="flex flex-1 h-10 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-primary to-primary/90 px-3 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:from-primary hover:to-primary/80 hover:shadow-md active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <Filter className="h-4 w-4" />
          Apply Filters
          {activeCount > 0 && (
            <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-card/20 px-1.5 text-[11px] font-bold">
              {activeCount}
            </span>
          )}
        </button>
      </div>
    </FilterSidebar>
  );
}

// ── Primitives ──────────────────────────────────────────────────────────────

function FacetChip({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
      {icon}
      <span className="tabular-nums font-bold text-foreground">{formatCount(value)}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function MultiFilterText({
  label, included, onIncluded, excluded, onExcluded, placeholder,
}: {
  label: string; 
  included: string[]; onIncluded: (v: string[]) => void; 
  excluded: string[]; onExcluded: (v: string[]) => void; 
  placeholder: string;
}) {
  const [inputValue, setInputValue] = useState("");
  const [mode, setMode] = useState<"is" | "not">("is");
  
  const addValue = () => {
    const val = inputValue.trim();
    if (val) {
      if (mode === "is" && !included.includes(val)) onIncluded([...included, val]);
      if (mode === "not" && !excluded.includes(val)) onExcluded([...excluded, val]);
    }
    setInputValue("");
  };

  return (
    <label className="block text-sm">
      <span className="mb-1.5 flex items-center justify-between gap-2">
        <span className="font-medium text-foreground">{label}</span>
        <div className="inline-flex shrink-0 overflow-hidden rounded-md border border-border text-xs">
          <button type="button" onClick={() => setMode("is")} className={`px-2 py-1 transition-colors ${mode === "is" ? "bg-primary text-white" : "bg-white text-muted-foreground hover:bg-muted/50"}`}>is</button>
          <button type="button" onClick={() => setMode("not")} className={`px-2 py-1 transition-colors ${mode === "not" ? "bg-red-600 text-white" : "bg-white text-muted-foreground hover:bg-muted/50"}`}>not</button>
        </div>
      </span>
      <div className="relative">
        <input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addValue();
            }
          }}
          placeholder={placeholder}
          className="h-9 w-full rounded-md border border-border bg-card px-2.5 text-sm text-foreground outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
        {inputValue && (
          <button type="button" onMouseDown={e => { e.preventDefault(); addValue(); }} className="absolute right-2 top-2 text-muted-foreground/50 hover:text-muted-foreground">
            <Check className={`h-4 w-4 ${mode === "not" ? "text-red-500" : "text-primary"}`} />
          </button>
        )}
      </div>
    </label>
  );
}

function MultiAutocompleteFilter({
  label, included, onIncluded, excluded, onExcluded, placeholder, suggestions, icon, disableInput, showListOnFocus
}: {
  label: string; 
  included: string[]; onIncluded: (v: string[]) => void; 
  excluded: string[]; onExcluded: (v: string[]) => void; 
  placeholder: string; suggestions: Array<{ value: string; label: string; count?: number }>; icon?: React.ReactNode;
  disableInput?: boolean;
  showListOnFocus?: boolean;
}) {
  const [inputValue, setInputValue] = useState("");
  const [focused, setFocused] = useState(false);
  
  const filteredSuggestions = useMemo(() => {
    if (!inputValue.trim()) return suggestions.slice(0, 10);
    const q = inputValue.toLowerCase();
    return suggestions.filter(s => s.label.toLowerCase().includes(q)).slice(0, 10);
  }, [suggestions, inputValue]);

  const showSuggestions = focused && (showListOnFocus || inputValue.trim() || filteredSuggestions.length > 0) && !disableInput;
  
  const addInclude = (val: string) => {
    const trimmed = val.trim();
    if (!trimmed) return;
    const matched = suggestions.find(s => s.label.toLowerCase() === trimmed.toLowerCase() || s.value.toLowerCase() === trimmed.toLowerCase());
    const finalVal = matched ? matched.value : trimmed;
    if (!included.includes(finalVal)) onIncluded([...included, finalVal]);
    setInputValue("");
    setFocused(false);
  };
  
  const addExclude = (val: string) => {
    const trimmed = val.trim();
    if (!trimmed) return;
    const matched = suggestions.find(s => s.label.toLowerCase() === trimmed.toLowerCase() || s.value.toLowerCase() === trimmed.toLowerCase());
    const finalVal = matched ? matched.value : trimmed;
    if (!excluded.includes(finalVal)) onExcluded([...excluded, finalVal]);
    setInputValue("");
    setFocused(false);
  };

  return (
    <div className="relative">
      <label className="block text-sm">
        <span className="mb-1.5 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 font-medium text-foreground">{icon}{label}</span>
        </span>
        <div className="relative">
          <input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 200)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && inputValue.trim()) {
                e.preventDefault();
                addInclude(inputValue);
              }
            }}
            placeholder={placeholder}
            disabled={disableInput}
            className="h-9 w-full rounded-md border border-border bg-card px-2.5 text-sm text-foreground outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-muted/40 disabled:text-muted-foreground"
          />
          {showListOnFocus && (
            <ChevronDown className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          )}
        </div>
      </label>
      {showSuggestions && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-lg animate-in fade-in slide-in-from-top-1">
          {filteredSuggestions.map((s) => {
            const isIncluded = included.includes(s.value);
            const isExcluded = excluded.includes(s.value);
            return (
              <button
                key={s.value}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); addInclude(s.value); }}
                className="group relative flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors hover:bg-accent focus:bg-accent outline-none"
              >
                <span className={`truncate font-medium ${isExcluded ? "line-through text-muted-foreground" : isIncluded ? "text-primary font-bold" : "text-foreground"}`}>
                  {s.label}
                </span>
                
                {/* Default count view (hidden on hover) */}
                <div className="flex group-hover:hidden items-center">
                  {s.count !== undefined && (
                    <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                      {s.count}
                    </span>
                  )}
                  {(isIncluded || isExcluded) && (
                    <span className={`ml-2 h-2 w-2 rounded-full ${isIncluded ? "bg-accent0" : "bg-red-500"}`} />
                  )}
                </div>

                {/* Hover action buttons */}
                <div className="hidden group-hover:flex items-center gap-1 absolute right-2 bg-accent pl-2">
                  <span 
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); addInclude(s.value); }}
                    className="flex items-center gap-1 rounded border border-primary/20 bg-card px-1.5 py-0.5 text-[10px] font-semibold text-primary hover:bg-accent/70 transition-colors"
                  >
                    <PlusCircle className="h-3 w-3" /> Include
                  </span>
                  <span 
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); addExclude(s.value); }}
                    className="flex items-center gap-1 rounded border border-red-200 bg-card px-1.5 py-0.5 text-[10px] font-semibold text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <MinusCircle className="h-3 w-3" /> Exclude
                  </span>
                </div>
              </button>
            );
          })}
          {filteredSuggestions.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">No matches found. Press enter to add anyway.</div>
          )}
        </div>
      )}
    </div>
  );
}

function TriRow({ label, value, onChange }: { label: string; value: Tri; onChange: (v: Tri) => void }) {
  const opt = (v: Tri, text: string) => (
    <button
      type="button"
      onClick={() => onChange(value === v ? "" : v)}
      className={`flex-1 px-2 py-1 text-xs transition-all ${
        value === v
          ? v === "no"
            ? "bg-red-600 text-white"
            : "bg-primary text-white"
          : "bg-white text-muted-foreground hover:bg-muted/50"
      }`}
    >
      {text}
    </button>
  );
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-sm text-foreground">
        <Filter className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> {label}
      </span>
      <div className="inline-flex w-36 overflow-hidden rounded-md border border-border">
        {opt("", "Any")}
        {opt("yes", "Yes")}
        {opt("no", "No")}
      </div>
    </div>
  );
}
