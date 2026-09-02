"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// Daily outreach trend (sends / opens / replies / meetings). Client island — the page
// stays a server component and passes plain points. Recharts handles the area chart.

export type TrendPoint = {
  date: string;
  sent: number;
  opened: number;
  replied: number;
  meetings: number;
};

const SERIES = [
  { key: "sent", label: "Sent", color: "#3b82f6" },
  { key: "opened", label: "Opens", color: "#8b5cf6" },
  { key: "replied", label: "Replies", color: "#10b981" },
  { key: "meetings", label: "Meetings", color: "#f59e0b" },
] as const;

export function TrendAreaChart({
  data,
  showOpens = true,
}: {
  data: TrendPoint[];
  showOpens?: boolean;
}) {
  const series = SERIES.filter((s) => s.key !== "opened" || showOpens);
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={s.color} stopOpacity={0.35} />
                <stop offset="95%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => d.slice(5)}
            tick={{ fontSize: 11, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
          />
          <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
          <Tooltip
            contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }}
            labelStyle={{ color: "#0f172a", fontWeight: 600 }}
          />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          {series.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              fill={`url(#grad-${s.key})`}
              dot={false}
              activeDot={{ r: 3 }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
