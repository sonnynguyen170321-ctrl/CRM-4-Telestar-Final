import Link from "next/link";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Clock3,
  MailWarning,
  Megaphone,
  MessageSquareReply,
  Plus,
  Send,
  ShieldAlert,
} from "lucide-react";

import { PageHeader } from "@/components/shared/PageHeader";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { CampaignNav } from "@/components/v2/outreach/CampaignNav";
import { CampaignRowMenu } from "@/components/v2/outreach/CampaignRowMenu";
import { CampaignStatusBadge } from "@/components/v2/outreach/CampaignStatusBadge";
import { DataState, DenseEntityTable, OutreachMetricTile, OutreachPanel, OutreachPill } from "@/components/v2/outreach/OutreachCommandPrimitives";
import {
  queryCampaigns,
  type CampaignReadinessCode,
  type CampaignSummary,
} from "@/lib/v2/outreach/campaigns/queryCampaigns";
import { getTenantErrorMessage, requirePermission, V2TenantError } from "@/lib/v2/tenant";

export const dynamic = "force-dynamic";

type CampaignFilter = "all" | "attention" | "active" | "draft" | "paused" | "completed";

type CampaignCommandRow = CampaignSummary & {
  progress: number;
  replyRate: number | null;
  nextAction: string;
  nextActionTone: "blue" | "green" | "amber" | "red" | "slate";
  riskLabel: string;
  riskTone: "blue" | "green" | "amber" | "red" | "slate";
  lastActivityLabel: string;
};

export default async function V2OutreachCampaignsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filter = normalizeFilter(pick(params, "filter"));
  const context = await getContext();
  if (context instanceof V2TenantError) {
    return <TenantDeniedState error={context} />;
  }

  const campaigns = await queryCampaigns(context.organizationId);
  const rows = campaigns.map(buildCampaignCommandRow);
  const filteredRows = rows.filter((row) => rowMatchesFilter(row, filter));
  const active = campaigns.filter((campaign) => campaign.status === "ACTIVE").length;
  const draftsNeedingSetup = campaigns.filter((campaign) => campaign.status === "DRAFT" && campaign.readiness.length > 0).length;
  const scheduled = campaigns.reduce((sum, campaign) => sum + Math.max(campaign.enrolledCount - campaign.sentCount, 0), 0);
  const sent = campaigns.reduce((sum, campaign) => sum + campaign.sentCount, 0);
  const replies = campaigns.reduce((sum, campaign) => sum + campaign.repliedCount, 0);
  const blocked = campaigns.filter((campaign) => campaign.readiness.length > 0).length;

  return (
    <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0">
      <PageHeader
        eyebrow="Outreach operations"
        title="Campaign command center"
        description="A dense operator view for campaign readiness, sender coverage, lead progress, and real delivery outcomes."
        actions={
          <Link
            href="/v2/outreach/campaigns/new"
            className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white shadow-sm outline-none transition-colors hover:bg-primary focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-2"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            New campaign
          </Link>
        }
      />

      <div className="space-y-5 p-5 sm:p-6">
        <CampaignNav active="campaigns" />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <OutreachMetricTile label="Active" value={active} description="Currently running" icon={Activity} tone="green" />
          <OutreachMetricTile label="Draft setup" value={draftsNeedingSetup} description="Drafts with blockers" icon={MailWarning} tone={draftsNeedingSetup > 0 ? "amber" : "neutral"} />
          <OutreachMetricTile label="Scheduled" value={scheduled} description="Enrolled not yet sent" icon={Clock3} tone="blue" />
          <OutreachMetricTile label="Sent" value={sent} description="Real message rows" icon={Send} />
          <OutreachMetricTile label="Replies" value={replies} description={sent > 0 ? `${Math.round((replies / sent) * 100)}% reply rate` : "No sends yet"} icon={MessageSquareReply} />
          <OutreachMetricTile label="Blocked" value={blocked} description="Readiness issues" icon={ShieldAlert} tone={blocked > 0 ? "amber" : "green"} />
        </div>

        {campaigns.length === 0 ? (
          <EmptyCampaigns />
        ) : (
          <OutreachPanel
            title="Campaign work queue"
            description="Rows are sorted by the V2 campaign read model. Next actions are computed from readiness, sender pool, lead progress, and delivery state."
            actions={<OutreachPill tone="blue">{filteredRows.length} shown</OutreachPill>}
          >
            <div className="space-y-4 p-4">
              <FilterTabs active={filter} rows={rows} />

              <div className="hidden md:block">
                <DenseEntityTable minWidth="1080px">
                  <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Campaign</th>
                      <th className="px-4 py-3 font-semibold">Status / readiness</th>
                      <th className="px-4 py-3 font-semibold">Leads / progress</th>
                      <th className="px-4 py-3 font-semibold">Sender health</th>
                      <th className="px-4 py-3 font-semibold">Last activity</th>
                      <th className="px-4 py-3 font-semibold">Next action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredRows.map((campaign) => (
                      <CampaignTableRow key={campaign.id} campaign={campaign} />
                    ))}
                  </tbody>
                </DenseEntityTable>
              </div>

              <div className="space-y-3 md:hidden">
                {filteredRows.map((campaign) => (
                  <CampaignMobileCard key={campaign.id} campaign={campaign} />
                ))}
              </div>

              {filteredRows.length === 0 ? (
                <DataState icon={CheckCircle2} title="Nothing in this filter" description="Switch filters or create a new campaign." />
              ) : null}
            </div>
          </OutreachPanel>
        )}
      </div>
    </WorkspaceFrame>
  );
}

