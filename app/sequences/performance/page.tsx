'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp,
  Send,
  MessageSquare,
  AlertTriangle,
  BarChart3,
  Clock,
} from 'lucide-react';
import { useToast } from '@/context/ToastContext';

interface DashboardStats {
  totalLeads: number;
  activeEnrollments: number;
  todaySends: number;
  weekSends: number;
  monthSends: number;
  todayReplies: number;
  weekReplies: number;
  totalBounces: number;
  sequences: { id: string; name: string; _count: { leads: number } }[];
}

interface SequenceAnalytics {
  totalEnrolled: number;
  activeEnrolled: number;
  completedCount: number;
  totalSends: number;
  uniqueReplies: number;
  bounceCount: number;
  /** Null when nothing was sent — shown as "—", not 0%. */
  replyRate: number | null;
  bounceRate: number | null;
  /** The last 30 calendar days, oldest first, with a zero for a quiet day. */
  sendsByDay: { date: string; count: number }[];
  /** `step` is null for emails from steps that were removed. */
  stepBreakdown: { step: number | null; channel: string; sent: number; replies: number }[];
}

const rateText = (rate: number | null) => (rate === null ? '—' : `${rate}%`);

export default function SequencePerformancePage() {
  const { showToast } = useToast();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [selectedSeq, setSelectedSeq] = useState<string | null>(null);
  const [seqAnalytics, setSeqAnalytics] = useState<SequenceAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStats = useCallback(async () => {
    const res = await fetch('/api/sequences/analytics');
    if (res.ok) {
      const data = await res.json();
      setStats(data);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  const loadSequenceAnalytics = async (seqId: string) => {
    setSelectedSeq(seqId);
    const res = await fetch(`/api/sequences/${seqId}/analytics`);
    if (res.ok) {
      setSeqAnalytics(await res.json());
    } else {
      showToast('Failed to load sequence analytics', 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-brand-red border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display font-extrabold text-2xl text-text-primary tracking-tight">
            Sequence Performance
          </h1>
          <p className="text-xs text-text-secondary mt-0.5">
            Track send volume, reply rates, and engagement across all sequences.
          </p>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-card-bg border border-card-border rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-2 text-blue-500 mb-3">
            <Send className="w-4 h-4" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Sends Today</span>
          </div>
          <div className="text-2xl font-display font-extrabold text-text-primary">
            {stats?.todaySends ?? 0}
          </div>
          <div className="type-meta text-text-muted mt-1">
            {stats?.weekSends ?? 0} this week &middot; {stats?.monthSends ?? 0} this month
          </div>
        </div>

        <div className="bg-card-bg border border-card-border rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-2 text-emerald-500 mb-3">
            <MessageSquare className="w-4 h-4" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Replies</span>
          </div>
          <div className="text-2xl font-display font-extrabold text-text-primary">
            {stats?.todayReplies ?? 0}
            <span className="text-xs text-text-muted font-normal ml-1">today</span>
          </div>
          <div className="type-meta text-text-muted mt-1">
            {stats?.weekReplies ?? 0} this week
          </div>
        </div>

        <div className="bg-card-bg border border-card-border rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-2 text-amber-500 mb-3">
            <TrendingUp className="w-4 h-4" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Active Enrollments</span>
          </div>
          <div className="text-2xl font-display font-extrabold text-text-primary">
            {stats?.activeEnrollments ?? 0}
          </div>
          <div className="type-meta text-text-muted mt-1">
            on {stats?.totalLeads ?? 0} active leads
          </div>
        </div>

        <div className="bg-card-bg border border-card-border rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-2 text-red-500 mb-3">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Bounces</span>
          </div>
          <div className="text-2xl font-display font-extrabold text-text-primary">
            {stats?.totalBounces ?? 0}
          </div>
          <div className="type-meta text-text-muted mt-1">
            emails bounced, last 30 days
          </div>
        </div>
      </div>

      {/* Sequence list with drill-down */}
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-1">
          <div className="bg-card-bg border border-card-border rounded-2xl p-4 shadow-sm">
            <h2 className="font-display font-bold text-sm text-text-primary mb-3 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-brand-orange-text" />
              Sequences
            </h2>
            <div className="space-y-1">
              {stats?.sequences.map((seq) => (
                <button
                  key={seq.id}
                  onClick={() => loadSequenceAnalytics(seq.id)}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs transition-colors flex items-center justify-between ${
                    selectedSeq === seq.id
                      ? 'bg-brand-red/10 border border-brand-red/20 text-brand-red'
                      : 'hover:bg-card-border/30 text-text-primary border border-transparent'
                  }`}
                >
                  <span className="font-semibold truncate">{seq.name}</span>
                  <span className="font-mono text-text-muted text-[10px]">
                    {seq._count.leads} leads
                  </span>
                </button>
              ))}
              {(!stats?.sequences || stats.sequences.length === 0) && (
                <p className="type-body text-text-muted py-4 text-center">
                  No sequence has leads you can see yet.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="col-span-2">
          {selectedSeq && seqAnalytics ? (
            <div className="space-y-4">
              {/* Sequence metrics */}
              <div className="bg-card-bg border border-card-border rounded-2xl p-4 shadow-sm">
                <h2 className="font-display font-bold text-sm text-text-primary mb-4">Campaign Metrics</h2>
                <div className="grid grid-cols-4 gap-4">
                  <div>
                    <div className="text-[10px] text-text-muted uppercase">Enrolled</div>
                    <div className="text-lg font-display font-extrabold text-text-primary">{seqAnalytics.totalEnrolled}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-text-muted uppercase">Active</div>
                    <div className="text-lg font-display font-extrabold text-blue-500">{seqAnalytics.activeEnrolled}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-text-muted uppercase">Reply Rate</div>
                    <div className="text-lg font-display font-extrabold text-emerald-500">{rateText(seqAnalytics.replyRate)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-text-muted uppercase">Bounce Rate</div>
                    <div className="text-lg font-display font-extrabold text-red-500">{rateText(seqAnalytics.bounceRate)}</div>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-4 mt-4 pt-4 border-t border-card-border">
                  <div>
                    <div className="text-[10px] text-text-muted uppercase">Total Sends</div>
                    <div className="text-lg font-display font-extrabold text-text-primary">{seqAnalytics.totalSends}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-text-muted uppercase">Replies</div>
                    <div className="text-lg font-display font-extrabold text-text-primary">{seqAnalytics.uniqueReplies}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-text-muted uppercase">Bounces</div>
                    <div className="text-lg font-display font-extrabold text-text-primary">{seqAnalytics.bounceCount}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-text-muted uppercase">Completed</div>
                    <div className="text-lg font-display font-extrabold text-text-primary">{seqAnalytics.completedCount}</div>
                  </div>
                </div>
              </div>

              {/* Step breakdown */}
              <div className="bg-card-bg border border-card-border rounded-2xl p-4 shadow-sm">
                <h2 className="font-display font-bold text-sm text-text-primary mb-4 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-brand-orange-text" />
                  Step-by-Step Breakdown
                </h2>
                <div className="space-y-2">
                  {seqAnalytics.stepBreakdown.map((step) => (
                    <div
                      key={step.step ?? 'removed'}
                      className="flex items-center justify-between px-3 py-2 bg-bg-main rounded-xl border border-card-border"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-6 h-6 rounded-lg bg-card-border/40 border border-card-border flex items-center justify-center font-mono font-bold text-[10px] text-text-secondary">
                          {step.step ?? '–'}
                        </span>
                        <span className="text-xs font-semibold text-text-primary capitalize">
                          {step.step === null ? 'Removed steps' : step.channel}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-[10px] font-mono">
                        <span className="text-text-muted">{step.sent} sent</span>
                        <span className="text-text-muted">{step.replies} replied</span>
                      </div>
                    </div>
                  ))}
                  {seqAnalytics.stepBreakdown.length === 0 && (
                    <p className="type-body text-text-muted py-4 text-center">No step data yet.</p>
                  )}
                </div>
              </div>

              {/* Send activity chart */}
              {seqAnalytics.sendsByDay.some((day) => day.count > 0) && (
                <div className="bg-card-bg border border-card-border rounded-2xl p-4 shadow-sm">
                  <h2 className="font-display font-bold text-sm text-text-primary mb-4">Send Activity (Last 30 Days)</h2>
                  <div className="flex items-end gap-1 h-24">
                    {seqAnalytics.sendsByDay.map((day) => {
                      const max = Math.max(...seqAnalytics.sendsByDay.map(d => d.count), 1);
                      const height = (day.count / max) * 100;
                      return (
                        <div
                          key={day.date}
                          className="flex-1 bg-brand-red/20 hover:bg-brand-red/40 rounded-t relative group transition-colors min-w-[4px]"
                          style={{ height: `${day.count === 0 ? 0 : Math.max(height, 4)}%` }}
                          title={`${day.date}: ${day.count} sends`}
                        />
                      );
                    })}
                  </div>
                  <div className="flex justify-between text-[8px] font-mono text-text-muted mt-1">
                    <span>{seqAnalytics.sendsByDay[0]?.date?.slice(5) ?? ''}</span>
                    <span>{seqAnalytics.sendsByDay[seqAnalytics.sendsByDay.length - 1]?.date?.slice(5) ?? ''}</span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-card-bg border border-card-border rounded-2xl p-8 shadow-sm flex items-center justify-center">
              <div className="text-center">
                <BarChart3 className="w-10 h-10 text-text-muted/40 mx-auto mb-3" />
                <p className="text-xs text-text-muted">
                  Select a sequence from the left to view its analytics.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Send-time optimization info */}
      <div className="bg-card-bg border border-card-border rounded-2xl p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-xl bg-brand-orange/10 border border-brand-orange/20 flex items-center justify-center text-brand-orange-text flex-shrink-0">
            <Clock className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-display font-bold text-sm text-text-primary mb-1">Smart Send-Time Optimization</h3>
            <p className="type-body text-text-muted leading-relaxed max-w-[68ch]">
              Emails are scheduled inside each step&apos;s send window in the lead&apos;s timezone, spread across the
              window rather than sent in a burst, and each mailbox stays within its own daily and hourly caps.
              A/B subject lines are tested for templates with variants configured.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
