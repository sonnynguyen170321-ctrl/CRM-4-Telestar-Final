'use client';

import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from 'recharts';

/**
 * Health score over time from EmailHealthSnapshot rows.
 *
 * Loaded via next/dynamic with ssr:false by the parent — recharts is heavy and
 * next.config.ts already lists it under optimizePackageImports.
 */

export interface TrendPoint {
  windowEnd: string;
  healthScore: number;
  sentCount: number;
  hardBounceCount: number;
  replyCount: number;
}

const HEALTHY_MIN = 90;
const AT_RISK_MIN = 50;

type Props = { points: TrendPoint[] };

export default function EmailHealthTrendChart({ points }: Props) {
  if (points.length < 2) {
    return (
      <div className="h-40 flex items-center justify-center text-xs text-text-muted text-center px-4">
        Not enough history yet — the trend appears once the hourly health check has run a few times.
      </div>
    );
  }

  const data = points.map((p) => ({
    ...p,
    label: new Date(p.windowEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }));

  return (
    <div className="h-40">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={{
              background: 'var(--card-bg)',
              border: '1px solid var(--card-border)',
              borderRadius: 8,
              fontSize: 11,
            }}
            formatter={(value) => [value as number, 'Health score']}
          />
          <ReferenceLine y={HEALTHY_MIN} stroke="var(--channel-whatsapp)" strokeDasharray="4 4" strokeOpacity={0.5} />
          <ReferenceLine y={AT_RISK_MIN} stroke="var(--brand-red)" strokeDasharray="4 4" strokeOpacity={0.5} />
          <Line
            type="monotone"
            dataKey="healthScore"
            stroke="var(--brand-orange)"
            strokeWidth={2}
            dot={{ r: 2 }}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
