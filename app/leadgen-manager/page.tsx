'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  LayoutDashboard,
  Database,
  Upload,
  Target,
  Route,
  FileText,
  TrendingUp,
  BarChart3,
} from 'lucide-react';
import { useAppContext } from '@/context/AppContext';
import OverviewTab from '@/components/leadgen-manager/OverviewTab';
import PoolBrowser from '@/components/leadgen-manager/PoolBrowser';
import ExportTab from '@/components/leadgen-manager/ExportTab';
import TeamTab from '@/components/leadgen-manager/TeamTab';
import SourcesTab from '@/components/leadgen-manager/SourcesTab';

const CSVImportModal = dynamic(() => import('@/components/CSVImportModal'), { ssr: false });

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'pool', label: 'Internal Database', icon: Database },
  { id: 'qualify', label: 'Qualification Queue', icon: Target },
  { id: 'routing', label: 'Campaign Routing', icon: Route },
  { id: 'export', label: 'Export Center', icon: FileText },
  { id: 'team', label: 'Team Performance', icon: TrendingUp },
  { id: 'sources', label: 'Source Performance', icon: BarChart3 },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function LeadgenManagerPage() {
  return (
    <Suspense fallback={null}>
      <LeadgenManagerPageInner />
    </Suspense>
  );
}

function LeadgenManagerPageInner() {
  const { currentRole, isSessionLoading } = useAppContext();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showImport, setShowImport] = useState(false);

  const tabParam = searchParams.get('tab');
  const activeTab: TabId = TABS.some((t) => t.id === tabParam) ? (tabParam as TabId) : 'overview';

  const canAccessLeadgenManager =
    currentRole === 'leadgen_manager' ||
    currentRole === 'director' ||
    currentRole === 'floor_manager';

  useEffect(() => {
    if (!isSessionLoading && !canAccessLeadgenManager) {
      router.replace('/');
    }
  }, [isSessionLoading, canAccessLeadgenManager, router]);

  if (isSessionLoading || !canAccessLeadgenManager) return null;

  const switchTab = (id: TabId) => {
    const href = id === 'overview' ? '/leadgen-manager' : `/leadgen-manager?tab=${id}`;
    router.replace(href);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-card-border bg-background flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
            <Database className="w-4 h-4 text-purple-400" />
          </div>
          <div>
            <h1 className="font-display font-bold text-sm text-text-primary">Leadgen Manager Console</h1>
            <p className="text-[10px] text-text-muted uppercase">
              Internal database · Enrich · Qualify · Route · Convert
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/35 text-purple-300 text-xs font-semibold rounded-lg transition-all active:scale-95"
          >
            <Upload className="w-3.5 h-3.5" />
            Import to Internal DB
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="px-6 py-2 border-b border-card-border bg-background flex items-center gap-2 flex-shrink-0 overflow-x-auto">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-purple-500/15 text-purple-300 border border-purple-500/20'
                  : 'text-text-secondary hover:text-text-primary border border-transparent'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto p-6">
        {activeTab === 'overview' && <OverviewTab />}
        {activeTab === 'pool' && <PoolBrowser mode="pool" />}

        {activeTab === 'qualify' && <PoolBrowser mode="qualify" />}
        {activeTab === 'routing' && <PoolBrowser mode="routing" />}
        {activeTab === 'export' && <ExportTab />}
        {activeTab === 'team' && <TeamTab />}
        {activeTab === 'sources' && <SourcesTab />}
      </div>

      {showImport && (
        <CSVImportModal
          targetType="pool"
          onClose={() => setShowImport(false)}
          onSuccess={() => {
            setShowImport(false);
          }}
        />
      )}
    </div>
  );
}
