"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

// Client-side selection for the company directory. Mirrors the lead workspace pattern:
// a provider holds the set of selected companyIds; only the leaf checkboxes + the bulk
// bar are client, so the heavy server-rendered table stays on the server.

type CompanySelectionValue = {
  selected: Set<string>;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  setMany: (ids: string[], next: boolean) => void;
  clear: () => void;
  count: number;
};

const CompanySelectionContext = createContext<CompanySelectionValue | null>(null);

export function CompanySelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setMany = useCallback((ids: string[], next: boolean) => {
    setSelected((prev) => {
      const updated = new Set(prev);
      for (const id of ids) {
        if (next) updated.add(id);
        else updated.delete(id);
      }
      return updated;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const value = useMemo<CompanySelectionValue>(
    () => ({
      selected,
      isSelected: (id: string) => selected.has(id),
      toggle,
      setMany,
      clear,
      count: selected.size,
    }),
    [selected, toggle, setMany, clear]
  );

  return <CompanySelectionContext.Provider value={value}>{children}</CompanySelectionContext.Provider>;
}

export function useCompanySelection(): CompanySelectionValue {
  const ctx = useContext(CompanySelectionContext);
  if (!ctx) throw new Error("useCompanySelection must be used within a CompanySelectionProvider");
  return ctx;
}

const checkboxCls =
  "h-4 w-4 cursor-pointer rounded border-border text-primary transition-colors focus:ring-2 focus:ring-primary/20 focus:ring-offset-1";

export function CompanyRowCheckbox({ companyId }: { companyId: string }) {
  const { isSelected, toggle } = useCompanySelection();
  return (
    <input
      type="checkbox"
      className={checkboxCls}
      checked={isSelected(companyId)}
      onChange={() => toggle(companyId)}
      aria-label="Select company"
    />
  );
}

export function CompanySelectAllCheckbox({ ids }: { ids: string[] }) {
  const { selected, setMany } = useCompanySelection();
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  const someSelected = ids.some((id) => selected.has(id));
  return (
    <input
      type="checkbox"
      className={checkboxCls}
      checked={allSelected}
      ref={(el) => {
        if (el) el.indeterminate = someSelected && !allSelected;
      }}
      onChange={() => setMany(ids, !allSelected)}
      aria-label="Select all companies on this page"
    />
  );
}
