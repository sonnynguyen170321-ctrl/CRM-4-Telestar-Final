import Link from "next/link";
import type { ReactNode } from "react";
import { Sparkles, UserPlus, Search } from "lucide-react";

import type {
  CompanyDirectoryAggregates,
  CompanyHealthBucket,
  CompanyActivityKind,
} from "@/lib/v2/company-intelligence/companyDirectoryAggregates";

// P3: premium right sidebar for the company directory. Server-component safe — the
// donut is a CSS conic-gradient (no client JS). Every number is a real tenant-scoped
// aggregate. Health is enrichment/data-quality, not an ICP qualification (Inv 2).

const HEALTH_META: Record<CompanyHealthBucket, { label: string; color: string; dot: string }> = {
  HEALTHY: { label: "Healthy", color: "#10B981", dot: "bg-emerald-500" },
  WARNING: { label: "Warning", color: "#F59E0B", dot: "bg-amber-500" },
  NEEDS_ATTENTION: { label: "Needs attention", color: "#EF4444", dot: "bg-red-500" },
  UNKNOWN: { label: "Unknown", color: "#CBD5E1", dot: "bg-foreground" },
};

const ACTIVITY_META: Record<CompanyActivityKind, { verb: string; icon: ReactNode }> = {
  enriched: { verb: "was enriched", icon: <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> },
  lead_created: { verb: "new ICP assignment", icon: <UserPlus className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" /> },
  researched: { verb: "research ran", icon: <Search className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> },
};

export function CompanyDirectorySidebar({
  aggregates,
  query,
}: {
  aggregates: CompanyDirectoryAggregates;
  query: Record<string, string>;
}) {
  return (
    <div className="space-y-4">
      <HealthCard aggregates={aggregates} />
      <RankedCard
        title="Top industries"
        rows={aggregates.industries.map((i) => ({ key: i.id, label: i.label, count: i.count, href: buildHref(query, { industry: i.id, page: "", companyId: "" }) }))}
        total={aggregates.total}
        color="bg-primary"
        empty="No industries extracted yet."
      />
      <RankedCard
        title="Top countries"
        rows={aggregates.countries.map((c) => ({ key: c.country, label: c.country, count: c.count, href: buildHref(query, { country: c.country, page: "", companyId: "" }) }))}
        total={aggregates.total}
        color="bg-violet-500"
        empty="No country data yet."
      />
      <ActivityCard aggregates={aggregates} />
    </div>
  );
}

function HealthCard({ aggregates }: { aggregates: CompanyDirectoryAggregates }) {
  const { total, health } = aggregates;
  const gradient = buildConicGradient(health, total);

  return (
    <Card title="Company health overview">
      {total === 0 ? (
        <p className="text-sm text-muted-foreground">No companies yet.</p>
      ) : (
        <div className="flex items-center gap-4">
          <div className="relative h-28 w-28 shrink-0">
            <div className="h-28 w-28 rounded-full" style={{ background: gradient }} aria-hidden="true" />
            <div className="absolute inset-[14px] flex flex-col items-center justify-center rounded-full bg-white">
              <span className="text-lg font-bold tabular-nums text-foreground">{total.toLocaleString()}</span>
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Total</span>
            </div>
          </div>
          <ul className="min-w-0 flex-1 space-y-1.5">
            {health.map((h) => {
              const meta = HEALTH_META[h.bucket];
              const pct = total > 0 ? Math.round((h.count / total) * 1000) / 10 : 0;
              return (
                <li key={h.bucket} className="flex items-center justify-between gap-2 text-xs">
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} aria-hidden="true" />
                    <span className="truncate text-muted-foreground">{meta.label}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {pct}% <span className="text-muted-foreground">({h.count.toLocaleString()})</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}

function RankedCard({
  title, rows, total, color, empty,
}: {
  title: string;
  rows: Array<{ key: string; label: string; count: number; href: string }>;
  total: number;
  color: string;
  empty: string;
}) {
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((row) => {
            const pct = total > 0 ? Math.round((row.count / total) * 1000) / 10 : 0;
            return (
              <li key={row.key}>
                <Link href={row.href} className="group block">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-medium text-foreground group-hover:text-primary">{row.label}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{pct}% <span className="text-muted-foreground">({row.count.toLocaleString()})</span></span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function ActivityCard({ aggregates }: { aggregates: CompanyDirectoryAggregates }) {
  return (
    <Card title="Recent company activity">
      {aggregates.recentActivity.length === 0 ? (
        <p className="text-sm text-muted-foreground">No recent activity.</p>
      ) : (
        <ul className="space-y-2.5">
          {aggregates.recentActivity.map((event, i) => {
            const meta = ACTIVITY_META[event.kind];
            return (
              <li key={i} className="flex items-start gap-2 text-xs">
                <span className="mt-0.5 shrink-0">{meta.icon}</span>
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-foreground">{event.companyName}</span>{" "}
                  <span className="text-muted-foreground">{meta.verb}</span>
                  <div className="text-[11px] text-muted-foreground">{relativeTime(event.occurredAt)}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function Card({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function buildConicGradient(
  health: Array<{ bucket: CompanyHealthBucket; count: number }>,
  total: number
): string {
  if (total === 0) return HEALTH_META.UNKNOWN.color;
  const stops: string[] = [];
  let acc = 0;
  for (const h of health) {
    if (h.count === 0) continue;
    const start = (acc / total) * 360;
    acc += h.count;
    const end = (acc / total) * 360;
    stops.push(`${HEALTH_META[h.bucket].color} ${start}deg ${end}deg`);
  }
  return `conic-gradient(${stops.join(", ")})`;
}

function buildHref(query: Record<string, string>, updates: Record<string, string>) {
  const params = new URLSearchParams(query);
  for (const [key, value] of Object.entries(updates)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  return `/v2/crm/companies?${params.toString()}`;
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return "just now";
  const min = Math.floor(diffMs / 60_000);
  if (min < 60) return `${Math.max(1, min)}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}
