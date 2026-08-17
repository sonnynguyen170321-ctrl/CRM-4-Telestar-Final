'use client';

import React from 'react';
import { 
  Flame, 
  TrendingUp, 
  Award, 
  Activity,
  CheckCircle2,
  Send,
} from 'lucide-react';

interface LiveFloorPulseProps {
  meetingsToday?: number;
  dailyTarget?: number;
  topReps?: Array<{ name: string; meetings: number; calls: number; emails: number }>;
}

export default function LiveFloorPulse({
  meetingsToday = 6,
  dailyTarget = 8,
  topReps = [
    { name: 'Lan Pham', meetings: 3, calls: 42, emails: 68 },
    { name: 'David Miller', meetings: 2, calls: 38, emails: 54 },
    { name: 'Carlos Reyes', meetings: 1, calls: 29, emails: 41 },
  ],
}: LiveFloorPulseProps) {
  const percent = Math.min(100, Math.round((meetingsToday / (dailyTarget || 1)) * 100));

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-2">
      {/* Floor Daily Target Card */}
      <div className="bg-gradient-to-br from-bg-card to-brand-red/[0.04] border border-card-border dark:border-zinc-800 rounded-2xl p-4.5 shadow-sm space-y-3 relative overflow-hidden">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-brand-red/10 border border-brand-red/20 flex items-center justify-center text-brand-red">
              <Flame className="w-4 h-4" />
            </div>
            <div>
              <h4 className="font-display font-bold text-xs text-text-primary">Daily Meeting Target</h4>
              <p className="text-[11px] text-text-muted">Live sales floor quota</p>
            </div>
          </div>
          <span className="font-mono text-xs font-bold text-brand-red bg-brand-red/10 px-2 py-0.5 rounded-lg">
            {percent}% Quota
          </span>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <span className="font-mono font-extrabold text-2xl text-text-primary">
              {meetingsToday} <span className="text-xs font-normal text-text-muted">/ {dailyTarget} booked</span>
            </span>
            <span className="text-[11px] text-emerald-500 font-semibold flex items-center gap-0.5">
              <TrendingUp className="w-3 h-3" /> On Track
            </span>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-bg-main dark:bg-zinc-800 h-2 rounded-full overflow-hidden border border-card-border/50">
            <div
              className="bg-gradient-to-r from-brand-red to-brand-orange h-full rounded-full transition-all duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Top SDRs Podium */}
      <div className="bg-bg-card dark:bg-zinc-900 border border-card-border dark:border-zinc-800 rounded-2xl p-4.5 shadow-sm space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500">
              <Award className="w-4 h-4" />
            </div>
            <div>
              <h4 className="font-display font-bold text-xs text-text-primary">Floor Leaderboard</h4>
              <p className="text-[11px] text-text-muted">Top reps today</p>
            </div>
          </div>
          <span className="text-[10px] text-text-muted font-mono">Today</span>
        </div>

        <div className="space-y-1.5">
          {topReps.slice(0, 3).map((rep, idx) => (
            <div
              key={rep.name}
              className="flex items-center justify-between text-xs py-1.5 px-2.5 rounded-lg bg-bg-main/60 dark:bg-zinc-800/40 border border-card-border/30"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`font-mono text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center ${
                    idx === 0
                      ? 'bg-amber-500/20 text-amber-500 border border-amber-500/30'
                      : idx === 1
                      ? 'bg-zinc-400/20 text-zinc-300 border border-zinc-400/30'
                      : 'bg-amber-700/20 text-amber-600 border border-amber-700/30'
                  }`}
                >
                  {idx + 1}
                </span>
                <span className="font-semibold text-text-primary">{rep.name}</span>
              </div>
              <div className="flex items-center gap-2 font-mono text-[11px]">
                <span className="text-emerald-500 font-bold">{rep.meetings} demos</span>
                <span className="text-text-muted text-[10px]">({rep.calls}c / {rep.emails}e)</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Live Floor Activity Pulse */}
      <div className="bg-bg-card dark:bg-zinc-900 border border-card-border dark:border-zinc-800 rounded-2xl p-4.5 shadow-sm space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <h4 className="font-display font-bold text-xs text-text-primary">Live Activity Pulse</h4>
              <p className="text-[11px] text-text-muted">Real-time floor events</p>
            </div>
          </div>
          <span className="flex items-center gap-1 text-[10px] text-emerald-500 font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live
          </span>
        </div>

        <div className="space-y-1.5 text-[11px] text-text-secondary">
          <div className="py-1.5 px-2.5 rounded-lg bg-emerald-500/[0.06] border border-emerald-500/20 text-emerald-400 flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="truncate">Lan Pham booked a demo with Acme Technologies</span>
          </div>
          <div className="py-1.5 px-2.5 rounded-lg bg-bg-main/60 dark:bg-zinc-800/40 border border-card-border/30 text-text-muted flex items-center gap-2">
            <Send className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span className="truncate">Cold Outreach sequence dispatched to 14 leads</span>
          </div>
        </div>
      </div>
    </div>
  );
}
