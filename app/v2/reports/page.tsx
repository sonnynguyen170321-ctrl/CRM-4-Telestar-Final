import { BarChart3, MousePointerClick, ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/shared/PageHeader";
import { AnalyticsNav } from "@/components/v2/shell/WorkspaceClusterNav";
import { PanelCard } from "@/components/shared/PanelCard";
import { MetricCard } from "@/components/shared/MetricCard";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { WorkspaceMetricGrid } from "@/components/shared/WorkspaceMetricGrid";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { queryOutreachReport } from "@/lib/v2/outreach/reporting/queryOutreachReport";
import { getTenantErrorMessage, requirePermission, V2TenantError } from "@/lib/v2/tenant";

// O8 / U2 surface: Outreach reports. Binds queryOutreachReport for delivery,
// replies, meetings, compliance, sender health, and verified CTD tracking metrics.
// Open/click are hidden when tracking is not verified, never shown as fake zeroes.

export default async function V2ReportsPage() {
  const context = await getReportsContext();
  if (context instanceof V2TenantError) {
    const msg = getTenantErrorMessage(context);
    return (
      <WorkspaceFrame>
        <div className="max-w-xl rounded-xl border border-hairline bg-surface p-6 shadow-premium">
          <div className="text-sm font-bold text-foreground">{msg.title}</div>
          <p className="mt-2 text-sm text-muted-foreground">{msg.message}</p>
        </div>
      </WorkspaceFrame>
    );
  }

  const report = await queryOutreachReport(context.organizationId);
  const { totals, perSender, tracking } = report;
  const pct = (n: number) => `${Math.round(n * 100)}%`;

  const senderColumns: DataTableColumn<typeof perSender[number]>[] = [
    {
      key: "sender",
      header: "Sender",
      cell: (s) => <span className="font-medium text-foreground">{s.fromAddress || s.displayName || "Sender address unavailable"}</span>,
    },
    {
      key: "kind",
      header: "Kind",
      cell: (s) => <span className="text-foreground/80">{s.kind}</span>,
    },
    {
      key: "volume",
      header: "Today / cap",
      cell: (s) => (
        <span className="tabular-nums text-foreground/80">
          {s.sentToday} / {s.effectiveCap} <span className="text-muted-foreground">({pct(s.capUtilization)})</span>
        </span>
      ),
    },
    {
      key: "bounce",
      header: "Bounce",
      cell: (s) => <span className="tabular-nums text-foreground/80">{pct(s.bounceRate)}</span>,
    },
    {
      key: "health",
      header: "Health",
      cell: (s) => (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold border ${s.healthy ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400"}`}>
          {s.healthy ? "Healthy" : "Degraded"}
        </span>
      ),
    },
  ];

  return (
    <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0">
      <PageHeader
        title="Outreach performance"
        description="Delivery, replies, sender health, and verified tracking-domain engagement when tracking is live."
      />

      <div className="space-y-5 p-5 sm:p-6">
        <AnalyticsNav />
        <WorkspaceMetricGrid>
          <MetricCard label="Sent" value={totals.sent} description={`${totals.delivered} delivered`} />
          <MetricCard label="Bounced" value={totals.bounced} description={`${pct(totals.bounceRate)} bounce`} />
          <MetricCard label="Replied" value={totals.replied} description={`${pct(totals.replyRate)} reply`} />
          <MetricCard label="Meetings booked" value={totals.meetingsBooked} />
        </WorkspaceMetricGrid>

        {tracking.available ? (
          <WorkspaceMetricGrid>
            <MetricCard
              label="Unique opens"
              value={tracking.uniqueOpens}
              description={`${pct(tracking.openRate)} of delivered`}
              icon={BarChart3}
            />
            <MetricCard
              label="Unique clicks"
              value={tracking.uniqueClicks}
              description={`${pct(tracking.clickRate)} of delivered`}
              icon={MousePointerClick}
            />
            <MetricCard label="Open events" value={tracking.totalOpens} description="Human-classified CTD events" />
            <MetricCard label="Click events" value={tracking.totalClicks} description="Human-classified CTD events" />
          </WorkspaceMetricGrid>
        ) : (
          <PanelCard title="Tracking-domain metrics" contentClassName="p-4">
            <div className="flex gap-3 text-sm leading-6 text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <p>
                No verified tracking domain is available, so open/click metrics are hidden instead of
                being reported as zero. Verify a custom tracking domain on the Senders page to surface
                human-classified engagement events here.
              </p>
            </div>
          </PanelCard>
        )}

        <div className="grid gap-5 lg:grid-cols-3">
          <PanelCard title="Suppression & compliance" contentClassName="p-5" className="lg:col-span-1">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Suppression entries</span><span className="font-semibold tabular-nums text-foreground">{totals.suppressionBlocks}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Unsubscribed</span><span className="font-semibold tabular-nums text-foreground">{totals.unsubscribed}</span></div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Suppression is still enforced synchronously before every provider send.</p>
          </PanelCard>

          <PanelCard title="Sender health & volume" contentClassName="p-0" className="lg:col-span-2">
            <DataTable
              columns={senderColumns}
              rows={perSender}
              getRowId={(s) => s.senderId}
              minWidth="min-w-[560px]"
              empty={<p className="px-4 py-8 text-center text-sm text-muted-foreground">No sender accounts yet.</p>}
              className="border-none shadow-none rounded-none bg-transparent"
            />
          </PanelCard>
        </div>
      </div>
    </WorkspaceFrame>
  );
}

async function getReportsContext() {
  try {
    return await requirePermission("crm.read");
  } catch (error) {
    if (error instanceof V2TenantError) return error;
    throw error;
  }
}
