import Link from "next/link";
import { Activity, MailCheck, MessageSquareReply, Send, Users } from "lucide-react";

import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { PageHeader } from "@/components/shared/PageHeader";
import { CampaignNav } from "@/components/v2/outreach/CampaignNav";
import { CampaignLeaderboard } from "@/components/v2/outreach/CampaignLeaderboard";
import { FunnelChart } from "@/components/v2/outreach/charts/FunnelChart";
import { TrendAreaChart } from "@/components/v2/outreach/charts/TrendAreaChart";
import {
  queryCampaignPerformance,
  normalizeWindowDays,
} from "@/lib/v2/outreach/reporting/queryCampaignPerformance";
import {
  getTenantErrorMessage,
  requirePermission,
  V2TenantError,
} from "@/lib/v2/tenant";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const WINDOWS = [7, 30, 90];

export default async function CampaignPerformancePage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const tenantContext = await getContext();
  if (tenantContext instanceof V2TenantError) return <Denied error={tenantContext} />;

  const windowDays = normalizeWindowDays(getParam(raw, "window"));
  const perf = await queryCampaignPerformance(tenantContext.organizationId, { windowDays });
  const { funnel } = perf;
  const replyRate = funnel.delivered > 0 ? Math.round((funnel.replied / funnel.delivered) * 100) : 0;

  return (
    <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0">
      <PageHeader
        eyebrow="Outreach"
        title="Campaign performance"
        description="Track every campaign — funnel, daily trends, and a reply-rate leaderboard."
      />
      <main className="space-y-5 px-6 py-5">
        <CampaignNav active="performance" />

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <Metric label="Enrolled" value={funnel.enrolled} icon={Users} tone="slate" />
          <Metric label="Sent" value={funnel.sent} icon={Send} tone="blue" />
          <Metric label="Delivered" value={funnel.delivered} icon={MailCheck} tone="sky" />
          <Metric label="Opens" value={funnel.opened} icon={Activity} tone="violet" />
          <Metric label="Replies" value={funnel.replied} icon={MessageSquareReply} tone="emerald" detail={`${replyRate}% of delivered`} />
          <Metric label="Meetings" value={funnel.meetings} icon={Activity} tone="amber" />
        </section>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-xl border border-border bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Daily trend</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">Sends, opens, replies and meetings per day</p>
              </div>
              <div className="inline-flex overflow-hidden rounded-md border border-border text-xs">
                {WINDOWS.map((w) => (
                  <Link
                    key={w}
                    href={`/v2/outreach/performance?window=${w}`}
                    className={`px-2.5 py-1 ${w === windowDays ? "bg-primary text-white" : "bg-white text-muted-foreground hover:bg-muted/40"}`}
                  >
                    {w}d
                  </Link>
                ))}
              </div>
            </div>
            <TrendAreaChart data={perf.trend} showOpens={perf.trackingAvailable} />
          </section>

          <section className="rounded-xl border border-border bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-foreground">Conversion funnel</h2>
            <FunnelChart funnel={funnel} trackingAvailable={perf.trackingAvailable} />
          </section>
        </div>

        <CampaignLeaderboard rows={perf.leaderboard} />
      </main>
    </WorkspaceFrame>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
  tone,
  detail,
}: {
  label: string;
  value: number | null;
  icon: typeof Users;
  tone: "slate" | "blue" | "sky" | "violet" | "emerald" | "amber";
  detail?: string;
}) {
  const color = {
    slate: "text-foreground",
    blue: "text-primary",
    sky: "text-sky-700",
    violet: "text-violet-700",
    emerald: "text-emerald-700",
    amber: "text-amber-700",
  }[tone];
  return (
    <div className="rounded-xl border border-border bg-white p-3.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> {label}
      </div>
      <div className={`mt-1 text-2xl font-bold tracking-tight ${color}`}>
        {value === null ? "—" : value.toLocaleString()}
      </div>
      {detail ? <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{detail}</div> : null}
    </div>
  );
}

async function getContext() {
  try {
    return await requirePermission("crm.read");
  } catch (error) {
    if (error instanceof V2TenantError) return error;
    throw error;
  }
}

function Denied({ error }: { error: V2TenantError }) {
  const message = getTenantErrorMessage(error);
  return (
    <WorkspaceFrame className="flex items-center justify-center">
      <div className="max-w-xl rounded-lg border border-border bg-white p-6 text-center">
        <div className="text-sm font-semibold text-foreground">{message.title}</div>
        <p className="mt-2 text-sm text-muted-foreground">{message.message}</p>
      </div>
    </WorkspaceFrame>
  );
}

function getParam(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  const first = Array.isArray(value) ? value[0] : value;
  return first && first.trim() ? first.trim() : undefined;
}
