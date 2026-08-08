'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  CalendarDays,
  Search,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Clock,
  UserCheck,
  Building2,
  RefreshCw,
  Send,
  Calendar,
} from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import MeetingStatusBadge from '@/components/meetings/MeetingStatusBadge';
import dynamic from 'next/dynamic';

const MeetingOutcomeModal = dynamic(() => import('@/components/meetings/MeetingOutcomeModal'), { ssr: false });
const LeadDetailPanel = dynamic(() => import('@/components/LeadDetailPanel'), { ssr: false });

interface MeetingRecord {
  id: string;
  leadId: string;
  clientId: string;
  campaignId: string;
  sdrId: string;
  bookingLinkId?: string | null;
  bookingLinkUrlSnapshot?: string | null;
  bookingLinkNameSnapshot?: string | null;
  sourceChannel?: string | null;
  status: 'link_sent' | 'scheduled' | 'completed' | 'no_show' | 'cancelled' | 'rescheduled';
  title: string;
  scheduledAt?: string | null;
  durationMins: number;
  timezone?: string | null;
  meetingUrl?: string | null;
  prospectName?: string | null;
  prospectEmail?: string | null;
  clientOwnerName?: string | null;
  clientOwnerEmail?: string | null;
  outcome?:
    | 'qualified_opportunity'
    | 'completed_not_qualified'
    | 'no_show'
    | 'cancelled'
    | 'rescheduled'
    | 'no_decision'
    | 'other'
    | null;
  outcomeNotes?: string | null;
  painPoints?: string | null;
  nextStep?: string | null;
  outcomeLoggedAt?: string | null;
  createdAt: string;
  lead: {
    id: string;
    firstName: string;
    lastName: string;
    company: string;
    email: string;
    phone?: string | null;
    stage: string;
  };
  client: {
    id: string;
    name: string;
  };
  campaign: {
    id: string;
    name: string;
  };
  sdr: {
    id: string;
    firstName: string;
    lastName: string;
  };
  outcomeLoggedBy?: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
}

