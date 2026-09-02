"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FilterSidebar } from "../premium-filters/FilterSidebar";
import { FilterAccordion } from "../premium-filters/FilterAccordion";
import { FilterCombobox } from "../premium-filters/FilterCombobox";
import { ServedVerticalTree } from "../premium-filters/ServedVerticalTree";

type CompanyDirectoryFilterOptions = {
  countries: string[];
  industries: string[];
  factTokens: string[];
};

type LeadContextOptions = {
  accounts: Array<{
    id: string;
    name: string;
    projects: Array<{
      id: string;
      name: string;
      icpVersions: Array<{
        id: string;
        icpProfileName: string;
        versionNumber: number;
        status: string;
      }>;
    }>;
  }>;
};

const RESEARCH_STATUS_FILTERS = [
  "SUCCESS", "PARTIAL", "PARKED", "BLOCKED", "NO_WEBSITE", "NOT_RUN",
  "JS_RENDER_REQUIRED", "TIMEOUT", "OFFLINE", "INVALID_URL",
];

const QUALIFICATION_FILTERS = [
  "QUALIFIED", "COMPANY_QUALIFIED_NEEDS_CONTACT", "NEEDS_REVIEW", "UNQUALIFIED", "NOT_SCORED",
];

const WORKFLOW_STATUS_FILTERS = [
  "NEW", "ASSIGNED", "WORKING", "CONTACTED", "RESPONDED", "MEETING_BOOKED",
  "MEETING_DONE", "NURTURE", "NOT_INTERESTED", "BOUNCED", "SUPPRESSED",
  "DISQUALIFIED", "ARCHIVED",
];

function formatEnumLabel(value: string) {
  return value.split("_").map((part) => part.charAt(0) + part.slice(1).toLowerCase()).join(" ");
}

