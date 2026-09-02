"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

// Client-side selection state for the lead workspace. A provider holds the set of
// selected leadAssignmentIds; the row + header checkboxes and the bulk action bar
// consume it. The server-rendered table stays server-rendered — only these leaf
// controls are client — which keeps the heavy badges/score rings on the server.

type LeadSelectionValue = {
  selected: Set<string>;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  setMany: (ids: string[], next: boolean) => void;
  clear: () => void;
  count: number;
};

const LeadSelectionContext = createContext<LeadSelectionValue | null>(null);

export function LeadSelectionProvider({ children }: { children: ReactNode }) {
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

  const value = useMemo<LeadSelectionValue>(
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

  return <LeadSelectionContext.Provider value={value}>{children}</LeadSelectionContext.Provider>;
}

export function useLeadSelection(): LeadSelectionValue {
  const ctx = useContext(LeadSelectionContext);
  if (!ctx) throw new Error("useLeadSelection must be used within a LeadSelectionProvider");
  return ctx;
}

const checkboxCls =
  "h-4 w-4 cursor-pointer rounded border-border text-primary transition-colors focus:ring-2 focus:ring-primary/20 focus:ring-offset-1";

export function LeadRowCheckbox({ leadAssignmentId }: { leadAssignmentId: string }) {
  const { isSelected, toggle } = useLeadSelection();
  return (
    <input
      type="checkbox"
      className={checkboxCls}
      checked={isSelected(leadAssignmentId)}
      onChange={() => toggle(leadAssignmentId)}
      aria-label="Select lead"
    />
  );
}

export function LeadSelectAllCheckbox({ ids }: { ids: string[] }) {
  const { selected, setMany } = useLeadSelection();
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
      aria-label="Select all leads on this page"
    />
  );
}
