'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

import type { PerformanceWindow, RateRow, SequencePerformance } from '@/lib/sequences/performance';

const WINDOWS: Array<{ value: PerformanceWindow; label: string }> = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'all', label: 'All time' },
];

/** A rate the sequence does not measure shows as "Off", never as 0%. */
function formatRate(value: number | null, measured: boolean): string {
  if (!measured) return 'Off';
  return value === null ? '—' : `${value}%`;
}

function RateCells({ row, tracking }: { row: RateRow; tracking: SequencePerformance['tracking'] }) {
  return (
    <>
      <td className="px-3 py-2 text-right font-mono">{row.sent}</td>
      <td className="px-3 py-2 text-right font-mono font-semibold">{formatRate(row.replyRate, true)}</td>
      <td className="px-3 py-2 text-right font-mono">{formatRate(row.bounceRate, true)}</td>
      <td className="px-3 py-2 text-right font-mono">{formatRate(row.openRate, tracking.opens || row.openTracked > 0)}</td>
      <td className="px-3 py-2 text-right font-mono">{formatRate(row.clickRate, tracking.clicks)}</td>
    </>
  );
}

/**
 * Sequence performance tab (lib/sequences/performance.ts): enrollments by status, then sent / open /
 * click / reply / bounce rates for the cadence and for each step, over a chosen window.
 */
export function SequencePerformancePanel({ sequenceId }: { sequenceId: string }) {
  const [range, setRange] = useState<PerformanceWindow>('30d');
  const [data, setData] = useState<SequencePerformance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // A different sequence must never show the previous one's numbers while its own load.
  useEffect(() => {
    setData(null);
  }, [sequenceId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/sequences/${sequenceId}/performance?window=${range}`);
        if (cancelled) return;
        if (!res.ok) {
          setError('Could not load performance');
          return;
        }
        setData((await res.json()) as SequencePerformance);
      } catch {
        if (!cancelled) setError('Network error loading performance');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sequenceId, range]);

  const enrollmentTiles = data
    ? [
        { label: 'Enrolled', value: data.enrollments.total },
        { label: 'Active', value: data.enrollments.active },
        { label: 'Paused', value: data.enrollments.paused },
        { label: 'Completed', value: data.enrollments.completed },
        { label: 'Unenrolled', value: data.enrollments.unenrolled },
      ]
    : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">Performance</h3>
        <div className="flex gap-1" role="group" aria-label="Time window">
          {WINDOWS.map((option) => (
            <button
              key={option.value}
              onClick={() => setRange(option.value)}
              aria-pressed={range === option.value}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                range === option.value
                  ? 'bg-brand-red text-white'
                  : 'border border-card-border text-text-secondary hover:text-text-primary'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {loading && !data ? (
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading performance…
        </div>
      ) : error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {enrollmentTiles.map((tile) => (
              <div key={tile.label} className="bg-card-bg border border-card-border rounded-xl p-3">
                <div className="text-[11px] uppercase tracking-wide text-text-secondary">{tile.label}</div>
                <div className="text-lg font-semibold font-mono text-text-primary">{tile.value}</div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-text-secondary">
            Enrollment counts are current. Email numbers cover messages the provider accepted in the window. Reply
            rate is the number to steer by. The open rate is an estimate over emails that carried the tracking image:
            Apple Mail and security scanners load images on their own and are left out, which also drops some real
            opens.
            {!data.tracking.opens || !data.tracking.clicks
              ? ' Open and click tracking are turned on per sequence in Settings.'
              : ''}
          </p>
          <p className="text-[11px] text-text-secondary">
            A reply counts on the latest email the lead had received, so a step&apos;s reply rate means replies after
            that step.
          </p>
          <div
            className={`bg-card-bg border border-card-border rounded-xl overflow-x-auto transition-opacity ${loading ? 'opacity-50' : ''}`}
            aria-busy={loading}
          >
            <table className="w-full text-xs">
              <thead className="bg-bg-main text-text-secondary">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Step</th>
                  <th className="px-3 py-2 text-right font-semibold">Sent</th>
                  <th className="px-3 py-2 text-right font-semibold">Reply rate</th>
                  <th className="px-3 py-2 text-right font-semibold">Bounce rate</th>
                  <th className="px-3 py-2 text-right font-semibold" title="Estimate over emails that carried the tracking image">
                    Est. open rate
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">Click rate</th>
                </tr>
              </thead>
              <tbody className="text-text-primary">
                {data.steps.map((step) => (
                  <tr key={step.order ?? 'other'} className="border-t border-card-border">
                    <td className="px-3 py-2">
                      {step.order === null ? (
                        'Removed steps'
                      ) : (
                        <>
                          Step {step.order}
                          <span className="ml-1 text-text-secondary">· {step.channel ?? 'email'}</span>
                        </>
                      )}
                    </td>
                    <RateCells row={step} tracking={data.tracking} />
                  </tr>
                ))}
                <tr className="border-t border-card-border font-semibold bg-bg-main/40">
                  <td className="px-3 py-2">All steps</td>
                  <RateCells row={data.totals} tracking={data.tracking} />
                </tr>
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
