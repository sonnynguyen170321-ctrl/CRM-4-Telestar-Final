'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  Lock,
  Link2,
  Download,
  Calendar,
  Building2,
  FileSpreadsheet,
  Printer,
  Sparkles,
  Save,
  Users,
  Target,
  Clock,
  TrendingUp,
  AlertCircle,
  Plus,
  Trash2,
  Mail,
  Phone,
  MessageSquare,
  ShieldCheck,
} from 'lucide-react';
import Linkedin from '@/components/icons/Linkedin';
import { ClientReportSnapshot, ReportStatus, ReportAudience } from '@/lib/client-reports/types';
import ClientReportShareModal from './ClientReportShareModal';

interface Props {
  report: {
    id: string;
    clientId: string;
    client: { id: string; name: string };
    campaignId?: string | null;
    campaign?: { id: string; name: string } | null;
    title: string;
    periodType: string;
    periodStart: string;
    periodEnd: string;
    status: ReportStatus;
    audience: ReportAudience;
    summary?: string | null;
    keyWins: string[];
    blockers: string[];
    recommendations: string[];
    clientActions: string[];
    snapshotJson: ClientReportSnapshot;
    generatedBy: { id: string; name: string | null; email: string };
    approvedBy?: { id: string; name: string | null; email: string } | null;
    approvedAt?: string | null;
    sharedAt?: string | null;
    createdAt: string;
    updatedAt: string;
  };
  currentUserRole?: string;
}