function CampaignTableRow({ campaign }: { campaign: CampaignCommandRow }) {
  return (
    <tr className="align-top hover:bg-muted/40">
      <td className="px-4 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-accent text-primary">
            <Megaphone className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <Link href={`/v2/outreach/campaigns/${campaign.id}`} className="font-semibold text-foreground hover:text-primary">
              {campaign.name}
            </Link>
            <p className="mt-1 line-clamp-2 max-w-md text-xs leading-5 text-muted-foreground">
              {campaign.description || "No description yet."}
            </p>
          </div>
        </div>
      </td>
      <td className="px-4 py-4">
        <div className="flex flex-col items-start gap-2">
          <CampaignStatusBadge status={campaign.status} />
          <OutreachPill tone={campaign.riskTone}>{campaign.riskLabel}</OutreachPill>
          <ReadinessSummary readiness={campaign.readiness} />
        </div>
      </td>
      <td className="px-4 py-4">
        <div className="min-w-36">
          <div className="text-sm font-semibold tabular-nums text-foreground">{campaign.enrolledCount} enrolled</div>
          <div className="mt-1 text-xs text-muted-foreground">{campaign.sentCount} sent / {campaign.repliedCount} replied</div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div className="h-full rounded-full bg-primary" style={{ width: `${campaign.progress}%` }} />
          </div>
        </div>
      </td>
      <td className="px-4 py-4">
        <div className="text-sm font-semibold text-foreground">{campaign.liveSenderCount} live / {campaign.senderCount} pooled</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {campaign.trackingEnabled ? `${campaign.verifiedTrackingSenderCount} tracking-ready` : "Tracking disabled"}
        </div>
      </td>
      <td className="px-4 py-4 text-sm text-muted-foreground">{campaign.lastActivityLabel}</td>
      <td className="px-4 py-4">
        <div className="flex items-center gap-1.5">
          <Link
            href={`/v2/outreach/campaigns/${campaign.id}`}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-primary/20 bg-accent px-3 text-sm font-semibold text-primary outline-none hover:bg-accent/70 focus-visible:ring-2 focus-visible:ring-primary/20"
          >
            {campaign.nextAction}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <CampaignRowMenu campaignId={campaign.id} name={campaign.name} status={campaign.status} />
        </div>
      </td>
    </tr>
  );
}

function CampaignMobileCard({ campaign }: { campaign: CampaignCommandRow }) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/v2/outreach/campaigns/${campaign.id}`} className="font-semibold text-foreground">
            {campaign.name}
          </Link>
          <div className="mt-1 text-xs text-muted-foreground">{campaign.enrolledCount} leads / {campaign.sentCount} sent</div>
        </div>
        <div className="flex items-center gap-1.5">
          <CampaignStatusBadge status={campaign.status} />
          <CampaignRowMenu campaignId={campaign.id} name={campaign.name} status={campaign.status} />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <OutreachPill tone={campaign.riskTone}>{campaign.riskLabel}</OutreachPill>
        <OutreachPill tone={campaign.liveSenderCount > 0 ? "green" : "amber"}>{campaign.liveSenderCount} live senders</OutreachPill>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full rounded-full bg-primary" style={{ width: `${campaign.progress}%` }} />
      </div>
      <Link href={`/v2/outreach/campaigns/${campaign.id}`} className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold text-white">
        {campaign.nextAction}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

function FilterTabs({ active, rows }: { active: CampaignFilter; rows: CampaignCommandRow[] }) {
  const tabs: Array<{ key: CampaignFilter; label: string }> = [
    { key: "all", label: "All" },
    { key: "attention", label: "Needs attention" },
    { key: "active", label: "Active" },
    { key: "draft", label: "Draft" },
    { key: "paused", label: "Paused" },
    { key: "completed", label: "Completed" },
  ];
  return (
    <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Campaign filters">
      {tabs.map((tab) => {
        const selected = active === tab.key;
        const count = rows.filter((row) => rowMatchesFilter(row, tab.key)).length;
        return (
          <Link
            key={tab.key}
            href={tab.key === "all" ? "/v2/outreach/campaigns" : `/v2/outreach/campaigns?filter=${tab.key}`}
            className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-primary/20 ${selected ? "border-primary/20 bg-accent text-primary" : "border-border bg-card text-muted-foreground hover:bg-muted/40"}`}
          >
            {tab.label}
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">{count}</span>
          </Link>
        );
      })}
    </div>
  );
}

