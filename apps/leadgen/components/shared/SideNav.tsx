"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Building2,
  Bot,
  ClipboardCheck,
  ClipboardList,
  FileUp,
  Globe,
  Library,
  LayoutDashboard,
  Mail,
  Radar,
  Settings,
  ShieldCheck,
  Target,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { ROUTES } from "@/lib/v2/routes";

const navItems = [
  {
    label: "Workspace",
    items: [
      { href: ROUTES.HOME, label: "Home", icon: LayoutDashboard },
      { href: ROUTES.WORKSPACE_LEADS, label: "Leads command center", icon: Target },
      { href: `${ROUTES.WORKSPACE_ACCOUNTS}?view=projects`, label: "Accounts & projects", icon: Building2 },
      { href: ROUTES.ICP_LIBRARY, label: "ICP library", icon: Library },
    ],
  },
  {
    label: "Index",
    items: [
      { href: ROUTES.CRM_COMPANIES, label: "Companies", icon: Globe },
      { href: ROUTES.CRM_CONTACTS, label: "Contacts", icon: Users },
      { href: ROUTES.RESEARCH, label: "Intelligence", icon: Radar },
    ],
  },
  {
    label: "Data Engine",
    items: [
      { href: ROUTES.INGESTION_UPLOADS, label: "Uploads", icon: FileUp },
      { href: ROUTES.INGESTION_JOBS, label: "Jobs Pipeline", icon: ClipboardList },
      { href: ROUTES.ACTIVITY_RECAPS, label: "Activity recaps", icon: ClipboardCheck },
      { href: ROUTES.REVIEWS, label: "Review queue", icon: ClipboardCheck },
    ],
  },
  {
    label: "Outreach",
    items: [
      { href: ROUTES.OUTREACH_CAMPAIGNS, label: "Campaigns", icon: Target },
      { href: ROUTES.OUTREACH_TEMPLATES, label: "Templates", icon: Mail },
      { href: ROUTES.OUTREACH_SENDERS, label: "Senders", icon: BarChart3 },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: ROUTES.AI, label: "AI engine", icon: Bot },
      { href: ROUTES.SETTINGS, label: "Settings", icon: Settings },
      { href: ROUTES.ADMIN, label: "Admin", icon: ShieldCheck },
    ],
  },
];

export function SideNav() {
  const pathname = usePathname();

  return (
    <aside className="hidden border-r border-hairline bg-sidebar/95 backdrop-blur-3xl lg:fixed lg:inset-y-0 lg:flex lg:w-64 lg:flex-col shadow-2xl z-50">
      {/* Brand Header */}
      <div className="flex h-16 items-center px-6 border-b border-hairline/50">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-blue-600 shadow-lg shadow-primary/20 text-sm font-bold text-primary-foreground">
            L
          </div>
          <div>
            <div className="text-[15px] font-bold text-sidebar-foreground tracking-tight leading-none">
              Leadger
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse" />
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">v2.0</span>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Groups */}
      <nav className="flex-1 space-y-6 overflow-y-auto px-4 py-6 scrollbar-hide" aria-label="V2 workflow navigation">
        {navItems.map((group) => (
          <div key={group.label} className="flex flex-col gap-1">
            <div className="px-3 pb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "group flex h-9 cursor-pointer items-center gap-3 rounded-xl px-3 text-[13px] font-medium transition-all duration-300",
                      isActive
                        ? "bg-primary/10 text-primary shadow-sm"
                        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-4 w-4 transition-transform duration-300 group-hover:scale-110",
                        isActive ? "text-primary" : "text-muted-foreground group-hover:text-sidebar-accent-foreground"
                      )}
                      aria-hidden="true"
                    />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer Area */}
      <div className="border-t border-border/50 p-4 bg-sidebar/80 backdrop-blur-md">
        <div className="flex items-center gap-3 rounded-xl bg-card p-3 border border-border/50">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <Bot className="h-4 w-4 text-primary" aria-hidden="true" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-sidebar-foreground">AI Advisory</span>
            <span className="text-[10px] text-muted-foreground">Active engine</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
