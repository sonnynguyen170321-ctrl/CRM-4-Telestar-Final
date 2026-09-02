"use client";

import type { ReactNode } from "react";

import { useLeadDrawer, type LeadDrawerSnapshot } from "./LeadDrawerProvider";

// P5: a leaf trigger inside the server-rendered table. Clicking opens the client drawer
// instantly from the row snapshot (the table stays a server component — only this button
// is client, like LeadRowCheckbox). No navigation; the provider hydrates via the API.

export function LeadRowOpen({
  snapshot,
  className,
  children,
}: {
  snapshot: LeadDrawerSnapshot;
  className?: string;
  children: ReactNode;
}) {
  const { open } = useLeadDrawer();
  return (
    <button type="button" onClick={() => open(snapshot)} className={className}>
      {children}
    </button>
  );
}