function ReadinessSummary({ readiness }: { readiness: CampaignReadinessCode[] }) {
  if (readiness.length === 0) {
    return <span className="text-xs text-emerald-700">Configuration ready</span>;
  }
  return (
    <div className="max-w-52 text-xs leading-5 text-muted-foreground">
      {readiness.slice(0, 2).map((code) => READINESS_LABELS[code]).join(" / ")}
      {readiness.length > 2 ? ` +${readiness.length - 2} more` : ""}
    </div>
  );
}

function EmptyCampaigns() {
  return (
    <OutreachPanel title="Create your first campaign" description="Build a draft, add variants, connect senders, enroll leads, then launch from the campaign workspace.">
      <DataState
        icon={Megaphone}
        title="No campaigns yet"
        description="Start a draft campaign and preserve lead-source params from V2 leads when present."
        action={
          <Link href="/v2/outreach/campaigns/new" className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary">
            <Plus className="h-4 w-4" aria-hidden="true" />
            New campaign
          </Link>
        }
      />
    </OutreachPanel>
  );
}

function TenantDeniedState({ error }: { error: V2TenantError }) {
  const message = getTenantErrorMessage(error);
  return (
    <WorkspaceFrame>
      <OutreachPanel title={message.title}>
        <p className="p-4 text-sm text-muted-foreground">{message.message}</p>
      </OutreachPanel>
    </WorkspaceFrame>
  );
}

function buildCampaignCommandRow(campaign: CampaignSummary): CampaignCommandRow {
  const progress = campaign.enrolledCount > 0 ? Math.min(100, Math.round((campaign.sentCount / campaign.enrolledCount) * 100)) : 0;
  const replyRate = campaign.sentCount > 0 ? campaign.repliedCount / campaign.sentCount : null;
  const nextAction = getNextAction(campaign);
  const risk = getRisk(campaign);
  return {
    ...campaign,
    progress,
    replyRate,
    nextAction: nextAction.label,
    nextActionTone: nextAction.tone,
    riskLabel: risk.label,
    riskTone: risk.tone,
    lastActivityLabel: formatDate(campaign.updatedAt),
  };
}

function getNextAction(campaign: CampaignSummary): { label: string; tone: "blue" | "green" | "amber" | "red" | "slate" } {
  if (campaign.readiness.includes("NO_EMAIL_STEP")) return { label: "Finish editor", tone: "amber" };
  if (campaign.readiness.includes("NO_SENDER_POOL")) return { label: "Add sender pool", tone: "amber" };
  if (campaign.readiness.includes("NO_LIVE_SENDER")) return { label: "Verify sender", tone: "amber" };
  if (campaign.readiness.includes("NO_ENROLLED_LEADS")) return { label: "Add leads", tone: "amber" };
  if (campaign.readiness.includes("SCHEDULE_MISSING")) return { label: "Set schedule", tone: "amber" };
  if (campaign.readiness.includes("TRACKING_DOMAIN_UNVERIFIED")) return { label: "Verify tracking", tone: "amber" };
  if (campaign.status === "ACTIVE") return { label: "Monitor sending", tone: "green" };
  if (campaign.sentCount > 0) return { label: "Open report", tone: "blue" };
  return { label: "Open campaign", tone: "blue" };
}

function getRisk(campaign: CampaignSummary): { label: string; tone: "blue" | "green" | "amber" | "red" | "slate" } {
  if (campaign.failedCount > 0 || campaign.bouncedCount > 0) return { label: "Delivery risk", tone: "red" };
  if (campaign.readiness.length > 0) return { label: "Needs attention", tone: "amber" };
  if (campaign.status === "ACTIVE") return { label: "Running", tone: "green" };
  if (campaign.status === "PAUSED") return { label: "Paused", tone: "slate" };
  if (campaign.status === "DRAFT") return { label: "Draft ready", tone: "blue" };
  return { label: "Stable", tone: "green" };
}

function rowMatchesFilter(row: CampaignCommandRow, filter: CampaignFilter) {
  if (filter === "all") return true;
  if (filter === "attention") return row.readiness.length > 0 || row.failedCount > 0 || row.bouncedCount > 0;
  if (filter === "completed") return ["COMPLETED", "FINISHED", "ARCHIVED"].includes(row.status);
  return row.status.toLowerCase() === filter;
}

function normalizeFilter(value: string | undefined): CampaignFilter {
  if (value === "attention" || value === "active" || value === "draft" || value === "paused" || value === "completed") return value;
  return "all";
}

function pick(params: Record<string, string | string[] | undefined>, key: string) {
  const v = params[key];
  const first = Array.isArray(v) ? v[0] : v;
  return first && first.trim() ? first.trim() : undefined;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No activity yet";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date);
}

const READINESS_LABELS: Record<CampaignReadinessCode, string> = {
  NO_EMAIL_STEP: "Add email step",
  NO_SENDER_POOL: "Add sender pool",
  NO_LIVE_SENDER: "No live sender",
  NO_ENROLLED_LEADS: "Add leads",
  SCHEDULE_MISSING: "Set schedule",
  TRACKING_DOMAIN_UNVERIFIED: "Verify tracking",
};

async function getContext() {
  try {
    return await requirePermission("crm.read");
  } catch (error) {
    if (error instanceof V2TenantError) return error;
    throw error;
  }
}