export function CompanyFilterSidebar({
  filterOptions,
  query,
}: {
  filterOptions: CompanyDirectoryFilterOptions;
  contextOptions: LeadContextOptions;
  query: Record<string, string>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = React.useTransition();

  const getArray = (key: string) => {
    const val = query[key];
    if (!val) return [];
    return val.split(",").map(v => v.trim()).filter(Boolean);
  };

  const updateArray = (key: string, arr: string[]) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page"); // reset pagination on filter change

    if (arr.length > 0) {
      params.set(key, arr.join(","));
    } else {
      params.delete(key);
    }

    startTransition(() => {
      router.push(`?${params.toString()}`);
    });
  };

  const addInclude = (key: string, id: string) => {
    const includes = getArray(key);
    const excludes = getArray(`exclude${key.charAt(0).toUpperCase() + key.slice(1)}`);

    if (!includes.includes(id)) {
      updateArray(key, [...includes, id]);
    }

    // Remove from exclude if present
    if (excludes.includes(id)) {
      const exKey = `exclude${key.charAt(0).toUpperCase() + key.slice(1)}`;
      updateArray(exKey, excludes.filter(x => x !== id));
    }
  };

  const addExclude = (key: string, id: string) => {
    const includes = getArray(key);
    const exKey = `exclude${key.charAt(0).toUpperCase() + key.slice(1)}`;
    const excludes = getArray(exKey);

    if (!excludes.includes(id)) {
      updateArray(exKey, [...excludes, id]);
    }

    // Remove from include if present
    if (includes.includes(id)) {
      updateArray(key, includes.filter(x => x !== id));
    }
  };

  const removeFilter = (key: string, id: string) => {
    const includes = getArray(key);
    const exKey = `exclude${key.charAt(0).toUpperCase() + key.slice(1)}`;
    const excludes = getArray(exKey);

    if (includes.includes(id)) {
      updateArray(key, includes.filter(x => x !== id));
    }
    if (excludes.includes(id)) {
      updateArray(exKey, excludes.filter(x => x !== id));
    }
  };

  const clearFilterCategory = (key: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    params.delete(key);
    params.delete(`exclude${key.charAt(0).toUpperCase() + key.slice(1)}`);
    startTransition(() => {
      router.push(`?${params.toString()}`);
    });
  };

  const clearAll = () => {
    const params = new URLSearchParams(searchParams.toString());
    const keysToRemove = [
      "qualification", "excludeQualification",
      "workflowStatus", "excludeWorkflowStatus",
      "country", "excludeCountry",
      "industry", "excludeIndustry", "servedVertical",
      "factToken", "excludeFactToken",
      "researchStatus", "excludeResearchStatus",
    ];
    for (const key of keysToRemove) {
      params.delete(key);
    }
    params.delete("page");
    startTransition(() => {
      router.push(`?${params.toString()}`);
    });
  };

  const getActiveCount = (key: string) => {
    const exKey = `exclude${key.charAt(0).toUpperCase() + key.slice(1)}`;
    return getArray(key).length + getArray(exKey).length;
  };

  const totalActive =
    getActiveCount("qualification") +
    getActiveCount("workflowStatus") +
    getActiveCount("country") +
    getActiveCount("industry") +
    getArray("servedVertical").length +
    getActiveCount("factToken") +
    getActiveCount("researchStatus");

  return (
    <FilterSidebar activeCount={totalActive} onClearAll={clearAll} className={isPending ? "opacity-70 pointer-events-none" : ""}>

      <FilterAccordion
        title="ICP assignment qualification"
        activeCount={getActiveCount("qualification")}
        onClear={() => clearFilterCategory("qualification")}
        defaultExpanded
      >
        <FilterCombobox
          options={QUALIFICATION_FILTERS.map(q => ({ id: q, label: formatEnumLabel(q) }))}
          includes={getArray("qualification")}
          excludes={getArray("excludeQualification")}
          onInclude={(id) => addInclude("qualification", id)}
          onExclude={(id) => addExclude("qualification", id)}
          onRemove={(id) => removeFilter("qualification", id)}
          placeholder="Search assignment qualification..."
        />
      </FilterAccordion>

      <FilterAccordion
        title="Workflow Status"
        activeCount={getActiveCount("workflowStatus")}
        onClear={() => clearFilterCategory("workflowStatus")}
      >
        <FilterCombobox
          options={WORKFLOW_STATUS_FILTERS.map(q => ({ id: q, label: formatEnumLabel(q) }))}
          includes={getArray("workflowStatus")}
          excludes={getArray("excludeWorkflowStatus")}
          onInclude={(id) => addInclude("workflowStatus", id)}
          onExclude={(id) => addExclude("workflowStatus", id)}
          onRemove={(id) => removeFilter("workflowStatus", id)}
          placeholder="Search status..."
        />
      </FilterAccordion>

      <FilterAccordion
        title="Industry"
        activeCount={getActiveCount("industry")}
        onClear={() => clearFilterCategory("industry")}
      >
        <FilterCombobox
          options={filterOptions.industries.map(q => ({ id: q, label: formatEnumLabel(q) }))}
          includes={getArray("industry")}
          excludes={getArray("excludeIndustry")}
          onInclude={(id) => addInclude("industry", id)}
          onExclude={(id) => addExclude("industry", id)}
          onRemove={(id) => removeFilter("industry", id)}
          placeholder="Search industry..."
        />
      </FilterAccordion>

      <FilterAccordion
        title="Industry & Vertical"
        activeCount={getArray("servedVertical").length}
        onClear={() => clearFilterCategory("servedVertical")}
      >
        <ServedVerticalTree
          selected={getArray("servedVertical")}
          onToggle={(key) => {
            if (getArray("servedVertical").includes(key)) removeFilter("servedVertical", key);
            else addInclude("servedVertical", key);
          }}
        />
      </FilterAccordion>

      <FilterAccordion
        title="Country"
        activeCount={getActiveCount("country")}
        onClear={() => clearFilterCategory("country")}
      >
        <FilterCombobox
          options={filterOptions.countries.map(q => ({ id: q, label: q }))}
          includes={getArray("country")}
          excludes={getArray("excludeCountry")}
          onInclude={(id) => addInclude("country", id)}
          onExclude={(id) => addExclude("country", id)}
          onRemove={(id) => removeFilter("country", id)}
          placeholder="Search country..."
        />
      </FilterAccordion>

      <FilterAccordion
        title="Intelligence Status"
        activeCount={getActiveCount("researchStatus")}
        onClear={() => clearFilterCategory("researchStatus")}
      >
        <FilterCombobox
          options={RESEARCH_STATUS_FILTERS.map(q => ({ id: q, label: formatEnumLabel(q) }))}
          includes={getArray("researchStatus")}
          excludes={getArray("excludeResearchStatus")}
          onInclude={(id) => addInclude("researchStatus", id)}
          onExclude={(id) => addExclude("researchStatus", id)}
          onRemove={(id) => removeFilter("researchStatus", id)}
          placeholder="Search status..."
        />
      </FilterAccordion>

      <FilterAccordion
        title="Fact Tokens"
        activeCount={getActiveCount("factToken")}
        onClear={() => clearFilterCategory("factToken")}
      >
        <FilterCombobox
          options={filterOptions.factTokens.map(q => ({ id: q, label: q }))}
          includes={getArray("factToken")}
          excludes={getArray("excludeFactToken")}
          onInclude={(id) => addInclude("factToken", id)}
          onExclude={(id) => addExclude("factToken", id)}
          onRemove={(id) => removeFilter("factToken", id)}
          placeholder="Search facts..."
        />
      </FilterAccordion>

    </FilterSidebar>
  );
}
