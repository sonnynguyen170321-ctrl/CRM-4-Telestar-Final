import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Ban,
  CalendarCheck,
  CheckCircle2,
  Mail,
  Plus,
  Reply,
  ShieldCheck,
  UserRoundCog,
} from "lucide-react";

import { PageHeader } from "@/components/shared/PageHeader";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { Button } from "@/components/ui/button";
import { CampaignNav } from "@/components/v2/outreach/CampaignNav";
import {
  ChecklistRow,
  DataState,
  OutreachMetricTile,
  OutreachPanel,
  OutreachPill,
  BentoGrid,
  BentoCard,
  type OutreachTone,
} from "@/components/v2/outreach/OutreachCommandPrimitives";
import { WorkerHealthStrip } from "@/components/v2/outreach/WorkerHealthStrip";
import { queryWorkerHealth } from "@/lib/v2/jobs/queryWorkerHealth";
import { leadDrawerHref } from "@/lib/v2/crm/leadRoutes";
import { queryCampaigns, type CampaignSummary } from "@/lib/v2/outreach/campaigns/queryCampaigns";
import { isKillSwitchEngaged } from "@/lib/v2/outreach/limits/liveSendGuards";
import { queryOutreachReport } from "@/lib/v2/outreach/reporting/queryOutreachReport";
import { queryRecentOutreachActivity } from "@/lib/v2/outreach/reporting/queryRecentOutreachActivity";
import { getTenantErrorMessage, requirePermission, V2TenantError } from "@/lib/v2/tenant";

