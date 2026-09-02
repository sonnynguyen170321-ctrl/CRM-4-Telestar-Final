import Link from "next/link";
import { BrainCircuit, LogOut, Search, UploadCloud, UserCircle, Command } from "lucide-react";

import { ROUTES } from "@/lib/v2/routes";
import { NotificationBell } from "@/components/v2/notifications/NotificationBell";
import { ThemeToggle } from "@/components/shared/ThemeToggle";

export function TopBar() {
  return (
    <header className="sticky top-0 z-30 border-b border-hairline bg-glass backdrop-blur-xl px-4 py-3 sm:px-6 lg:px-8 shadow-premium">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <form action={ROUTES.WORKSPACE_LEADS} className="min-w-0 flex-1 max-w-3xl">
          <label className="relative flex items-center group">
            <span className="sr-only">Global search</span>
            <Search
              className="absolute left-3.5 h-4 w-4 text-muted-foreground transition-colors group-focus-within:text-primary"
              aria-hidden="true"
            />
            <input
              name="search"
              type="search"
              placeholder="Search across accounts, projects, ICPs, companies, contacts, leads..."
              className="h-10 w-full rounded-xl border border-hairline bg-surface-raised pl-10 pr-12 text-[13px] font-medium text-foreground outline-none transition-all duration-300 placeholder:text-muted-foreground focus:bg-surface focus:border-ring/50 focus:ring-4 focus:ring-ring/10 hover:bg-surface hover:border-hairline"
            />
            <div className="absolute right-3 hidden sm:flex items-center gap-1">
              <kbd className="inline-flex h-5 items-center gap-1 rounded border border-hairline bg-surface px-1.5 font-mono text-[10px] font-medium text-muted-foreground shadow-sm">
                <Command className="h-3 w-3" /> K
              </kbd>
            </div>
          </label>
        </form>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="hidden sm:flex h-10 items-center gap-2 rounded-xl border border-hairline bg-surface px-3 text-[13px] text-foreground shadow-sm">
            <span className="flex h-5 w-5 items-center justify-center rounded-lg bg-primary text-[10px] font-bold text-primary-foreground shadow-inner">
              TS
            </span>
            <span className="font-semibold tracking-tight">TeleStar</span>
          </div>

          <Link
            href={ROUTES.INGESTION_UPLOADS}
            className="group inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-hairline bg-surface px-3.5 text-[13px] font-semibold text-foreground shadow-sm transition-all duration-300 hover:bg-surface-raised hover:border-hairline hover:shadow"
          >
            <UploadCloud className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" aria-hidden="true" />
            Upload Data
          </Link>

          <Link
            href={ROUTES.REPORTS}
            className="group relative inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-primary px-4 text-[13px] font-semibold text-primary-foreground shadow-md shadow-primary/20 transition-all duration-300 hover:bg-primary/90 hover:shadow-lg"
          >
            <div className="absolute inset-0 rounded-xl bg-white/20 opacity-0 transition-opacity group-hover:opacity-100" />
            <BrainCircuit className="h-4 w-4 relative z-10" aria-hidden="true" />
            <span className="relative z-10">Run AI Insight</span>
          </Link>

          <div className="h-10 flex items-center justify-center">
            <ThemeToggle />
          </div>

          <div className="h-10 flex items-center justify-center">
            <NotificationBell />
          </div>

          <Link
            href={ROUTES.SETTINGS}
            className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border border-hairline bg-surface text-muted-foreground shadow-sm transition-all duration-300 hover:bg-surface-raised hover:text-primary hover:border-hairline"
            aria-label="Account settings"
          >
            <UserCircle className="h-5 w-5" aria-hidden="true" />
          </Link>

          <a
            href="/v2/logout"
            className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border border-hairline bg-surface text-muted-foreground shadow-sm transition-all duration-300 hover:bg-surface-raised hover:text-primary hover:border-hairline"
            aria-label="Log out"
            title="Log out"
          >
            <LogOut className="h-5 w-5" aria-hidden="true" />
          </a>
        </div>
      </div>
    </header>
  );
}