export default function MeetingsPage() {
  const { showToast } = useToast();
  const [meetings, setMeetings] = useState<MeetingRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [outcomeFilter, setOutcomeFilter] = useState<string>('all');
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [campaignFilter, setCampaignFilter] = useState<string>('all');
  const [sdrFilter, setSdrFilter] = useState<string>('all');

  // Modals state
  const [outcomeMeeting, setOutcomeMeeting] = useState<MeetingRecord | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  const fetchMeetings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/meetings');
      if (!res.ok) throw new Error('Failed to load meetings');
      const data = await res.json();
      setMeetings(data || []);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error fetching meetings', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchMeetings();
  }, [fetchMeetings]);

  // Derived filter options
  const clients = useMemo(() => {
    const map = new Map<string, string>();
    meetings.forEach((m) => {
      if (m.client?.id && m.client?.name) map.set(m.client.id, m.client.name);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [meetings]);

  const campaigns = useMemo(() => {
    const map = new Map<string, string>();
    meetings.forEach((m) => {
      if (m.campaign?.id && m.campaign?.name) map.set(m.campaign.id, m.campaign.name);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [meetings]);

  const sdrs = useMemo(() => {
    const map = new Map<string, string>();
    meetings.forEach((m) => {
      if (m.sdr?.id) map.set(m.sdr.id, `${m.sdr.firstName} ${m.sdr.lastName}`);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [meetings]);

  // KPIs
  const stats = useMemo(() => {
    const now = new Date();
    const total = meetings.length;
    const linkSent = meetings.filter((m) => m.status === 'link_sent').length;
    const scheduled = meetings.filter((m) => m.status === 'scheduled').length;
    const completed = meetings.filter((m) => m.status === 'completed').length;
    const noShow = meetings.filter((m) => m.status === 'no_show').length;
    const qualified = meetings.filter((m) => m.outcome === 'qualified_opportunity').length;
    const outcomePending = meetings.filter((m) => {
      if (m.status !== 'scheduled' && m.status !== 'link_sent') return false;
      if (!m.scheduledAt) return false;
      return new Date(m.scheduledAt) < now && !m.outcome;
    }).length;

    return { total, linkSent, scheduled, completed, noShow, qualified, outcomePending };
  }, [meetings]);

  // Filtered List
  const filteredMeetings = useMemo(() => {
    return meetings.filter((m) => {
      if (statusFilter !== 'all' && m.status !== statusFilter) return false;
      if (outcomeFilter !== 'all') {
        if (outcomeFilter === 'pending') {
          if (m.outcome) return false;
        } else if (m.outcome !== outcomeFilter) {
          return false;
        }
      }
      if (clientFilter !== 'all' && m.clientId !== clientFilter) return false;
      if (campaignFilter !== 'all' && m.campaignId !== campaignFilter) return false;
      if (sdrFilter !== 'all' && m.sdrId !== sdrFilter) return false;

      if (search.trim()) {
        const q = search.toLowerCase();
        const prospect = `${m.lead?.firstName ?? ''} ${m.lead?.lastName ?? ''}`.toLowerCase();
        const comp = (m.lead?.company ?? '').toLowerCase();
        const title = (m.title ?? '').toLowerCase();
        const client = (m.client?.name ?? '').toLowerCase();
        const email = (m.lead?.email ?? '').toLowerCase();
        if (!prospect.includes(q) && !comp.includes(q) && !title.includes(q) && !client.includes(q) && !email.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [meetings, statusFilter, outcomeFilter, clientFilter, campaignFilter, sdrFilter, search]);

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto min-h-screen">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display font-bold text-2xl text-text-primary flex items-center gap-2.5">
            <CalendarDays className="w-7 h-7 text-brand-red" />
            <span>Meetings & Outcomes</span>
          </h1>
          <p className="text-xs text-text-muted mt-1 font-mono prose-measure">
            Track booking links sent, scheduled calls, client outcomes, and conversion rates.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {stats.outcomePending > 0 && (
            <button
              onClick={() => {
                setStatusFilter('all');
                setOutcomeFilter('pending');
              }}
              className={`flex items-center gap-1.5 px-3 py-2 border rounded-xl text-xs font-semibold shadow-sm transition-colors ${
                outcomeFilter === 'pending'
                  ? 'bg-rose-500/15 border-rose-500/30 text-rose-500'
                  : 'bg-card-bg border-card-border hover:border-rose-500/30 text-rose-500'
              }`}
            >
              <AlertCircle className="w-3.5 h-3.5" />
              Missing Outcomes
              <span className="px-1.5 py-0.5 rounded-full bg-rose-500/15 text-rose-500 text-[10px] font-bold font-mono">
                {stats.outcomePending}
              </span>
            </button>
          )}
          <button
            onClick={fetchMeetings}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 bg-card-bg border border-card-border hover:border-brand-red/30 text-text-primary rounded-xl text-xs font-semibold shadow-sm transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-card-bg border border-card-border rounded-2xl p-4 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-[10px] uppercase tracking-wider">Total</span>
            <Calendar className="w-4 h-4 text-brand-red" />
          </div>
          <div className="text-2xl font-bold font-mono text-text-primary">{stats.total}</div>
          <p className="text-[10px] text-text-muted font-mono">Logged interactions</p>
        </div>

        <div className="bg-card-bg border border-card-border rounded-2xl p-4 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-[10px] uppercase tracking-wider">Links Sent</span>
            <Send className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-blue-400">{stats.linkSent}</div>
          <p className="text-[10px] text-text-muted font-mono">Awaiting booking</p>
        </div>

        <div className="bg-card-bg border border-card-border rounded-2xl p-4 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-[10px] uppercase tracking-wider">Scheduled</span>
            <Clock className="w-4 h-4 text-brand-orange-text" />
          </div>
          <div className="text-2xl font-bold font-mono text-brand-orange-text">{stats.scheduled}</div>
          <p className="text-[10px] text-text-muted font-mono">On calendar</p>
        </div>

        <div className="bg-card-bg border border-card-border rounded-2xl p-4 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-[10px] uppercase tracking-wider">Completed</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-400">{stats.completed}</div>
          <p className="text-[10px] text-text-muted font-mono">Calls occurred</p>
        </div>

        <div className="bg-card-bg border border-card-border rounded-2xl p-4 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-[10px] uppercase tracking-wider">Qualified</span>
            <UserCheck className="w-4 h-4 text-brand-gold-text" />
          </div>
          <div className="text-2xl font-bold font-mono text-brand-gold-text">{stats.qualified}</div>
          <p className="text-[10px] text-text-muted font-mono">Sales opps generated</p>
        </div>

        <div className="bg-card-bg border border-card-border rounded-2xl p-4 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-[10px] uppercase tracking-wider">Pending Outcome</span>
            <AlertCircle className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-2xl font-bold font-mono text-rose-500">{stats.outcomePending}</div>
          <p className="text-[10px] text-text-muted font-mono">Past scheduled time</p>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-card-bg border border-card-border rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex flex-col lg:flex-row items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by prospect, company, meeting title, or client..."
              className="w-full pl-9 pr-4 py-2 bg-bg-main border border-card-border rounded-xl text-xs text-text-primary placeholder-text-muted focus:outline-none focus:border-brand-red"
            />
          </div>

          {/* Quick Filter Selects */}
          <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
            {/* Status */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 bg-bg-main border border-card-border rounded-xl text-xs text-text-primary focus:outline-none focus:border-brand-red font-mono"
            >
              <option value="all">Status: All</option>
              <option value="link_sent">Link Sent</option>
              <option value="scheduled">Scheduled</option>
              <option value="completed">Completed</option>
              <option value="no_show">No Show</option>
              <option value="cancelled">Cancelled</option>
              <option value="rescheduled">Rescheduled</option>
            </select>

            {/* Outcome */}
            <select
              value={outcomeFilter}
              onChange={(e) => setOutcomeFilter(e.target.value)}
              className="px-3 py-2 bg-bg-main border border-card-border rounded-xl text-xs text-text-primary focus:outline-none focus:border-brand-red font-mono"
            >
              <option value="all">Outcome: All</option>
              <option value="pending">Outcome Pending</option>
              <option value="qualified_opportunity">Qualified Opportunity</option>
              <option value="not_interested">Not Interested</option>
              <option value="wrong_fit">Wrong Fit</option>
              <option value="rescheduled_needed">Rescheduled Needed</option>
              <option value="follow_up_later">Follow Up Later</option>
            </select>

            {/* Client */}
            {clients.length > 0 && (
              <select
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                className="px-3 py-2 bg-bg-main border border-card-border rounded-xl text-xs text-text-primary focus:outline-none focus:border-brand-red font-mono"
              >
                <option value="all">Client: All</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}

            {/* Campaign */}
            {campaigns.length > 0 && (
              <select
                value={campaignFilter}
                onChange={(e) => setCampaignFilter(e.target.value)}
                className="px-3 py-2 bg-bg-main border border-card-border rounded-xl text-xs text-text-primary focus:outline-none focus:border-brand-red font-mono"
              >
                <option value="all">Campaign: All</option>
                {campaigns.map((cp) => (
                  <option key={cp.id} value={cp.id}>{cp.name}</option>
                ))}
              </select>
            )}

            {/* SDR */}
            {sdrs.length > 0 && (
              <select
                value={sdrFilter}
                onChange={(e) => setSdrFilter(e.target.value)}
                className="px-3 py-2 bg-bg-main border border-card-border rounded-xl text-xs text-text-primary focus:outline-none focus:border-brand-red font-mono"
              >
                <option value="all">SDR: All</option>
                {sdrs.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>

      {/* Meetings Table */}
      <div className="bg-card-bg border border-card-border rounded-2xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-card-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="font-display font-bold text-sm text-text-primary">Meeting Records</h2>
            <span className="px-2 py-0.5 rounded-full bg-brand-red/10 text-brand-red text-[10px] font-bold font-mono">
              {filteredMeetings.length}
            </span>
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-text-muted text-xs font-mono animate-pulse">
            Loading meeting records...
          </div>
        ) : filteredMeetings.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <CalendarDays className="w-8 h-8 text-text-muted mx-auto opacity-40" />
            <p className="text-xs text-text-muted">No meetings match the current filter criteria.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-bg-main/40 text-text-muted uppercase text-[10px] border-b border-card-border">
                <tr>
                  <th className="py-3 px-4">Lead / Prospect</th>
                  <th className="py-3 px-4">Client & Campaign</th>
                  <th className="py-3 px-4">Scheduled Date</th>
                  <th className="py-3 px-4">SDR</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Outcome</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {filteredMeetings.map((m) => (
                  <tr key={m.id} className="hover:bg-bg-main/30 transition-colors">
                    {/* Lead */}
                    <td className="py-3.5 px-4">
                      <div className="flex flex-col">
                        <button
                          onClick={() => setSelectedLeadId(m.leadId)}
                          className="font-semibold text-text-primary hover:text-brand-red text-left transition-colors"
                        >
                          {m.lead?.firstName} {m.lead?.lastName}
                        </button>
                        <span className="text-[11px] text-text-muted font-mono">{m.lead?.company || '—'}</span>
                        <span className="text-[10px] text-text-muted">{m.lead?.email}</span>
                      </div>
                    </td>

                    {/* Client & Campaign */}
                    <td className="py-3.5 px-4">
                      <div className="flex flex-col">
                        <span className="font-medium text-text-primary flex items-center gap-1">
                          <Building2 className="w-3 h-3 text-brand-orange-text" />
                          {m.client?.name}
                        </span>
                        <span className="text-[10px] text-text-muted font-mono">{m.campaign?.name}</span>
                        {m.bookingLinkNameSnapshot && (
                          <span className="text-[9px] text-text-muted font-mono">
                            Link: {m.bookingLinkNameSnapshot}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Scheduled Date */}
                    <td className="py-3.5 px-4">
                      {m.scheduledAt ? (
                        <div className="flex flex-col">
                          <span className="font-medium text-text-primary">
                            {new Date(m.scheduledAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                          <span className="text-[10px] text-text-muted font-mono">
                            {new Date(m.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({m.durationMins}m)
                          </span>
                        </div>
                      ) : (
                        <span className="text-text-muted font-mono text-[11px]">—</span>
                      )}
                    </td>

                    {/* SDR */}
                    <td className="py-3.5 px-4">
                      <span className="text-text-primary font-medium">
                        {m.sdr?.firstName} {m.sdr?.lastName}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="py-3.5 px-4">
                      <MeetingStatusBadge status={m.status} />
                    </td>

                    {/* Outcome */}
                    <td className="py-3.5 px-4">
                      {m.outcome ? (
                        <div className="flex flex-col">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono inline-block w-fit ${
                            m.outcome === 'qualified_opportunity'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : m.outcome === 'completed_not_qualified' || m.outcome === 'cancelled' || m.outcome === 'no_show'
                              ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                              : 'bg-brand-orange/10 text-brand-orange-text border border-brand-orange/20'
                          }`}>
                            {m.outcome.replace(/_/g, ' ').toUpperCase()}
                          </span>
                          {m.outcomeNotes && (
                            <span className="text-[10px] text-text-muted line-clamp-1 mt-0.5" title={m.outcomeNotes}>
                              {m.outcomeNotes}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[10px] text-text-muted font-mono">Pending</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {(!m.outcome && (m.status === 'scheduled' || m.status === 'link_sent')) && (
                          <button
                            onClick={() => setOutcomeMeeting(m)}
                            className="px-2.5 py-1 bg-brand-red/10 hover:bg-brand-red/20 text-brand-red border border-brand-red/30 rounded-lg text-[10px] font-bold font-mono transition-colors"
                          >
                            Log Outcome
                          </button>
                        )}
                        {m.meetingUrl && (
                          <a
                            href={m.meetingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 text-text-muted hover:text-text-primary rounded-lg border border-card-border hover:border-brand-red/30 transition-colors"
                            title="Open Meeting URL"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Outcome Modal */}
      {outcomeMeeting && (
        <MeetingOutcomeModal
          meetingId={outcomeMeeting.id}
          meetingTitle={outcomeMeeting.title}
          onClose={() => setOutcomeMeeting(null)}
          onOutcomeLogged={() => {
            fetchMeetings();
            setOutcomeMeeting(null);
          }}
        />
      )}

      {/* Lead Detail Panel */}
      {selectedLeadId && (
        <LeadDetailPanel
          leadId={selectedLeadId}
          onClose={() => setSelectedLeadId(null)}
          onLeadUpdate={() => fetchMeetings()}
        />
      )}
    </div>
  );
}
