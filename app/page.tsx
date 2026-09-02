import Link from "next/link";
import {
  Bot,
  Building2,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  HelpCircle,
  MoreVertical,
  Settings,
  ShieldCheck,
  Upload,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getDashboardAggregate } from "@/lib/server/dashboard/aggregates";

// DB-backed dashboard — render per request, never prerender at build (no DB in CI/Docker build).
export const dynamic = "force-dynamic";

type InsightItem = {
  label: string;
  count: number;
};

export default async function Home() {
  const dashboard = await getDashboardAggregate();
  const totalCompanies = dashboard.kpis.totalCompanies;
  const reviewQueueTotal =
    dashboard.managerReview.summary.open +
    dashboard.managerReview.summary.needsFollowUp;

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="space-y-4 px-5 py-5 sm:px-6">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-950">Dashboard</h1>
            <p className="mt-1 text-sm text-slate-500">
              Track pipeline health, uploads, review progress, and SDR activity.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild className="h-9 bg-blue-600 px-4 text-white hover:bg-blue-700">
              <Link href="/uploads">
                <Upload className="h-4 w-4" aria-hidden="true" />
                Upload CSV
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-9 bg-white">
              <Link href="/manager-review">
                <Users className="h-4 w-4" aria-hidden="true" />
                Open Review Queue
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-9 bg-white">
              <Link href="/exports">
                <Download className="h-4 w-4" aria-hidden="true" />
                Export Report
              </Link>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9 bg-white"
              aria-label="More dashboard options"
            >
              <MoreVertical className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <KpiCard
            label="Total companies"
            value={totalCompanies}
            helper="Current active total"
            icon={FileText}
            tone="blue"
          />
          <KpiCard
            label="Qualified"
            value={dashboard.kpis.qualified}
            helper={formatPercentHelper(dashboard.kpis.qualified, totalCompanies)}
            icon={CheckCircle2}
            tone="emerald"
          />
          <KpiCard
            label="Uncertain"
            value={dashboard.kpis.uncertain}
            helper={formatPercentHelper(dashboard.kpis.uncertain, totalCompanies)}
            icon={HelpCircle}
            tone="amber"
          />
          <KpiCard
            label="Needs review"
            value={dashboard.kpis.needsReview}
            helper="Open review items"
            icon={Users}
            tone="rose"
          />
          <KpiCard
            label="Reviewed today"
            value={dashboard.kpis.reviewedToday}
            helper="Feedback + manager reviews"
            icon={Clock}
            tone="violet"
          />
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr_0.85fr]">
          <UploadActivityCard
            total={dashboard.recentUploads.total}
            uploads={dashboard.recentUploads.items}
          />
          <ReviewPipelineCard
            totalCompanies={dashboard.reviewPipeline.totalCompanies}
            reviewedCompanyCount={dashboard.reviewPipeline.reviewedCompanyCount}
            needsReviewCount={dashboard.reviewPipeline.needsReviewCount}
            qualificationMix={dashboard.reviewPipeline.qualificationMix}
          />
          <AiResearchSummaryCard
            enabled={dashboard.aiSummary.status.enabled}
            usable={dashboard.aiSummary.status.usable}
            provider={dashboard.aiSummary.status.provider}
            model={dashboard.aiSummary.status.model}
            reason={dashboard.aiSummary.status.reason}
            assessments7d={dashboard.aiSummary.assessments7d}
            averageConfidence={dashboard.aiSummary.averageConfidence}
          />
        </section>

        <section className="grid gap-4 xl:grid-cols-[1fr_0.8fr_0.9fr]">
          <ManagerReviewQueueCard
            totalInQueue={reviewQueueTotal}
            summary={dashboard.managerReview.summary}
            items={dashboard.managerReview.items}
          />
          <RecentSdrActivityCard
            companiesAdded7d={dashboard.recentSdrActivity.companiesAdded7d}
            contactsAdded7d={dashboard.recentSdrActivity.contactsAdded7d}
            activityRowsAdded7d={dashboard.recentSdrActivity.activityRowsAdded7d}
            activityUploadTotal={dashboard.recentSdrActivity.activityUploadTotal}
          />
          <TopInsightsCard
            countries={dashboard.insights.countries}
            companyTypes={dashboard.insights.companyTypes}
            qualifications={dashboard.insights.qualifications}
            totalCompanies={totalCompanies}
          />
        </section>

        <footer className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-4">
            {dashboard.lastUpdated ? (
              <span>Last updated: {formatDateTime(dashboard.lastUpdated)}</span>
            ) : null}
            <span>Data refreshes on page load</span>
          </div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-slate-400" aria-hidden="true" />
            <span>Data is refreshed from local database</span>
          </div>
        </footer>
      </div>
    </main>
  );
}

