'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  FileBarChart,
  Plus,
  Search,
  Filter,
  Eye,
  Link2,
  Download,
  Calendar,
  Building2,
  CheckCircle2,
  Clock,
  Archive,
  MoreVertical,
  ExternalLink,
  Trash2,
} from 'lucide-react';
import { ClientReportListItem, ReportStatus, ReportAudience } from '@/lib/client-reports/types';
import CreateClientReportModal from './CreateClientReportModal';
import ClientReportShareModal from './ClientReportShareModal';

export default function ClientReportList() {
  const [reports, setReports] = useState<ClientReportListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [audienceFilter, setAudienceFilter] = useState<string>('all');
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // Share Modal State
  const [shareTarget, setShareTarget] = useState<{ id: string; title: string } | null>(null);

  const fetchReports = async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (statusFilter !== 'all') query.set('status', statusFilter);
      if (audienceFilter !== 'all') query.set('audience', audienceFilter);

      const res = await fetch(`/api/client-reports?${query.toString()}`);
      const data = await res.json();
      if (res.ok) {
        setReports(data.reports || []);
      }
    } catch {
      // Ignored
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, [statusFilter, audienceFilter]);

  const filteredReports = reports.filter((r) => {
    const term = search.toLowerCase();
    return (
      r.title.toLowerCase().includes(term) ||
      r.clientName.toLowerCase().includes(term) ||
      (r.campaignName && r.campaignName.toLowerCase().includes(term))
    );
  });

  const getStatusBadge = (status: ReportStatus) => {
    switch (status) {
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3 h-3" /> Approved
          </span>
        );
      case 'shared':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
            <Link2 className="w-3 h-3" /> Shared
          </span>
        );
      case 'archived':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-card-border/40 text-muted-foreground border border-card-border">
            <Archive className="w-3 h-3" /> Archived
          </span>
        );
      case 'draft':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            <Clock className="w-3 h-3" /> Draft
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-text-primary flex items-center gap-2">
            <FileBarChart className="w-6 h-6 text-brand-red" />
            Client Performance Reports
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5 prose-measure">
            Immutable performance snapshots, omnichannel KPIs, and client-safe review packages
          </p>
        </div>

        <button
          onClick={() => setIsCreateOpen(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-brand-red hover:bg-brand-red/90 text-white rounded-lg text-xs font-semibold shadow-sm transition-all flex-shrink-0"
        >
          <Plus className="w-4 h-4" />
          Generate New Report
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-4 bg-card-bg border border-card-border rounded-xl flex flex-col md:flex-row items-center justify-between gap-3 shadow-sm">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search reports by client or title..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-bg-main border border-card-border rounded-lg pl-9 pr-3 py-1.5 text-xs text-text-primary placeholder:text-muted-foreground focus:ring-1 focus:ring-brand-red focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto">
          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-bg-main border border-card-border rounded-lg px-2.5 py-1.5 text-xs text-text-primary focus:ring-1 focus:ring-brand-red focus:outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="draft">Drafts</option>
            <option value="approved">Approved</option>
            <option value="shared">Shared</option>
            <option value="archived">Archived</option>
          </select>

          {/* Audience filter */}
          <select
            value={audienceFilter}
            onChange={(e) => setAudienceFilter(e.target.value)}
            className="bg-bg-main border border-card-border rounded-lg px-2.5 py-1.5 text-xs text-text-primary focus:ring-1 focus:ring-brand-red focus:outline-none"
          >
            <option value="all">All Audiences</option>
            <option value="client">Client-Facing</option>
            <option value="internal">Internal Team</option>
          </select>
        </div>
      </div>

      {/* Reports Table */}
      <div className="bg-card-bg border border-card-border rounded-xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-12 text-center text-xs text-muted-foreground">Loading campaign reports...</div>
        ) : filteredReports.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="inline-flex p-3 rounded-full bg-card-border/40 text-muted-foreground">
              <FileBarChart className="w-6 h-6" />
            </div>
            <p className="text-sm font-medium text-text-primary">No campaign reports found</p>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              Generate your first weekly or monthly campaign report snapshot to share performance with clients.
            </p>
            <button
              onClick={() => setIsCreateOpen(true)}
              className="mt-2 inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-brand-red text-white rounded-lg text-xs font-semibold"
            >
              <Plus className="w-3.5 h-3.5" /> Generate Report
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-card-border bg-card-border/40/40 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  <th className="py-3 px-4">Report & Client</th>
                  <th className="py-3 px-4">Period</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Audience</th>
                  <th className="py-3 px-4">Author / Approver</th>
                  <th className="py-3 px-4">Shares / Exports</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-xs">
                {filteredReports.map((r) => (
                  <tr key={r.id} className="hover:bg-card-border/40/30 transition-colors group">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-text-primary">
                        <Link href={`/client-reports/${r.id}`} className="hover:text-brand-red transition-colors">
                          {r.title}
                        </Link>
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
                        <Building2 className="w-3 h-3" />
                        <span>{r.clientName}</span>
                        {r.campaignName && <span>&bull; {r.campaignName}</span>}
                      </div>
                    </td>

                    <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        <span>
                          {new Date(r.periodStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} &ndash;{' '}
                          {new Date(r.periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                      </div>
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap">{getStatusBadge(r.status)}</td>

                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="capitalize px-2 py-0.5 rounded text-[11px] font-medium bg-card-border/40 text-text-primary border border-card-border">
                        {r.audience}
                      </span>
                    </td>

                    <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
                      <div>By {r.generatedByName}</div>
                      {r.approvedByName && (
                        <div className="text-[10px] text-emerald-600 dark:text-emerald-400">
                          Approved by {r.approvedByName}
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
                      <div className="flex items-center gap-2 text-[11px]">
                        <span title="Active Share Links">{r.shareLinksCount} shares</span>
                        <span>&bull;</span>
                        <span title="Exported Files">{r.exportsCount} exports</span>
                      </div>
                    </td>

                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        <Link
                          href={`/client-reports/${r.id}`}
                          className="px-2.5 py-1 bg-card-border/40 hover:bg-card-border/40/80 text-text-primary rounded text-[11px] font-medium transition-colors"
                        >
                          View
                        </Link>
                        {r.shareLinksCount > 0 ? (
                          <button
                            onClick={() => setShareTarget({ id: r.id, title: r.title })}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/20 rounded text-[10px] font-bold transition-colors"
                            title="Open share modal to copy public link"
                          >
                            <Link2 className="w-3 h-3" />
                            Copy Link
                          </button>
                        ) : (
                          <button
                            onClick={() => setShareTarget({ id: r.id, title: r.title })}
                            className="p-1 rounded text-muted-foreground hover:text-brand-red hover:bg-brand-red/10 transition-colors"
                            title="Share Link"
                          >
                            <Link2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <a
                          href={`/api/client-reports/${r.id}/export/pdf`}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1 rounded text-muted-foreground hover:text-brand-red hover:bg-brand-red/10 transition-colors"
                          title="Print / PDF"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      <CreateClientReportModal
        isOpen={isCreateOpen}
        onClose={() => {
          setIsCreateOpen(false);
          fetchReports();
        }}
      />

      {shareTarget && (
        <ClientReportShareModal
          reportId={shareTarget.id}
          reportTitle={shareTarget.title}
          isOpen={Boolean(shareTarget)}
          onClose={() => setShareTarget(null)}
        />
      )}
    </div>
  );
}
