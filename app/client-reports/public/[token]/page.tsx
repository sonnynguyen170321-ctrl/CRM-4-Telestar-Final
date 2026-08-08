'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  Lock,
  Printer,
  Calendar,
  Building2,
  Sparkles,
  AlertCircle,
  ShieldCheck,
} from 'lucide-react';
import { ClientReportSnapshot } from '@/lib/client-reports/types';

export default function PublicReportViewer() {
  const params = useParams();
  const token = params?.token as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ClientReportSnapshot | null>(null);
  const [title, setTitle] = useState('');
  const [clientName, setClientName] = useState('');

  // Password flow
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [submittingPassword, setSubmittingPassword] = useState(false);

  const fetchReport = useCallback(async (pwd?: string) => {
    if (pwd) setSubmittingPassword(true);
    else setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/client-reports/public/${token}`, {
        method: pwd ? 'POST' : 'GET',
        headers: pwd ? { 'Content-Type': 'application/json' } : undefined,
        body: pwd ? JSON.stringify({ password: pwd }) : undefined,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load report');
      }

      if (data.requiresPassword) {
        setRequiresPassword(true);
        setTitle(data.title);
        setClientName(data.clientName);
      } else {
        setRequiresPassword(false);
        setSnapshot(data.snapshot);
        setTitle(data.title);
        setClientName(data.clientName);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
      setSubmittingPassword(false);
    }
    // Only  is read from props/state here; every other value is a setter, which React
    // guarantees is stable. That keeps this callback's identity tied to the token alone, so
    // the effect below re-runs when the link changes and never merely because we re-rendered.
  }, [token]);

  useEffect(() => {
    if (token) {
      fetchReport();
    }
  }, [token, fetchReport]);

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    fetchReport(password);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-main flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-brand-red border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-muted-foreground">Loading performance report...</p>
        </div>
      </div>
    );
  }

  if (requiresPassword) {
    return (
      <div className="min-h-screen bg-bg-main flex items-center justify-center p-4">
        <div className="bg-card-bg border border-card-border rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
          <div className="text-center space-y-1">
            <div className="inline-flex p-3 rounded-full bg-brand-red/10 text-brand-red mb-2">
              <Lock className="w-6 h-6" />
            </div>
            <h2 className="text-base font-bold text-text-primary">Password Protected Report</h2>
            <p className="text-xs text-muted-foreground">{title || 'Confidential Performance Report'}</p>
          </div>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded-lg text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-medium text-text-primary block mb-1">Enter Passcode</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter access password"
                className="w-full bg-bg-main border border-card-border rounded-lg px-3 py-2 text-xs text-text-primary focus:ring-1 focus:ring-brand-red focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={submittingPassword || !password}
              className="w-full py-2 bg-brand-red hover:bg-brand-red/90 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-sm transition-all"
            >
              {submittingPassword ? 'Verifying...' : 'Unlock Report'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="min-h-screen bg-bg-main flex items-center justify-center p-4">
        <div className="bg-card-bg border border-card-border rounded-xl shadow-xl w-full max-w-md p-8 text-center space-y-3">
          <div className="inline-flex p-3 rounded-full bg-red-500/10 text-red-500">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h2 className="text-base font-bold text-text-primary">Unable to Access Report</h2>
          <p className="text-xs text-muted-foreground">{error || 'This share link may have expired or been revoked.'}</p>
        </div>
      </div>
    );
  }

  const periodStartFmt = new Date(snapshot.meta.periodStart).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const periodEndFmt = new Date(snapshot.meta.periodEnd).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-zinc-950 text-text-primary py-8 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Top Header Card */}
        <div className="bg-card-bg border border-card-border rounded-2xl p-6 sm:p-8 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-brand-red">Executive Campaign Report</span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                <ShieldCheck className="w-3 h-3" /> Verified Snapshot
              </span>
            </div>
            <h1 className="text-2xl font-bold text-text-primary tracking-tight">{title}</h1>
            <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
              <span className="flex items-center gap-1 font-semibold text-text-primary">
                <Building2 className="w-3.5 h-3.5 text-brand-red" /> {clientName}
              </span>
              <span>&bull;</span>
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" /> {periodStartFmt} &ndash; {periodEndFmt}
              </span>
            </div>
          </div>

          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-brand-dark text-bg-main hover:bg-brand-dark/90 rounded-xl text-xs font-semibold transition-all shadow-sm flex-shrink-0 self-start md:self-auto"
          >
            <Printer className="w-4 h-4" /> Print / Save PDF
          </button>
        </div>

        {/* KPI Scorecard */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-card-bg border border-card-border rounded-xl p-5 shadow-sm">
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Prospects Contacted
            </div>
            <div className="text-2xl font-bold text-text-primary mt-1">
              {snapshot.kpis.leadsTouched.toLocaleString()}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {snapshot.kpis.touchpointsCompleted.toLocaleString()} touchpoints
            </div>
          </div>

          <div className="bg-card-bg border border-card-border rounded-xl p-5 shadow-sm">
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Replies Received</div>
            <div className="text-2xl font-bold text-text-primary mt-1">{snapshot.kpis.replies}</div>
            <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium mt-0.5">
              {(snapshot.kpis.replyRate * 100).toFixed(1)}% reply rate
            </div>
          </div>

          <div className="bg-card-bg border border-card-border rounded-xl p-5 shadow-sm">
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Booked Meetings</div>
            <div className="text-2xl font-bold text-text-primary mt-1">{snapshot.kpis.meetingsBooked}</div>
            <div className="text-[11px] text-blue-600 dark:text-blue-400 font-medium mt-0.5">
              {snapshot.kpis.qualifiedMeetings} qualified discovery calls
            </div>
          </div>

          <div className="bg-card-bg border border-card-border rounded-xl p-5 shadow-sm">
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Accepted Pipeline</div>
            <div className="text-2xl font-bold text-brand-red mt-1">
              ${snapshot.kpis.activePipelineValue.toLocaleString()}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {snapshot.kpis.clientAcceptedOpportunities} accepted opportunities
            </div>
          </div>
        </div>

        {/* Executive Summary */}
        <div className="bg-card-bg border border-card-border rounded-2xl p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-brand-red" />
            <h2 className="text-sm font-bold text-text-primary uppercase tracking-wider">Executive Overview</h2>
          </div>
          <p className="text-xs sm:text-sm text-text-primary/80 leading-relaxed">
            {snapshot.insights.summary ||
              `Outreach conducted across this reporting period delivered strong prospect engagement, generating ${snapshot.kpis.replies} direct replies and ${snapshot.kpis.meetingsBooked} scheduled meetings with decision-makers.`}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            {snapshot.insights.keyWins?.length > 0 && (
              <div className="p-4 bg-emerald-500/5 border border-emerald-500/15 rounded-xl space-y-2">
                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">Key Highlights</span>
                <ul className="space-y-1.5 text-xs text-text-primary/80 list-disc list-inside">
                  {snapshot.insights.keyWins.map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {snapshot.insights.recommendations?.length > 0 && (
              <div className="p-4 bg-blue-500/5 border border-blue-500/15 rounded-xl space-y-2">
                <span className="text-xs font-bold text-blue-600 dark:text-blue-400">Strategic Next Steps</span>
                <ul className="space-y-1.5 text-xs text-text-primary/80 list-disc list-inside">
                  {snapshot.insights.recommendations.map((r, idx) => (
                    <li key={idx}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Outreach by Channel */}
        <div className="bg-card-bg border border-card-border rounded-2xl p-6 shadow-sm space-y-4">
          <h2 className="text-sm font-bold text-text-primary uppercase tracking-wider">Omnichannel Performance</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-card-border text-[11px] text-muted-foreground font-semibold">
                  <th className="py-2.5 px-3">Channel</th>
                  <th className="py-2.5 px-3">Touchpoints</th>
                  <th className="py-2.5 px-3">Replies</th>
                  <th className="py-2.5 px-3">Meetings Booked</th>
                  <th className="py-2.5 px-3">Reply Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {snapshot.channels.map((ch) => (
                  <tr key={ch.channel} className="hover:bg-card-border/40/20">
                    <td className="py-3 px-3 font-semibold text-text-primary">{ch.label}</td>
                    <td className="py-3 px-3 text-muted-foreground">{ch.touchpoints.toLocaleString()}</td>
                    <td className="py-3 px-3 font-semibold text-text-primary">{ch.replies}</td>
                    <td className="py-3 px-3 font-semibold text-brand-red">{ch.meetingsBooked ?? '—'}</td>
                    <td className="py-3 px-3 text-muted-foreground">{(ch.conversionRate * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Email Deliverability & Health */}
          {snapshot.emailChannelHealth && (
            <div className="mt-4 pt-4 border-t border-card-border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 bg-card-border/40/20 rounded-xl">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Email Deliverability Posture:
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
                <div className="text-xs text-muted-foreground leading-snug">
                  {snapshot.emailChannelHealth.correctiveActions.join(' ')}
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs font-semibold shrink-0">
                <div>
                  <span className="text-[10px] text-muted-foreground block font-normal">Bounce Rate</span>
                  <span>{(snapshot.emailChannelHealth.bounceRate * 100).toFixed(2)}%</span>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground block font-normal">Reply Rate</span>
                  <span className="text-emerald-600 dark:text-emerald-400">
                    {(snapshot.emailChannelHealth.replyRate * 100).toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Booked Meetings Table */}
        <div className="bg-card-bg border border-card-border rounded-2xl p-6 shadow-sm space-y-4">
          <h2 className="text-sm font-bold text-text-primary uppercase tracking-wider">
            Meetings & Discovery Calls ({snapshot.meetings.length})
          </h2>
          {snapshot.meetings.length === 0 ? (
            <p className="text-xs text-muted-foreground">No meetings recorded in this reporting period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-card-border text-[11px] text-muted-foreground font-semibold">
                    <th className="py-2.5 px-3">Company</th>
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Outcome</th>
                    <th className="py-2.5 px-3">Notes & Next Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {/* Keyed by index: the public payload strips internal row ids
                      (see toClientSafeSnapshot), and a frozen report snapshot is
                      immutable — this list never reorders, inserts or deletes. */}
                  {snapshot.meetings.map((m, idx) => (
                    <tr key={idx} className="hover:bg-card-border/40/20">
                      <td className="py-3 px-3 font-semibold text-text-primary">
                        {m.company}
                        {m.contactName && (
                          <div className="text-[11px] font-normal text-muted-foreground">{m.contactName}</div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-muted-foreground whitespace-nowrap">
                        {m.scheduledAt ? new Date(m.scheduledAt).toLocaleDateString() : 'Not yet scheduled'}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className="capitalize px-2 py-0.5 rounded text-[11px] font-medium bg-card-border/40 text-text-primary border border-card-border">
                          {m.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
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
                      <td className="py-3 px-3 text-muted-foreground max-w-sm">
                        {m.nextStep || m.summaryNotes || 'Follow-up scheduled'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Opportunity Pipeline */}
        {snapshot.opportunities?.length > 0 && (
          <div className="bg-card-bg border border-card-border rounded-2xl p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-text-primary uppercase tracking-wider">
                Qualified Deal Pipeline ({snapshot.opportunities.length})
              </h2>
              <span className="text-xs font-bold text-brand-red">
                ${snapshot.kpis.activePipelineValue.toLocaleString()} Active Value
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-card-border text-[11px] text-muted-foreground font-semibold">
                    <th className="py-2.5 px-3">Company</th>
                    <th className="py-2.5 px-3">Opportunity</th>
                    <th className="py-2.5 px-3">Stage</th>
                    <th className="py-2.5 px-3">Value</th>
                    <th className="py-2.5 px-3">Next Step</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {/* Index key for the same reason as the meetings table above. */}
                  {snapshot.opportunities.map((opp, idx) => (
                    <tr key={idx} className="hover:bg-card-border/40/20">
                      <td className="py-3 px-3 font-semibold text-text-primary">{opp.company}</td>
                      <td className="py-3 px-3 text-muted-foreground">{opp.title}</td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className="capitalize px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                          {opp.stage.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-semibold text-text-primary whitespace-nowrap">
                        {opp.value ? `$${opp.value.toLocaleString()}` : '&ndash;'}
                      </td>
                      <td className="py-3 px-3 text-muted-foreground">{opp.nextStep || 'In Progress'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="pt-6 border-t border-card-border flex flex-col sm:flex-row items-center justify-between text-xs text-muted-foreground gap-2">
          <div>Prepared for {clientName} &bull; Confidential</div>
          <div>Generated by SalesFlow Enterprise Platform</div>
        </div>
      </div>
    </div>
  );
}
