"use client";

import { createContext, useContext, useId, useState, type KeyboardEvent, type ReactNode } from "react";

// Lightweight, accessible tabs with arrow-key roving focus and the V2 underline style.

type TabsContextValue = {
  value: string;
  setValue: (v: string) => void;
  baseId: string;
};

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs(): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("Tabs.* must be used inside <Tabs>");
  return ctx;
}

export function Tabs({
  defaultValue,
  value: controlled,
  onValueChange,
  children,
  className = "",
}: {
  defaultValue: string;
  value?: string;
  onValueChange?: (v: string) => void;
  children: ReactNode;
  className?: string;
}) {
  const [internal, setInternal] = useState(defaultValue);
  const value = controlled ?? internal;
  const baseId = useId();
  const setValue = (v: string) => {
    if (controlled === undefined) setInternal(v);
    onValueChange?.(v);
  };
  return (
    <TabsContext.Provider value={{ value, setValue, baseId }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="tablist"
      className={`flex flex-wrap items-center gap-1 border-b border-border ${className}`}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  const { value: active, setValue, baseId } = useTabs();
  const selected = active === value;

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;

    const list = event.currentTarget.closest('[role="tablist"]');
    const tabs = Array.from(list?.querySelectorAll<HTMLButtonElement>('[role="tab"][data-tab-value]') ?? []);
    if (!tabs.length) return;

    event.preventDefault();
    const current = tabs.indexOf(event.currentTarget);
    const last = tabs.length - 1;
    const nextIndex =
      event.key === "Home" ? 0 :
      event.key === "End" ? last :
      event.key === "ArrowRight" ? (current + 1) % tabs.length :
      current <= 0 ? last : current - 1;
    const next = tabs[nextIndex];
    const nextValue = next?.dataset.tabValue;
    if (next && nextValue) {
      setValue(nextValue);
      next.focus();
    }
  }

  return (
    <button
      type="button"
      role="tab"
      id={`${baseId}-tab-${value}`}
      aria-selected={selected}
      aria-controls={`${baseId}-panel-${value}`}
      data-tab-value={value}
      tabIndex={selected ? 0 : -1}
      onClick={() => setValue(value)}
      onKeyDown={onKeyDown}
      className={`-mb-px cursor-pointer border-b-2 px-3 py-2 text-sm font-medium outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 ${
        selected
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, children, className = "" }: { value: string; children: ReactNode; className?: string }) {
  const { value: active, baseId } = useTabs();
  if (active !== value) return null;
  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${value}`}
      aria-labelledby={`${baseId}-tab-${value}`}
      className={className}
    >
      {children}
    </div>
  );
}