function KpiCard({
  label,
  value,
  helper,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  helper: string;
  icon: typeof Building2;
  tone: "blue" | "emerald" | "amber" | "rose" | "violet";
}) {
  const toneClass = {
    blue: "bg-blue-50 text-blue-700",
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    rose: "bg-rose-50 text-rose-700",
    violet: "bg-violet-50 text-violet-700",
  }[tone];

  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardContent className="flex min-h-24 items-center gap-4 p-4">
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${toneClass}`}>
          <Icon className="h-6 w-6" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-600">{label}</div>
          <div className="mt-1 text-2xl font-semibold text-slate-950">
            {formatNumber(value)}
          </div>
          <div className="mt-1 text-xs text-slate-500">{helper}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function UploadActivityCard({
  total,
  uploads,
}: {
  total: number;
  uploads: Array<{
    id: string;
    fileName: string;
    status: string;
    totalRows: number;
    processedRows: number;
    createdAt: Date;
  }>;
}) {
  return (
    <DashboardCard
      title="Upload activity"
      action={
        <Button asChild variant="outline" size="sm" className="bg-white">
          <Link href="/uploads">View all uploads</Link>
        </Button>
      }
    >
      {uploads.length === 0 ? (
        <EmptyCardText>No uploads yet. Upload a company CSV to start.</EmptyCardText>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Rows</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {uploads.map((upload) => {
                const progress = getProgress(upload.processedRows, upload.totalRows);
                return (
                  <TableRow key={upload.id}>
                    <TableCell className="max-w-52 truncate font-medium text-slate-900">
                      {upload.fileName}
                    </TableCell>
                    <TableCell>
                      <StatusPill status={upload.status} />
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {formatNumber(upload.totalRows)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-blue-600"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-500">{progress}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {formatShortDate(upload.createdAt)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <CardFooterLink href="/uploads">
            Showing 1 to {uploads.length} of {total} uploads
          </CardFooterLink>
        </>
      )}
    </DashboardCard>
  );
}

function ReviewPipelineCard({
  totalCompanies,
  reviewedCompanyCount,
  needsReviewCount,
  qualificationMix,
}: {
  totalCompanies: number;
  reviewedCompanyCount: number;
  needsReviewCount: number;
  qualificationMix: {
    qualified: number;
    uncertain: number;
    unqualified: number;
    unscored: number;
  };
}) {
  const segments = [
    { label: "Qualified", count: qualificationMix.qualified, color: "bg-emerald-500" },
    { label: "Uncertain", count: qualificationMix.uncertain, color: "bg-amber-500" },
    { label: "Unqualified", count: qualificationMix.unqualified, color: "bg-rose-500" },
    { label: "SDR reviewed", count: reviewedCompanyCount, color: "bg-blue-500" },
  ].filter((segment) => segment.count > 0 || totalCompanies > 0);

  return (
    <DashboardCard
      title="Review pipeline"
      action={
        <Button asChild variant="outline" size="sm" className="bg-white">
          <Link href="/companies">View full pipeline</Link>
        </Button>
      }
    >
      {totalCompanies === 0 ? (
        <EmptyCardText>No companies yet. Upload a CSV to start scoring.</EmptyCardText>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-5 md:grid-cols-[150px_minmax(0,1fr)] md:items-center">
            <div className="relative mx-auto flex h-36 w-36 items-center justify-center rounded-full bg-slate-100">
              <div
                className="absolute inset-0 rounded-full"
                style={{
                  background: buildConicGradient([
                    { color: "#10b981", value: qualificationMix.qualified },
                    { color: "#f59e0b", value: qualificationMix.uncertain },
                    { color: "#f43f5e", value: qualificationMix.unqualified },
                    { color: "#3b82f6", value: reviewedCompanyCount },
                  ]),
                }}
              />
              <div className="absolute inset-4 rounded-full bg-white" />
              <div className="relative text-center">
                <div className="text-xl font-semibold text-slate-950">
                  {formatNumber(totalCompanies)}
                </div>
                <div className="text-xs text-slate-500">Total</div>
              </div>
            </div>
            <div className="space-y-3">
              {segments.map((segment) => (
                <LegendRow
                  key={segment.label}
                  label={segment.label}
                  count={segment.count}
                  total={totalCompanies}
                  colorClass={segment.color}
                />
              ))}
            </div>
          </div>
          <CardFooterLink href="/manager-review">
            {formatNumber(needsReviewCount)} review items are currently open or
            waiting for follow-up
          </CardFooterLink>
        </div>
      )}
    </DashboardCard>
  );
}

function AiResearchSummaryCard({
  enabled,
  usable,
  provider,
  model,
  reason,
  assessments7d,
  averageConfidence,
}: {
  enabled: boolean;
  usable: boolean;
  provider: string;
  model: string;
  reason: string | null;
  assessments7d: number;
  averageConfidence: number | null;
}) {
  return (
    <DashboardCard
      title="AI research summary"
      action={
        <Button asChild variant="outline" size="sm" className="bg-white">
          <Link href="/settings/ai">
            <Settings className="h-4 w-4" aria-hidden="true" />
            Settings
          </Link>
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-full ${
              usable ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
            }`}
          >
            <Bot className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900">
              AI {enabled ? "enabled" : "disabled"}
            </div>
            <div className="text-xs text-slate-500">
              {usable ? `${provider} · ${model}` : reason ?? "Not usable"}
            </div>
          </div>
        </div>
        <SummaryRow label="AI assessments checked (7d)" value={formatNumber(assessments7d)} />
        <SummaryRow label="AI match confidence (avg)" value={averageConfidence === null ? "—" : `${Math.round(averageConfidence * 100)}%`} />
        <SummaryRow label="Credits / request budget" value="Not tracked yet" />
        <SummaryRow label="Remaining capacity" value="—" />
        <CardFooterLink href="/settings/ai">Go to AI research</CardFooterLink>
      </div>
    </DashboardCard>
  );
}