export default function ClientReportDetail({ report: initialReport, currentUserRole = 'floor_manager' }: Props) {
  const [report, setReport] = useState(initialReport);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Editable Narrative State
  const [summary, setSummary] = useState(report.summary || report.snapshotJson?.insights?.summary || '');
  const [keyWins, setKeyWins] = useState<string[]>(report.keyWins?.length ? report.keyWins : report.snapshotJson?.insights?.keyWins || []);
  const [blockers, setBlockers] = useState<string[]>(report.blockers?.length ? report.blockers : report.snapshotJson?.insights?.blockers || []);
  const [recommendations, setRecommendations] = useState<string[]>(report.recommendations?.length ? report.recommendations : report.snapshotJson?.insights?.recommendations || []);
  const [clientActions, setClientActions] = useState<string[]>(report.clientActions?.length ? report.clientActions : report.snapshotJson?.insights?.clientActions || []);

  const snapshot = report.snapshotJson;
  const isApproved = report.status === 'approved' || report.status === 'shared';
  const canApprove = ['director', 'floor_manager'].includes(currentUserRole);

  const handleSaveNarrative = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/client-reports/${report.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary,
          keyWins,
          blockers,
          recommendations,
          clientActions,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save narrative');

      setReport(data.report);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!confirm('Are you sure you want to approve this report? The metrics snapshot will be permanently frozen.')) {
      return;
    }
    setApproving(true);
    setError(null);
    try {
      const res = await fetch(`/api/client-reports/${report.id}/approve`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to approve report');

      setReport(data.report);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setApproving(false);
    }
  };

  const addItem = (list: string[], setList: (items: string[]) => void, placeholder: string) => {
    setList([...list, placeholder]);
  };

  const updateItem = (list: string[], setList: (items: string[]) => void, index: number, value: string) => {
    const next = [...list];
    next[index] = value;
    setList(next);
  };

  const removeItem = (list: string[], setList: (items: string[]) => void, index: number) => {
    setList(list.filter((_, i) => i !== index));
  };

  const getChannelIcon = (ch: string) => {
    switch (ch) {
      case 'email':
        return <Mail className="w-4 h-4 text-blue-500" />;
      case 'call':
        return <Phone className="w-4 h-4 text-emerald-500" />;
      case 'linkedin':
        return <Linkedin className="w-4 h-4 text-sky-600" />;
      case 'whatsapp':
        return <MessageSquare className="w-4 h-4 text-green-500" />;
      default:
        return <Mail className="w-4 h-4 text-muted-foreground" />;
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16">
      {/* Top Navigation & Action Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <Link
            href="/client-reports"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Reports
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-foreground">{report.title}</h1>
            {isApproved ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                <ShieldCheck className="w-3.5 h-3.5" /> Snapshot Approved & Frozen
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                <Clock className="w-3.5 h-3.5" /> Draft Preview
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
            <span className="flex items-center gap-1 font-medium text-foreground">
              <Building2 className="w-3.5 h-3.5 text-brand-red" /> {report.client.name}
            </span>
            {report.campaign && <span>&bull; {report.campaign.name}</span>}
            <span>&bull;</span>
            <span className="flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              {new Date(report.periodStart).toLocaleDateString()} &ndash; {new Date(report.periodEnd).toLocaleDateString()}
            </span>
          </div>
        </div>

        {/* Action Toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          {!isApproved && canApprove && (
            <button
              onClick={handleApprove}
              disabled={approving}
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-4 h-4" />
              {approving ? 'Freezing...' : 'Approve & Freeze'}
            </button>
          )}

          <button
            onClick={() => setIsShareOpen(true)}
            className="px-3.5 py-1.5 bg-brand-red hover:bg-brand-red/90 text-white rounded-lg text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5"
          >
            <Link2 className="w-4 h-4" />
            Share Report
          </button>

          <a
            href={`/api/client-reports/${report.id}/export/pdf`}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 bg-card border border-border text-foreground hover:bg-muted rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
          >
            <Printer className="w-3.5 h-3.5" /> Print / PDF
          </a>

          <a
            href={`/api/client-reports/${report.id}/export/csv`}
            download
            className="px-3 py-1.5 bg-card border border-border text-foreground hover:bg-muted rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" /> CSV
          </a>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded-lg text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {saveSuccess && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-lg text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span>Narrative changes successfully saved to report snapshot!</span>
        </div>
      )}

      {/* KPI Scorecard Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
        <div className="p-4 bg-card border border-border rounded-xl">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            Prospects Contacted
          </div>
          <div className="text-2xl font-bold text-foreground mt-1">{snapshot.kpis.leadsTouched.toLocaleString()}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {snapshot.kpis.touchpointsCompleted.toLocaleString()} total touches
          </div>
        </div>

        <div className="p-4 bg-card border border-border rounded-xl">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Replies</div>
          <div className="text-2xl font-bold text-foreground mt-1">{snapshot.kpis.replies}</div>
          <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium mt-0.5">
            {(snapshot.kpis.replyRate * 100).toFixed(1)}% reply rate
          </div>
        </div>

        <div className="p-4 bg-card border border-border rounded-xl">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Booked Meetings</div>
          <div className="text-2xl font-bold text-foreground mt-1">{snapshot.kpis.meetingsBooked}</div>
          <div className="text-[11px] text-blue-600 dark:text-blue-400 font-medium mt-0.5">
            {snapshot.kpis.qualifiedMeetings} qualified
          </div>
        </div>

        <div className="p-4 bg-card border border-border rounded-xl">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            Completed Meetings
          </div>
          <div className="text-2xl font-bold text-foreground mt-1">{snapshot.kpis.meetingsCompleted}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {snapshot.kpis.noShows} no-shows ({(snapshot.kpis.noShowRate * 100).toFixed(1)}%)
          </div>
        </div>

        <div className="p-4 bg-card border border-border rounded-xl col-span-2 sm:col-span-4 lg:col-span-1">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            Accepted Pipeline
          </div>
          <div className="text-2xl font-bold text-brand-red mt-1">
            ${snapshot.kpis.activePipelineValue.toLocaleString()}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {snapshot.kpis.clientAcceptedOpportunities} accepted deals
          </div>
        </div>
      </div>

      {/* Section 1: Executive Summary & Strategic Commentary */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-brand-red" />
            <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">
              Executive Summary & Strategy Review
            </h2>
          </div>
          {!isApproved && (
            <button
              onClick={handleSaveNarrative}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-red hover:bg-brand-red/90 text-white rounded-lg text-xs font-semibold transition-all disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Saving...' : 'Save Narrative'}
            </button>
          )}
        </div>

        <div>
          <label className="text-xs font-medium text-foreground block mb-1">
            Manager Executive Commentary {isApproved && <span className="text-muted-foreground">(Locked)</span>}
          </label>
          <textarea
            rows={3}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            disabled={isApproved}
            placeholder="Summarize the core achievements, channel conversion highlights, and key results of the campaign..."
            className="w-full bg-background border border-border rounded-lg p-3 text-xs text-foreground placeholder:text-muted-foreground focus:ring-1 focus:ring-brand-red focus:outline-none disabled:opacity-75"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          {/* Key Wins */}
          <div className="p-3.5 bg-muted/30 border border-border rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">Key Wins</span>
              {!isApproved && (
                <button
                  type="button"
                  onClick={() => addItem(keyWins, setKeyWins, 'New win item...')}
                  className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Add
                </button>
              )}
            </div>
            <div className="space-y-1.5">
              {keyWins.map((win, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    value={win}
                    disabled={isApproved}
                    onChange={(e) => updateItem(keyWins, setKeyWins, idx, e.target.value)}
                    className="w-full bg-background border border-border rounded px-2.5 py-1 text-xs text-foreground"
                  />
                  {!isApproved && (
                    <button
                      onClick={() => removeItem(keyWins, setKeyWins, idx)}
                      className="text-muted-foreground hover:text-red-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Strategic Recommendations */}
          <div className="p-3.5 bg-muted/30 border border-border rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-blue-600 dark:text-blue-400">Next-Week Recommendations</span>
              {!isApproved && (
                <button
                  type="button"
                  onClick={() => addItem(recommendations, setRecommendations, 'New recommendation...')}
                  className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Add
                </button>
              )}
            </div>
            <div className="space-y-1.5">
              {recommendations.map((rec, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    value={rec}
                    disabled={isApproved}
                    onChange={(e) => updateItem(recommendations, setRecommendations, idx, e.target.value)}
                    className="w-full bg-background border border-border rounded px-2.5 py-1 text-xs text-foreground"
                  />
                  {!isApproved && (
                    <button
                      onClick={() => removeItem(recommendations, setRecommendations, idx)}
                      className="text-muted-foreground hover:text-red-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Section 2: Channels & Funnel Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Outreach by Channel */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-3">
          <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Outreach by Channel</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border text-[11px] text-muted-foreground font-semibold">
                  <th className="py-2 px-3">Channel</th>
                  <th className="py-2 px-3">Touches</th>
                  <th className="py-2 px-3">Replies</th>
                  <th className="py-2 px-3">Booked</th>
                  <th className="py-2 px-3">Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {snapshot.channels.map((ch) => (
                  <tr key={ch.channel} className="hover:bg-muted/20">
                    <td className="py-2.5 px-3 font-medium text-foreground flex items-center gap-2">
                      {getChannelIcon(ch.channel)}
                      <span>{ch.label}</span>
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground">{ch.touchpoints.toLocaleString()}</td>
                    <td className="py-2.5 px-3 font-semibold text-foreground">{ch.replies}</td>
                    <td className="py-2.5 px-3 font-semibold text-brand-red">{ch.meetingsBooked}</td>
                    <td className="py-2.5 px-3 text-muted-foreground">{(ch.conversionRate * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Email Deliverability & Channel Health */}
          {snapshot.emailChannelHealth && (
            <div className="mt-4 pt-3 border-t border-border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 bg-muted/20 rounded-lg">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Email Channel Posture:
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                      snapshot.emailChannelHealth.overall === 'Good'
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : snapshot.emailChannelHealth.overall === 'Watch'
                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {snapshot.emailChannelHealth.overall}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground leading-tight">
                  {snapshot.emailChannelHealth.correctiveActions.join(' ')}
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs font-semibold shrink-0">
                <div>
                  <span className="text-[10px] text-muted-foreground block font-normal">Bounce</span>
                  <span>{(snapshot.emailChannelHealth.bounceRate * 100).toFixed(2)}%</span>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground block font-normal">Reply</span>
                  <span className="text-emerald-600 dark:text-emerald-400">
                    {(snapshot.emailChannelHealth.replyRate * 100).toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Funnel Conversion */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-3">
          <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Conversion Funnel</h2>
          <div className="space-y-2">
            {snapshot.funnel.map((step, idx) => (
              <div key={step.stage} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-foreground">{step.label}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-foreground">{step.count.toLocaleString()}</span>
                    {idx > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        ({(step.conversionRate! * 100).toFixed(1)}%)
                      </span>
                    )}
                  </div>
                </div>
                <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-brand-red h-2 rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.max(
                        5,
                        Math.min(100, (step.count / (snapshot.funnel[0].count || 1)) * 100)
                      )}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Section 3: Booked Meetings Log */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">
            Booked Meetings Log ({snapshot.meetings.length})
          </h2>
          <span className="text-xs text-muted-foreground">Client-safe summary notes</span>
        </div>

        {snapshot.meetings.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">No meetings recorded in this period.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-[11px] text-muted-foreground font-semibold">
                  <th className="py-2.5 px-3">Company & Contact</th>
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Outcome</th>
                  <th className="py-2.5 px-3">Representative</th>
                  <th className="py-2.5 px-3">Next Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {snapshot.meetings.map((m) => (
                  <tr key={m.id} className="hover:bg-muted/20">
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-foreground">{m.company}</div>
                      {m.contactName && (
                        <div className="text-[11px] text-muted-foreground">
                          {m.contactName} {m.contactTitle ? `&bull; ${m.contactTitle}` : ''}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">
                      {new Date(m.scheduledAt).toLocaleDateString()}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <span className="capitalize px-2 py-0.5 rounded text-[11px] font-medium bg-muted text-foreground border border-border">
                        {m.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                          m.outcome?.includes('qualified')
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {m.outcome ? m.outcome.replace(/_/g, ' ') : 'Pending'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">{m.sdrDisplayName}</td>
                    <td className="py-2.5 px-3 text-muted-foreground max-w-xs truncate">
                      {m.nextStep || m.summaryNotes || 'Follow-up as planned'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Section 4: Opportunity Pipeline */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">
            Opportunity Handoff & Pipeline ({snapshot.opportunities.length})
          </h2>
          <span className="text-xs text-brand-red font-semibold">
            ${snapshot.kpis.activePipelineValue.toLocaleString()} Active
          </span>
        </div>

        {snapshot.opportunities.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            No opportunities submitted in this period.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-[11px] text-muted-foreground font-semibold">
                  <th className="py-2.5 px-3">Company & Opportunity</th>
                  <th className="py-2.5 px-3">Stage</th>
                  <th className="py-2.5 px-3">Handoff Status</th>
                  <th className="py-2.5 px-3">Value</th>
                  <th className="py-2.5 px-3">Next Step</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {snapshot.opportunities.map((opp) => (
                  <tr key={opp.id} className="hover:bg-muted/20">
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-foreground">{opp.company}</div>
                      <div className="text-[11px] text-muted-foreground">{opp.title}</div>
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <span className="capitalize px-2 py-0.5 rounded text-[11px] font-medium bg-muted text-foreground border border-border">
                        {opp.stage.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <span
                        className={`capitalize px-2 py-0.5 rounded text-[11px] font-semibold ${
                          opp.handoffStatus === 'accepted'
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : opp.handoffStatus === 'rejected'
                            ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                            : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                        }`}
                      >
                        {opp.handoffStatus.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-foreground whitespace-nowrap">
                      {opp.value ? `$${opp.value.toLocaleString()}` : '&ndash;'}
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground max-w-xs truncate">
                      {opp.nextStep || opp.rejectedReason || 'Under client review'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Section 5: SDR Performance Table */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-3">
        <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Representative Performance</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-[11px] text-muted-foreground font-semibold">
                <th className="py-2.5 px-3">Rep Name</th>
                <th className="py-2.5 px-3">Contacted Leads</th>
                <th className="py-2.5 px-3">Total Touches</th>
                <th className="py-2.5 px-3">Replies</th>
                <th className="py-2.5 px-3">Meetings Booked</th>
                <th className="py-2.5 px-3">Accepted Ops</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {snapshot.reps.map((rep) => (
                <tr key={rep.repId} className="hover:bg-muted/20">
                  <td className="py-2.5 px-3 font-semibold text-foreground">{rep.displayName}</td>
                  <td className="py-2.5 px-3 text-muted-foreground">{rep.leadsTouched.toLocaleString()}</td>
                  <td className="py-2.5 px-3 text-muted-foreground">{rep.touchpoints.toLocaleString()}</td>
                  <td className="py-2.5 px-3 font-medium text-foreground">{rep.replies}</td>
                  <td className="py-2.5 px-3 font-semibold text-brand-red">{rep.meetingsBooked}</td>
                  <td className="py-2.5 px-3 font-semibold text-emerald-600 dark:text-emerald-400">
                    {rep.acceptedOpportunities}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Share Modal */}
      {isShareOpen && (
        <ClientReportShareModal
          reportId={report.id}
          reportTitle={report.title}
          isOpen={isShareOpen}
          onClose={() => setIsShareOpen(false)}
        />
      )}
    </div>
  );
}
