'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAppContext } from '@/context/AppContext';
import {
  Database, Mail, Upload, Activity,
  LayoutDashboard, Users, Network, Building2, Briefcase, ScrollText,
  ArrowLeftRight,
} from 'lucide-react';

type Tab = { name: string; href: string; icon: typeof Database };

/**
 * Two groups: the people-ops console added by the Admin Control Center, and the
 * pre-existing system-ops tabs. Both are gated to director|floor_manager by the
 * effect below and by `proxy.ts` at the edge.
 */
const ADMIN_SECTIONS: { label: string; items: Tab[] }[] = [
  {
    label: 'People & Accounts',
    items: [
      { name: 'Overview', href: '/admin', icon: LayoutDashboard },
      { name: 'People', href: '/admin/users', icon: Users },
      { name: 'Teams', href: '/admin/teams', icon: Network },
      { name: 'Campaigns', href: '/admin/campaigns', icon: Briefcase },
      { name: 'Clients', href: '/admin/clients', icon: Building2 },
      { name: 'Transfer Work', href: '/admin/transfer-work', icon: ArrowLeftRight },
      { name: 'Audit Log', href: '/admin/audit', icon: ScrollText },
    ],
  },
  {
    label: 'System',
    items: [
      { name: 'Job Runs', href: '/admin/jobs', icon: Database },
      { name: 'Outbound Emails', href: '/admin/outbound', icon: Mail },
      { name: 'CSV Imports', href: '/admin/imports', icon: Upload },
      { name: 'Worker Health', href: '/admin/worker-health', icon: Activity },
    ],
  },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { currentRole, isSessionLoading } = useAppContext();
  const router = useRouter();
  const pathname = usePathname();

  // Fence admin routes to director or floor_manager roles only.
  useEffect(() => {
    if (!isSessionLoading && currentRole && currentRole !== 'director' && currentRole !== 'floor_manager') {
      router.replace('/');
    }
  }, [isSessionLoading, currentRole, router]);

  if (isSessionLoading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[50vh]">
        <div className="text-text-muted text-xs font-mono animate-pulse">Checking credentials...</div>
      </div>
    );
  }

  if (currentRole !== 'director' && currentRole !== 'floor_manager') {
    return null;
  }

  return (
    <div className="space-y-6 flex-1 flex flex-col">
      {/* Header */}
      <div className="page-hero">
        <h1 className="font-display font-extrabold text-2xl text-text-primary">Admin Control Center</h1>
        <p className="text-sm text-text-muted mt-0.5 prose-measure">
          Manage people, teams, clients, campaign membership and work ownership — plus background
          worker queues, delivery logs and infrastructure health.
        </p>
      </div>

      {/* Admin Sub-navigation */}
      <nav aria-label="Admin sections" className="space-y-2 shrink-0">
        {ADMIN_SECTIONS.map((section) => (
          <div key={section.label} className="flex items-center gap-3 flex-wrap">
            <span className="type-micro font-semibold uppercase tracking-wide text-text-muted w-32 shrink-0">
              {section.label}
            </span>
            <div className="flex border border-card-border bg-bg-main/25 rounded-xl p-1.5 gap-1 flex-wrap">
              {section.items.map((tab) => {
                // Overview lives at the group root, so it needs an exact match —
                // a prefix test would light it on every child route.
                const isActive =
                  tab.href === '/admin'
                    ? pathname === '/admin'
                    : pathname === tab.href || pathname.startsWith(tab.href + '/');
                const Icon = tab.icon;

                return (
                  <Link
                    key={tab.name}
                    href={tab.href}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg transition-all ${
                      isActive
                        ? 'bg-brand-red text-white shadow-md'
                        : 'text-text-muted hover:text-text-primary hover:bg-card-border/30'
                    }`}
                  >
                    <Icon className="w-4 h-4" aria-hidden="true" />
                    <span>{tab.name}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Tab Content */}
      <div className="flex-1 flex flex-col min-h-0">
        {children}
      </div>
    </div>
  );
}
