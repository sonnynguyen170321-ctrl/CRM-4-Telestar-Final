"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useLeadDrawer } from "./LeadDrawerProvider";
import { LeadDrawerHost } from "./LeadDrawerHost";

export function LeadWorkspaceSplitView({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 min-h-0 overflow-hidden relative">
      <div className="flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden">
        {children}
      </div>
      <LeadDrawerHost />
    </div>
  );
}
