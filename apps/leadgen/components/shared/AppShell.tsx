"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { SideNav } from "@/components/shared/SideNav";
import { TopBar } from "@/components/shared/TopBar";
import { PageTransition } from "@/components/shared/PageTransition";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

type AppShellProps = {
  children: ReactNode;
  contextBar?: ReactNode;
};

const HIDDEN_PATHS = new Set(["/v2/login", "/v2/logout"]);

export function AppShell({ children, contextBar }: AppShellProps) {
  const pathname = usePathname();
  const hideShell = HIDDEN_PATHS.has(pathname);

  if (hideShell) {
    return (
      <div className="v2-theme min-h-screen bg-background text-foreground">
        {children}
      </div>
    );
  }

  return (
    <div className="v2-theme min-h-screen bg-background text-foreground selection:bg-primary/20">
      <SideNav />
      <div className="min-h-screen lg:pl-64 flex flex-col">
        <TopBar />
        {contextBar}
        <main
          className={cn(
            "flex-1 px-4 py-5 sm:px-6 lg:px-8",
            "bg-slate-100/60 dark:bg-slate-950"
          )}
        >
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
      <Toaster position="bottom-right" />
    </div>
  );
}
