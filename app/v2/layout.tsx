import type { ReactNode } from "react";
import { GlobalJobWatcher } from "@/components/v2/shell/GlobalJobWatcher";
import { CommandPalette } from "@/components/v2/shell/CommandPalette";

// The shared app shell (SideNav + TopBar) is provided once by the root layout
// (app/layout.tsx). The Account/Project/ICP ContextBar is no longer rendered
// here — it only belongs on the lead workspace, so it lives in
// app/v2/leads/layout.tsx. Every other /v2 surface gets its full height back.
export default function V2Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <GlobalJobWatcher />
      <CommandPalette />
      {children}
    </>
  );
}
