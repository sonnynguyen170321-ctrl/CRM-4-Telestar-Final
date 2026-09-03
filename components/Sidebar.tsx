'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  Repeat,
  FileText,
  BarChart3,
  Settings,
  Target,
  TrendingUp,
  Cpu,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  Shield,
  Inbox,
  CalendarDays,
  Funnel,
  Database,
  Upload,
  Route,
  FileBarChart,
  ShieldCheck,
  Radar,
} from 'lucide-react';
import { useAppContext } from '@/context/AppContext';

interface SidebarProps {
  userRole?: 'director' | 'floor_manager' | 'team_lead' | 'sdr' | 'leadgen_manager' | 'leadgen';
}

const EXPANDED_KEY = 'telestar-sidebar-expanded';
/** 216px, not 192px: "AI Command Center" and "Re-engagement" both truncated at the old width. */
const W_EXPANDED = '216px';
const W_COLLAPSED = '56px';

const isLeadgenUser = (role: string) => role === 'leadgen' || role === 'leadgen_manager';

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
}

/**
 * Navigation is grouped by what the user is *doing*, not by which module a route belongs to.
 *
 * The flat sixteen-item list this replaced gave Dashboard, Templates and Email Health identical
 * visual weight, so nothing read as the starting point. Grouping costs no routing change — every
 * href below is exactly the one that was there before.
 */
interface NavGroup {
  label: string;
  items: NavItem[];
}

export default function Sidebar(props: SidebarProps) {
  return (
    <Suspense fallback={<aside className="fixed inset-y-0 left-0 z-20 flex flex-col glass-sidebar border-r border-sidebar-border w-14" />}>
      <SidebarInner {...props} />
    </Suspense>
  );
}