export default async function V2OutreachPage() {
  const context = await getOutreachContext();
  if (context instanceof V2TenantError) {
    const msg = getTenantErrorMessage(context);
    return (
      <WorkspaceFrame>
        <div className="max-w-xl rounded-md border border-border bg-card p-6">
          <div className="text-sm font-semibold text-foreground">{msg.title}</div>
          <p className="mt-2 text-sm text-muted-foreground">{msg.message}</p>
        </div>
      </WorkspaceFrame>
    );
  }

  const [report, recent, workerHealth, campaigns] = await Promise.all([
    queryOutreachReport(context.organizationId),
    queryRecentOutreachActivity(context.organizationId, 30),
    queryWorkerHealth(),
    queryCampaigns(context.organizationId),
  ]);
  const { totals, perSender } = report;
  const healthySenders = perSender.filter((sender) => sender.healthy).length;
  const liveSenders = perSender.filter((sender) => sender.healthy && sender.effectiveCap > 0).length;
  const jobWorkerHealthy = workerHealth.workers.find((worker) => worker.kind === "job_worker")?.healthy ?? false;
  const imapHealthy = workerHealth.workers.find((worker) => worker.kind === "imap_poller")?.healthy ?? false;
  const credentialKeyPresent = Boolean(process.env.V2_OUTREACH_CREDENTIAL_KEY);
  const killSwitchOn = isKillSwitchEngaged();
  const attentionCampaigns = campaigns
    .filter((campaign) => campaign.status === "DRAFT" || campaign.status === "PAUSED" || campaign.readiness.length > 0)
    .slice(0, 6);
  const primaryHref = perSender.length === 0
    ? "/v2/outreach/senders?add=1"
    : campaigns.length === 0
      ? "/v2/outreach/campaigns/new"
      : "/v2/outreach/campaigns";
  const primaryLabel = perSender.length === 0 ? "Add sender" : campaigns.length === 0 ? "New campaign" : "Open campaigns";

  return (
    <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0 bg-muted/30 min-h-screen">
      <PageHeader
        eyebrow="Outreach command center"
        title="Outreach"
        description="Operate campaigns, sender health, suppression, and real outcomes from one V2 workspace."
        actions={
          <Button asChild className="min-h-10 gap-2 rounded-xl shadow-sm">
            <Link href={primaryHref}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              {primaryLabel}
            </Link>
          </Button>
        }
      />

      <div className="space-y-6 p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto">
        <CampaignNav active="monitor" />
        <WorkerHealthStrip health={workerHealth} />

        <BentoGrid>
          {/* Main Hero Card - Spans 2 columns */}
          <BentoCard colSpan={2} gradient className="border-primary/50 shadow-sm">
            <div className="flex h-full flex-col justify-between">
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-1">Live-send Readiness</h3>
                <p className="text-sm text-muted-foreground max-w-md">No email leaves unless the runtime path passes all security and suppression checks.</p>
              </div>

              <div className="mt-6 flex flex-wrap gap-2.5">
                <OutreachPill tone={killSwitchOn ? "red" : "green"} icon={killSwitchOn ? AlertTriangle : ShieldCheck} className="py-1">
                  {killSwitchOn ? "Kill switch ON" : "Kill switch OFF"}
                </OutreachPill>
                <OutreachPill tone={credentialKeyPresent ? "green" : "amber"} icon={credentialKeyPresent ? CheckCircle2 : AlertTriangle} className="py-1">
                  Credentials {credentialKeyPresent ? "Verified" : "Missing"}
                </OutreachPill>
                <OutreachPill tone={jobWorkerHealthy ? "green" : "amber"} icon={jobWorkerHealthy ? CheckCircle2 : AlertTriangle} className="py-1">
                  Worker {jobWorkerHealthy ? "Live" : "Down"}
                </OutreachPill>
                <OutreachPill tone={healthySenders > 0 ? "green" : "amber"} icon={healthySenders > 0 ? CheckCircle2 : UserRoundCog} className="py-1">
                  {healthySenders}/{perSender.length} Senders
                </OutreachPill>
              </div>
            </div>
          </BentoCard>

          {/* Metric Tiles - 1 Col each */}
          <BentoCard className="flex flex-col justify-center items-center text-center p-6 bg-accent/30">
            <Mail className="h-6 w-6 text-primary mb-2" />
            <div className="text-[32px] font-bold text-foreground tracking-tight leading-none mb-1">{totals.sent}</div>
            <div className="text-sm font-medium text-muted-foreground">Total Sent</div>
            <div className="text-xs text-muted-foreground mt-1">{totals.delivered} delivered</div>
          </BentoCard>

          <BentoCard className="flex flex-col justify-center items-center text-center p-6 bg-emerald-50/30">
            <Reply className="h-6 w-6 text-emerald-500 mb-2" />
            <div className="text-[32px] font-bold text-foreground tracking-tight leading-none mb-1">{totals.replied}</div>
            <div className="text-sm font-medium text-muted-foreground">Replies</div>
            <div className="text-xs text-muted-foreground mt-1">{pct(totals.replyRate)} reply rate</div>
          </BentoCard>

          <BentoCard className="flex flex-col justify-center items-center text-center p-6 bg-amber-50/30">
            <Ban className="h-6 w-6 text-amber-500 mb-2" />
            <div className="text-[32px] font-bold text-foreground tracking-tight leading-none mb-1">{totals.suppressionBlocks}</div>
            <div className="text-sm font-medium text-muted-foreground">Suppressed</div>
            <div className="text-xs text-muted-foreground mt-1">Blocked before send</div>
          </BentoCard>

          <BentoCard className="flex flex-col justify-center items-center text-center p-6 bg-emerald-50/30">
            <CalendarCheck className="h-6 w-6 text-emerald-500 mb-2" />
            <div className="text-[32px] font-bold text-foreground tracking-tight leading-none mb-1">{totals.meetingsBooked}</div>
            <div className="text-sm font-medium text-muted-foreground">Meetings</div>
            <div className="text-xs text-muted-foreground mt-1">Booked from replies</div>
          </BentoCard>

          {/* Recent Activity - Spans 2 Cols, 2 Rows */}
          <BentoCard
            colSpan={2}
            rowSpan={2}
            title="Recent Activity"
            description="Real V2OutreachActivity events, newest first."
            className="p-0"
          >
            {recent.length === 0 ? (
              <DataState
                icon={Activity}
                title="No outreach activity yet"
                description="Sends, replies, bounces, unsubscribe events, and meetings will appear here once campaigns or manual sends run."
                action={
                  <Button size="sm" asChild className="rounded-lg">
                    <Link href="/v2/outreach/campaigns/new">Create campaign</Link>
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y divide-border">
                {recent.map((event) => (
                  <li key={event.id} className="grid gap-3 px-5 py-3.5 sm:grid-cols-[minmax(0,1fr)_160px_72px] sm:items-center hover:bg-muted/40 transition-colors">
                    <div className="flex min-w-0 items-center gap-3">
                      <EventDot eventKind={event.eventKind} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-foreground">
                          {formatEventKind(event.eventKind)}
                          <span className="ml-2 text-xs font-medium text-muted-foreground">{event.channel}</span>
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {[event.companyName ?? "Unknown company", event.contactName].filter(Boolean).join(" / ")}
                        </div>
                      </div>
                    </div>
                    <time className="text-xs text-muted-foreground" dateTime={event.occurredAt}>
                      {formatDateTime(event.occurredAt)}
                    </time>
                    <Link
                      href={leadDrawerHref(event.leadAssignmentId)}
                      className="inline-flex min-h-8 items-center justify-center rounded-lg bg-card border border-border px-3 text-[11px] font-semibold text-foreground shadow-sm transition-colors hover:bg-muted"
                    >
                      View
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </BentoCard>

          {/* Checklist - 2 Cols */}
          <BentoCard colSpan={2} title="System Gate Checks" description="Runtime suppression gates for live sending.">
            <ul className="space-y-2.5">
              <ChecklistRow ok={!killSwitchOn} label="Kill switch off" detail={killSwitchOn ? "Sending is intentionally blocked." : "Runtime is allowed to evaluate sends."} />
              <ChecklistRow ok={credentialKeyPresent} label="Credential key present" detail="Required to decrypt SMTP/app-password credentials." />
              <ChecklistRow ok={healthySenders > 0} label="Verified healthy sender" detail={`${healthySenders} healthy sender${healthySenders === 1 ? "" : "s"} available.`} />
              <ChecklistRow ok={jobWorkerHealthy} label="Job worker heartbeat" detail="Campaign delivery runs through the worker path." />
              <ChecklistRow ok label="Final suppression gate" detail="Suppression is checked synchronously before every provider call." />
            </ul>
          </BentoCard>

          {/* Attention Campaigns - 2 Cols */}
          <BentoCard
            colSpan={2}
            title="Campaigns needing attention"
            description="Draft, paused, or readiness-blocked campaigns."
            className="p-0"
          >
            {attentionCampaigns.length === 0 ? (
              <DataState icon={CheckCircle2} title="No campaign blockers" description="Draft and active campaigns have no visible readiness issues right now." />
            ) : (
              <ul className="divide-y divide-hairline bg-surface">
                {attentionCampaigns.map((campaign) => (
                  <li key={campaign.id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={`/v2/outreach/campaigns/${campaign.id}`} className="truncate text-sm font-semibold text-foreground transition-colors hover:text-primary">
                          {campaign.name}
                        </Link>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {campaign.enrolledCount} enrolled / {campaign.sentCount} sent / {campaign.senderCount} senders
                        </div>
                      </div>
                      <OutreachPill tone={campaignTone(campaign)} className="shadow-sm">{formatCampaignStatus(campaign.status)}</OutreachPill>
                    </div>
                    {campaign.readiness.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {campaign.readiness.slice(0, 2).map((code) => (
                          <OutreachPill key={code} tone="amber">{readinessLabel(code)}</OutreachPill>
                        ))}
                        {campaign.readiness.length > 2 ? <OutreachPill tone="slate">+{campaign.readiness.length - 2}</OutreachPill> : null}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </BentoCard>
        </BentoGrid>
      </div>
    </WorkspaceFrame>
  );
}

function EventDot({ eventKind }: { eventKind: string }) {
  const tone = eventKind.includes("replied")
    ? "bg-emerald-500"
    : eventKind.includes("bounced")
      ? "bg-red-500"
      : eventKind.includes("meeting")
        ? "bg-primary"
        : eventKind.includes("unsubscribed")
          ? "bg-amber-500"
          : "bg-muted-foreground";
  return <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${tone}`} aria-hidden="true" />;
}

function formatEventKind(value: string) {
  return value
    .replace(/^outreach\./, "")
    .split(/[._]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatCampaignStatus(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function campaignTone(campaign: CampaignSummary): OutreachTone {
  if (campaign.readiness.length > 0) return "amber";
  if (campaign.status === "ACTIVE") return "green";
  if (campaign.status === "PAUSED") return "amber";
  return "blue";
}

function readinessLabel(value: string) {
  return value
    .replace(/^NO_/, "Missing ")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^./, (char) => char.toUpperCase());
}

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

async function getOutreachContext() {
  try {
    return await requirePermission("crm.read");
  } catch (error) {
    if (error instanceof V2TenantError) return error;
    throw error;
  }
}