function ManagerReviewQueueCard({
  totalInQueue,
  summary,
  items,
}: {
  totalInQueue: number;
  summary: {
    open: number;
    high: number;
    needsFollowUp: number;
    reviewed: number;
    dismissed: number;
  };
  items: Array<{
    id: string;
    status: string;
    priority: string;
    leadName: string | null;
    companyName: string | null;
    sdrName: string | null;
  }>;
}) {
  return (
    <DashboardCard
      title="Manager review queue"
      badge={
        <Badge
          variant="outline"
          className={
            totalInQueue > 0
              ? "border-rose-200 bg-rose-50 text-rose-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }
        >
          {totalInQueue > 0 ? "Needs attention" : "Clear"}
        </Badge>
      }
      action={
        <Button asChild variant="outline" size="sm" className="bg-white">
          <Link href="/manager-review">Go to queue</Link>
        </Button>
      }
    >
      <div className="space-y-3">
        <SummaryRow label="High priority reviews" value={formatNumber(summary.high)} tone="rose" />
        <SummaryRow label="Needs follow-up" value={formatNumber(summary.needsFollowUp)} tone="amber" />
        <SummaryRow label="Open reviews" value={formatNumber(summary.open)} tone="blue" />
        {items.length > 0 ? (
          <div className="space-y-2 pt-1">
            {items.slice(0, 3).map((item) => (
              <Link
                key={item.id}
                href={`/manager-review/${item.id}`}
                className="block rounded-lg border border-slate-100 px-3 py-2 text-xs hover:bg-slate-50"
              >
                <div className="font-medium text-slate-900">
                  {item.leadName || "Review item"}
                </div>
                <div className="mt-1 truncate text-slate-500">
                  {item.companyName || "No company"} · {item.sdrName || "No SDR"}
                </div>
              </Link>
            ))}
          </div>
        ) : null}
        <div className="border-t border-slate-100 pt-3 text-sm">
          <span className="text-slate-500">Total in queue</span>
          <span className="float-right font-semibold text-blue-700">
            {formatNumber(totalInQueue)}
          </span>
        </div>
      </div>
    </DashboardCard>
  );
}

function RecentSdrActivityCard({
  companiesAdded7d,
  contactsAdded7d,
  activityRowsAdded7d,
  activityUploadTotal,
}: {
  companiesAdded7d: number;
  contactsAdded7d: number;
  activityRowsAdded7d: number;
  activityUploadTotal: number;
}) {
  return (
    <DashboardCard
      title="Recent SDR activity"
      action={
        <Button asChild variant="outline" size="sm" className="bg-white">
          <Link href="/activity-recaps">View all activity</Link>
        </Button>
      }
    >
      <div className="space-y-3">
        <SummaryRow label="Companies added (7d)" value={formatNumber(companiesAdded7d)} tone="blue" />
        <SummaryRow label="Contacts added (7d)" value={formatNumber(contactsAdded7d)} tone="emerald" />
        <SummaryRow label="Activity rows added (7d)" value={formatNumber(activityRowsAdded7d)} tone="violet" />
        <SummaryRow label="Saved recap uploads" value={formatNumber(activityUploadTotal)} />
        <CardFooterLink href="/activity-recaps">View activity recaps</CardFooterLink>
      </div>
    </DashboardCard>
  );
}

function TopInsightsCard({
  countries,
  companyTypes,
  qualifications,
  totalCompanies,
}: {
  countries: InsightItem[];
  companyTypes: InsightItem[];
  qualifications: InsightItem[];
  totalCompanies: number;
}) {
  const maxCount = Math.max(
    1,
    ...countries.map((item) => item.count),
    ...companyTypes.map((item) => item.count),
    ...qualifications.map((item) => item.count)
  );

  return (
    <DashboardCard
      title="Top insights"
      action={
        <Button asChild variant="outline" size="sm" className="bg-white">
          <Link href="/exports">View full report</Link>
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 rounded-lg border border-slate-200 bg-slate-50 p-1 text-center text-xs font-medium text-slate-600">
          <span className="rounded-md bg-white px-2 py-1 text-slate-900 shadow-xs">
            Top countries
          </span>
          <span className="px-2 py-1">Top company types</span>
          <span className="px-2 py-1">Qualification mix</span>
        </div>
        {totalCompanies === 0 ? (
          <EmptyCardText>No insights available yet.</EmptyCardText>
        ) : (
          <div className="space-y-5">
            <InsightGroup items={countries} total={totalCompanies} maxCount={maxCount} />
            <InsightGroup items={companyTypes} total={totalCompanies} maxCount={maxCount} />
            <InsightGroup items={qualifications} total={totalCompanies} maxCount={maxCount} />
          </div>
        )}
        <CardFooterLink href="/exports">View all insights</CardFooterLink>
      </div>
    </DashboardCard>
  );
}

function DashboardCard({
  title,
  badge,
  action,
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="text-base font-semibold text-slate-950">
            {title}
          </CardTitle>
          {badge ? <div className="mt-2">{badge}</div> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function SummaryRow({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: string;
  tone?: "slate" | "blue" | "emerald" | "amber" | "rose" | "violet";
}) {
  const dotClass = {
    slate: "bg-slate-400",
    blue: "bg-blue-500",
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
    rose: "bg-rose-500",
    violet: "bg-violet-500",
  }[tone];

  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-2 last:border-b-0">
      <div className="flex min-w-0 items-center gap-2 text-sm text-slate-600">
        <span className={`h-2 w-2 rounded-full ${dotClass}`} />
        <span className="truncate">{label}</span>
      </div>
      <span className="shrink-0 text-sm font-semibold text-slate-950">{value}</span>
    </div>
  );
}

function LegendRow({
  label,
  count,
  total,
  colorClass,
}: {
  label: string;
  count: number;
  total: number;
  colorClass: string;
}) {
  const percent = total > 0 ? Math.round((count / total) * 100) : 0;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${colorClass}`} />
        <span className="truncate text-slate-600">{label}</span>
      </div>
      <span className="font-semibold text-slate-950">{formatNumber(count)}</span>
      <span className="w-12 text-right text-xs text-slate-500">{percent}%</span>
    </div>
  );
}

function InsightGroup({
  items,
  total,
  maxCount,
}: {
  items: InsightItem[];
  total: number;
  maxCount: number;
}) {
  if (items.length === 0) {
    return (
      <div className="text-xs text-slate-500">No insight rows available.</div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => {
        const width = Math.max(4, Math.round((item.count / maxCount) * 100));
        return (
          <div
            key={item.label}
            className="grid grid-cols-[minmax(110px,0.8fr)_minmax(90px,1fr)_90px] items-center gap-3 text-xs"
          >
            <span className="truncate font-medium text-slate-700">{item.label}</span>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-blue-600"
                style={{ width: `${width}%` }}
              />
            </div>
            <span className="text-right text-slate-600">
              {formatNumber(item.count)} ({formatPercent(item.count, total)})
            </span>
          </div>
        );
      })}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const className =
    status === "completed"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "processing"
        ? "border-blue-200 bg-blue-50 text-blue-700"
        : status === "queued"
          ? "border-amber-200 bg-amber-50 text-amber-700"
          : status === "failed"
            ? "border-rose-200 bg-rose-50 text-rose-700"
            : "border-slate-200 bg-slate-100 text-slate-600";

  return (
    <Badge variant="outline" className={className}>
      {status}
    </Badge>
  );
}

function CardFooterLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3 border-t border-slate-100 pt-3 text-sm">
      <Link className="font-medium text-blue-700 hover:underline" href={href}>
        {children} →
      </Link>
    </div>
  );
}

function EmptyCardText({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}

function buildConicGradient(segments: Array<{ color: string; value: number }>) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (total === 0) {
    return "#e2e8f0";
  }

  let cursor = 0;
  const stops = segments
    .filter((segment) => segment.value > 0)
    .map((segment) => {
      const start = cursor;
      cursor += (segment.value / total) * 100;
      return `${segment.color} ${start}% ${cursor}%`;
    });

  return `conic-gradient(${stops.join(", ")})`;
}

function getProgress(processedRows: number, totalRows: number) {
  if (totalRows <= 0) {
    return 0;
  }

  return Math.min(100, Math.round((processedRows / totalRows) * 100));
}

function formatPercentHelper(value: number, total: number) {
  return total > 0 ? `${formatPercent(value, total)} of total` : "No companies yet";
}

function formatPercent(value: number, total: number) {
  if (total <= 0) {
    return "0%";
  }

  return `${Math.round((value / total) * 100)}%`;
}

function formatNumber(value: number) {
  return value.toLocaleString("en-US");
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function formatShortDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
  }).format(value);
}