function SidebarInner({ userRole = 'sdr' }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { currentUser, isManager, isLeadgenManager, isSessionLoading } = useAppContext();

  const [expanded, setExpanded] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      const stored = localStorage.getItem(EXPANDED_KEY);
      return stored === null ? true : stored === 'true';
    } catch {
      return true;
    }
  });

  // Sync CSS variable on load and change
  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-w', expanded ? W_EXPANDED : W_COLLAPSED);
  }, [expanded]);

  const toggleExpanded = () => {
    setExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(EXPANDED_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const fullPath = pathname + (searchParams?.toString() ? `?${searchParams.toString()}` : '');

  // `userRole` falls back to 'sdr' until the session resolves, so the footer used to announce
  // "Current role: sdr" to a Director mid-load, and print "sdr" under "Loading...". Claim
  // nothing about the role until the session has actually answered.
  const footerAriaLabel = currentUser
    ? `Logged in as ${[currentUser.firstName, currentUser.lastName].filter(Boolean).join(' ')}, role: ${userRole}`
    : isSessionLoading
      ? 'Loading account'
      : `Current role: ${userRole}`;

  const navGroups: NavGroup[] = isLeadgenUser(userRole)
    ? [
        {
          label: 'Leadgen',
          items: [
            { name: 'Leadgen Workspace', href: '/leadgen', icon: Target },
            { name: 'Research', href: '/research', icon: Radar },
            ...(isLeadgenManager
              ? [
                  { name: 'Internal Database', href: '/leadgen-manager?tab=pool', icon: Database },
                  { name: 'Import Center', href: '/leadgen-manager?tab=import', icon: Upload },
                  { name: 'Qualification Queue', href: '/leadgen-manager?tab=qualify', icon: Target },
                  { name: 'Campaign Routing', href: '/leadgen-manager?tab=routing', icon: Route },
                  { name: 'Export Center', href: '/leadgen-manager?tab=export', icon: FileText },
                ]
              : []),
          ],
        },
        ...(isLeadgenManager
          ? [
              {
                label: 'Insights',
                items: [
                  { name: 'Team Performance', href: '/leadgen-manager?tab=team', icon: TrendingUp },
                  { name: 'Source Performance', href: '/leadgen-manager?tab=sources', icon: BarChart3 },
                  { name: 'Client Reports', href: '/client-reports', icon: FileBarChart },
                ],
              },
            ]
          : []),
        { label: 'System', items: [{ name: 'Settings', href: '/settings', icon: Settings }] },
      ]
    : [
        {
          label: 'Overview',
          items: [
            { name: 'Dashboard', href: '/', icon: LayoutDashboard },
            // The operating-model board: what AI is doing, what needs a human, what happens next.
            { name: 'AI Command Center', href: '/ai', icon: Cpu },
          ],
        },
        {
          label: 'Revenue',
          items: [
            { name: 'Leads', href: '/leads', icon: Users },
            { name: 'Opportunities', href: '/opportunities', icon: Funnel },
            { name: 'Meetings', href: '/meetings', icon: CalendarDays },
            { name: 'Sequences', href: '/sequences', icon: Repeat },
          ],
        },
        {
          label: 'Work',
          items: [
            { name: 'Inbox', href: '/inbox', icon: Inbox },
            { name: 'Templates', href: '/templates', icon: FileText },
            { name: 'Automation', href: '/automation', icon: Cpu },
          ],
        },
        {
          label: 'Insights',
          items: [
            { name: 'Performance', href: '/sequences/performance', icon: TrendingUp },
            { name: 'Client Reports', href: '/client-reports', icon: FileBarChart },
            ...(isManager ? [{ name: 'Team View', href: '/team', icon: BarChart3 }] : []),
          ],
        },
        {
          label: 'System',
          items: [
            ...(userRole === 'director' ? [{ name: 'Director', href: '/director', icon: Briefcase }] : []),
            ...(userRole === 'director' || userRole === 'floor_manager'
              ? [{ name: 'Admin', href: '/admin', icon: Shield }]
              : []),
            // Everyone gets a link: managers see their whole pod, SDRs see only
            // their own mailbox (read-only) — the API scopes it either way.
            { name: 'Email Health', href: '/email-health', icon: ShieldCheck },
            { name: 'Settings', href: '/settings', icon: Settings },
          ],
        },
      ];

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-20 flex flex-col glass-sidebar border-r border-sidebar-border text-sidebar-text sidebar-transition ${expanded ? 'w-[216px]' : 'w-14'}`}
    >
      {/* Brand Header */}
      <div className="flex items-center gap-3 px-3 py-5 border-b border-sidebar-border h-16 overflow-hidden">
        <div className="flex items-center justify-center bg-brand-red/10 rounded-lg p-1.5 text-brand-red flex-shrink-0">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-6 h-6 text-brand-red"
          >
            <path d="M12 2L14.73 8.35L21.6 9L16.42 13.56L17.95 20.3L12 16.72L6.05 20.3L7.58 13.56L2.4 9L9.27 8.35L12 2Z" />
            <path
              d="M12 17.5C12 17.5 14.5 13 14.5 11C14.5 9 12 6.5 12 6.5C12 6.5 9.5 9 9.5 11C9.5 13 12 17.5 12 17.5Z"
              fill="url(#flameGrad)"
              opacity="0.9"
            />
            <defs>
              <linearGradient id="flameGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#E8611A" />
                <stop offset="100%" stopColor="#FEDD44" />
              </linearGradient>
            </defs>
          </svg>
        </div>
        {expanded && (
          <span className="font-display font-extrabold text-base tracking-wide text-brand-red whitespace-nowrap">
            TELESTAR
          </span>
        )}
      </div>

      {/* Navigation List */}
      <nav className="flex-1 px-2 py-3 overflow-y-auto overflow-x-hidden">
        {navGroups
          .filter((group) => group.items.length > 0)
          .map((group, groupIndex) => (
            <div key={group.label} className={groupIndex === 0 ? '' : 'mt-5'}>
              {/* Collapsed, a rule carries the grouping that the label carries when expanded. */}
              {expanded ? (
                <p className="px-3 pb-1.5 type-micro text-sidebar-text-muted uppercase tracking-wider">
                  {group.label}
                </p>
              ) : (
                groupIndex > 0 && <hr className="mx-3 mb-2 border-sidebar-border" />
              )}

              <div className="space-y-1">
                {group.items.map((item) => {
                  const isActive =
                    fullPath === item.href || (item.href === '/leadgen-manager' && pathname === '/leadgen-manager');
                  const Icon = item.icon;

                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      aria-current={isActive ? 'page' : undefined}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg type-meta transition-colors group relative focus-ring ${
                        isActive
                          ? 'bg-brand-red text-white'
                          : 'text-sidebar-text-muted hover:bg-sidebar-border hover:text-sidebar-text'
                      }`}
                    >
                      {isActive && <span className="sidebar-beam-indicator" aria-hidden="true" />}
                      <Icon
                        aria-hidden="true"
                        className={`w-[18px] h-[18px] flex-shrink-0 ${
                          isActive ? 'text-white' : 'text-sidebar-text-muted group-hover:text-sidebar-text'
                        }`}
                      />

                      {expanded ? (
                        <span className="truncate">{item.name}</span>
                      ) : (
                        <span
                          role="tooltip"
                          className="absolute left-14 hidden group-hover:flex items-center bg-brand-dark text-white type-micro py-1 px-2.5 rounded border border-sidebar-border whitespace-nowrap shadow-md z-30 pointer-events-none"
                        >
                          {item.name}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
      </nav>

      {/* Collapse toggle */}
      <div className="px-2 pb-2">
        <button
          onClick={toggleExpanded}
          className="flex items-center justify-center w-8 h-8 rounded-lg mx-auto text-sidebar-text-muted hover:text-sidebar-text hover:bg-sidebar-border transition-colors"
          title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {expanded ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </button>
      </div>

      {/* User Footer */}
      <div
        className="p-3 border-t border-sidebar-border flex items-center gap-3 overflow-hidden"
        aria-label={footerAriaLabel}
      >
        {/* Tinted rather than grey: the orange initials measured 4.18:1 on the
            grey chip, just under AA. On this near-white tint they clear 5.2:1,
            and it matches the topbar avatar. */}
        <div className="w-9 h-9 rounded-full bg-brand-orange/10 flex items-center justify-center font-bold text-xs text-brand-orange-text uppercase flex-shrink-0">
          {currentUser
            ? `${currentUser.firstName[0] || ''}${currentUser.lastName[0] || ''}`
            : isSessionLoading
            ? ''
            : userRole === 'director'
            ? 'SN'
            : '??'}
        </div>
        {expanded && (
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-semibold text-sidebar-text truncate">
              {currentUser
                ? [currentUser.firstName, currentUser.lastName].filter(Boolean).join(' ')
                : 'Loading...'}
            </span>
            <span className="text-[10px] text-sidebar-text-muted tracking-tighter truncate uppercase">
              {isSessionLoading && !currentUser
                ? ' '
                : isLeadgenManager
                ? 'leadgen manager'
                : userRole.replace('_', ' ')}
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}
