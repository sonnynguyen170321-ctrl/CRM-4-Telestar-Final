import Link from "next/link";
import type { ComponentType } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CirclePause,
  Mail,
  Plus,
  RadioTower,
  Send,
  Settings,
  Trash2,
  Users,
} from "lucide-react";

import { MetricCard } from "@/components/shared/MetricCard";
import { PanelCard } from "@/components/shared/PanelCard";
import { WorkspaceMetricGrid } from "@/components/shared/WorkspaceMetricGrid";
import { CampaignLeadsManager } from "@/components/v2/outreach/CampaignLeadsManager";
import { formatCampaignLabel } from "@/components/v2/outreach/CampaignStatusBadge";
import { CampaignVariantEditor } from "@/components/v2/outreach/CampaignVariantEditor";
import { CampaignEmailRowMenu } from "@/components/v2/outreach/CampaignEmailRowMenu";
import { WorkerHealthPanel } from "@/components/v2/outreach/WorkerHealthPanel";
import { OutreachPill } from "@/components/v2/outreach/OutreachCommandPrimitives";
import type { WorkerHealth } from "@/lib/v2/jobs/queryWorkerHealth";
import {
  queryCampaignActivityRows,
  queryCampaignAvailableSenders,
  queryCampaignEmailRows,
} from "@/lib/v2/outreach/campaigns/queryCampaignWorkspace";
import type {
  CampaignDetail,
  CampaignReadinessCode,
} from "@/lib/v2/outreach/campaigns/queryCampaigns";
import {
  queryCampaignEnrollments,
  type EnrollmentStatus,
} from "@/lib/v2/outreach/campaigns/queryCampaignEnrollments";
import {
  parseCampaignSource,
  type CampaignWizardLead,
} from "@/lib/v2/outreach/campaigns/queryCampaignWizardLeads";
import { nextCampaignWindow, resolveCampaignTimezone } from "@/lib/v2/outreach/campaigns/schedule";
import { computeCampaignReadiness } from "@/lib/v2/outreach/campaigns/readinessScore";
import type { V2CampaignScheduleV1 } from "@/lib/v2/outreach/campaigns/types";

import {
  addCampaignEmailStepAction,
  addCampaignSenderToPoolAction,
  addCampaignVariantAction,
  launchCampaignAction,
  moveCampaignStepAction,
  pauseCampaignAction,
  removeCampaignStepAction,
  resumeCampaignAction,
  saveCampaignScheduleAction,
  saveCampaignSenderPoolAction,
  saveCampaignSettingsAction,
  updateCampaignStepDelayAction,
} from "@/app/v2/outreach/campaigns/[campaignId]/actions";

export type CampaignTab = "editor" | "contacts" | "emails" | "activity" | "report" | "settings";

const TABS: Array<{ key: CampaignTab; label: string; icon: ComponentType<{ className?: string }> }> = [
  { key: "editor", label: "Editor", icon: Mail },
  { key: "contacts", label: "Contacts", icon: Users },
  { key: "emails", label: "Emails", icon: Send },
  { key: "activity", label: "Activity", icon: Activity },
  { key: "report", label: "Report", icon: BarChart3 },
  { key: "settings", label: "Settings", icon: Settings },
];

const WEEKDAYS: Array<{ value: 1 | 2 | 3 | 4 | 5 | 6 | 7; label: string }> = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];
const TIMEZONE_MODES = ["LEAD", "CAMPAIGN", "ORGANIZATION"];
const fieldCls =
  "h-11 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/20";
const compactButtonCls =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-semibold text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary/20";
const primaryButtonCls =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-white outline-none transition-colors hover:bg-primary focus-visible:ring-2 focus-visible:ring-primary/20";

export function parseCampaignTab(value: string | undefined): CampaignTab {
  return TABS.some((tab) => tab.key === value) ? (value as CampaignTab) : "editor";
}

export async function CampaignTabbedWorkspace({
  organizationId,
  campaign,
  workerHealth,
  wizardLeads,
  isAdmin,
  tab,
  status,
  search,
  page,
  leadSource,
}: {
  organizationId: string;
  campaign: CampaignDetail;
  workerHealth: WorkerHealth;
  wizardLeads: CampaignWizardLead[];
  isAdmin: boolean;
  tab: CampaignTab;
  status: string;
  search: string;
  page: number;
  leadSource: ReturnType<typeof parseCampaignSource>;
}) {
  const [emailRows, activityRows, availableSenders] = await Promise.all([
    tab === "emails" || tab === "report" ? queryCampaignEmailRows(organizationId, campaign.id) : Promise.resolve([]),
    tab === "activity" ? queryCampaignActivityRows(organizationId, campaign.id) : Promise.resolve([]),
    tab === "settings" ? queryCampaignAvailableSenders(organizationId, campaign.id) : Promise.resolve([]),
  ]);
  const enrollmentResult =
    tab === "contacts"
      ? await queryCampaignEnrollments(organizationId, campaign.id, { status, search, page })
      : null;
  const sourceLabel = describeLeadSource(leadSource, wizardLeads.length);
  const activeEnrollments = enrollmentStatusCount(campaign, "ACTIVE");
  const pausedEnrollments = enrollmentStatusCount(campaign, "PAUSED");
  const completedEnrollments = enrollmentStatusCount(campaign, "COMPLETED");
  const deliveredCount = Math.max(0, campaign.sentCount - campaign.bouncedCount - campaign.failedCount);

  return (
    <div className="space-y-5">
      <div className="rounded-md border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <OutreachPill tone={campaign.status === "ACTIVE" ? "green" : campaign.status === "PAUSED" ? "amber" : "blue"}>{formatCampaignLabel(campaign.status)}</OutreachPill>
              <OutreachPill tone={campaign.readiness.length === 0 ? "green" : "amber"}>{campaign.readiness.length === 0 ? "Ready to review" : `${campaign.readiness.length} blocker${campaign.readiness.length === 1 ? "" : "s"}`}</OutreachPill>
              <OutreachPill tone={campaign.liveSenderCount > 0 ? "green" : "amber"}>{campaign.liveSenderCount}/{campaign.senderCount} live senders</OutreachPill>
              <OutreachPill tone={campaign.trackingEnabled && campaign.verifiedTrackingSenderCount === 0 ? "amber" : "slate"}>{campaign.trackingEnabled ? "Tracking requested" : "Tracking off"}</OutreachPill>
            </div>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">Author, enroll, monitor, and tune this campaign without leaving the V2 outreach runtime. Live send still depends on the worker-gated send path and final suppression check.</p>
          </div>
          <Link href={`/v2/outreach/campaigns/${campaign.id}?tab=settings`} className="inline-flex min-h-10 items-center rounded-md border border-border px-3 text-sm font-semibold text-foreground hover:bg-muted">Live setup</Link>
        </div>
      </div>
      <WorkspaceMetricGrid>
        <MetricCard label="Steps" value={campaign.stepCount} icon={Mail} />
        <MetricCard label="Enrolled" value={campaign.enrolledCount} description={`${pausedEnrollments} paused / ${completedEnrollments} completed`} icon={Users} />
        <MetricCard label="Active leads" value={activeEnrollments} description="Enrollment status ACTIVE" icon={CalendarClock} />
        <MetricCard label="Sent" value={campaign.sentCount} description={`${deliveredCount} delivered`} icon={Send} />
        <MetricCard label="Replies" value={campaign.repliedCount} icon={Activity} />
        <MetricCard label="Bounced" value={campaign.bouncedCount} icon={AlertTriangle} />
      </WorkspaceMetricGrid>

      <div className="flex gap-1 overflow-x-auto rounded-md border border-border bg-card p-1" role="tablist" aria-label="Campaign workspace tabs">
        {TABS.map((item) => {
          const Icon = item.icon;
          const active = item.key === tab;
          return (
            <Link
              key={item.key}
              href={`/v2/outreach/campaigns/${campaign.id}?tab=${item.key}`}
              role="tab"
              aria-selected={active}
              className={
                "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/20 " +
                (active
                  ? "bg-primary text-white shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground")
              }
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </div>

      {tab === "editor" ? (
        <EditorTab campaign={campaign} wizardLeads={wizardLeads} isAdmin={isAdmin} workerHealth={workerHealth} />
      ) : null}
      {tab === "contacts" ? (
        <ContactsTab
          campaign={campaign}
          wizardLeads={wizardLeads}
          isAdmin={isAdmin}
          sourceLabel={sourceLabel}
          status={status}
          search={search}
          page={page}
          enrollmentResult={enrollmentResult}
        />
      ) : null}
      {tab === "emails" ? <EmailsTab rows={emailRows} campaignId={campaign.id} /> : null}
      {tab === "activity" ? <ActivityTab rows={activityRows} /> : null}
      {tab === "report" ? <ReportTab campaign={campaign} emailRows={emailRows} /> : null}
      {tab === "settings" ? (
        <SettingsTab campaign={campaign} availableSenders={availableSenders} isAdmin={isAdmin} workerHealth={workerHealth} />
      ) : null}
    </div>
  );
}

function EditorTab({
  campaign,
  wizardLeads,
  isAdmin,
  workerHealth,
}: {
  campaign: CampaignDetail;
  wizardLeads: CampaignWizardLead[];
  isAdmin: boolean;
  workerHealth: WorkerHealth;
}) {
  const previewContacts = wizardLeads
    .filter((lead) => lead.email)
    .slice(0, 50)
    .map((lead) => ({
      id: lead.id,
      label: lead.contactName ? `${lead.contactName} @ ${lead.companyName}` : lead.companyName,
      email: lead.email,
    }));
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]">
      <div className="space-y-4">
        <PanelCard
          title="Step canvas"
          description="Author email steps and variants. Launch stays blocked until required variables and body content are ready."
        >
          {isAdmin && campaign.status === "DRAFT" ? (
            <form action={addCampaignEmailStepAction} className="mb-4">
              <input type="hidden" name="campaignId" value={campaign.id} />
              <button type="submit" className={compactButtonCls}>
                <Plus className="h-4 w-4" aria-hidden="true" /> Add email step
              </button>
            </form>
          ) : null}

          {campaign.steps.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
              No email steps yet. Add a step, then write the first variant.
            </div>
          ) : (
            <div className="space-y-4">
              {campaign.steps.map((step) => (
                <section key={step.id} className="rounded-md border border-border bg-card">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                        <span>Step {step.ordinal}: Automatic email</span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground">
                          {step.delayMinutes === 0 ? "Send immediately" : `Send after ${formatDelay(step.delayMinutes)}`}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {step.variants.length} variant{step.variants.length === 1 ? "" : "s"}
                      </div>
                    </div>
                    {isAdmin && campaign.status === "DRAFT" ? (
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Delay edit (days + minutes-remainder preserved via minutes math) */}
                        <form action={updateCampaignStepDelayAction} className="flex items-center gap-1.5">
                          <input type="hidden" name="campaignId" value={campaign.id} />
                          <input type="hidden" name="stepId" value={step.id} />
                          <label className="flex items-center gap-1 text-xs text-muted-foreground">
                            Wait
                            <input
                              name="delayMinutes"
                              type="number"
                              min={0}
                              max={60 * 24 * 90}
                              step={60}
                              defaultValue={step.delayMinutes}
                              className="h-8 w-24 rounded-md border border-border bg-card px-2 text-xs"
                              aria-label={`Delay minutes for step ${step.ordinal}`}
                            />
                            min
                          </label>
                          <button type="submit" className="rounded-md border border-border px-2 py-1.5 text-xs font-semibold text-foreground hover:bg-muted">Save</button>
                        </form>
                        {/* Reorder */}
                        <form action={moveCampaignStepAction} className="flex items-center">
                          <input type="hidden" name="campaignId" value={campaign.id} />
                          <input type="hidden" name="stepId" value={step.id} />
                          <input type="hidden" name="direction" value="up" />
                          <button type="submit" title="Move step up" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
                            <ChevronUp className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </form>
                        <form action={moveCampaignStepAction} className="flex items-center">
                          <input type="hidden" name="campaignId" value={campaign.id} />
                          <input type="hidden" name="stepId" value={step.id} />
                          <input type="hidden" name="direction" value="down" />
                          <button type="submit" title="Move step down" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
                            <ChevronDown className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </form>
                        <form action={addCampaignVariantAction}>
                          <input type="hidden" name="campaignId" value={campaign.id} />
                          <input type="hidden" name="stepId" value={step.id} />
                          <button type="submit" className={compactButtonCls}>
                            <Plus className="h-4 w-4" aria-hidden="true" /> Add test
                          </button>
                        </form>
                        {/* Delete step */}
                        <form action={removeCampaignStepAction}>
                          <input type="hidden" name="campaignId" value={campaign.id} />
                          <input type="hidden" name="stepId" value={step.id} />
                          <button type="submit" title="Delete step" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-red-500 hover:bg-red-50">
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </form>
                      </div>
                    ) : null}
                  </div>
                  <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.72fr)]">
                    <div className="space-y-3">
                      <div className="flex gap-2 overflow-x-auto">
                        {step.variants.map((variant) => (
                          <span
                            key={variant.id}
                            className="shrink-0 rounded-md bg-foreground px-3 py-1.5 text-xs font-semibold text-white"
                          >
                            Test {variant.key}
                          </span>
                        ))}
                      </div>
                      {step.variants.map((variant) => (
                        <CampaignVariantEditor
                          key={variant.id}
                          campaignId={campaign.id}
                          stepId={step.id}
                          variant={variant}
                          canRemove={step.variants.length > 1 && campaign.status === "DRAFT"}
                          previewContacts={previewContacts}
                        />
                      ))}
                    </div>
                    <PreviewHelperPanel campaign={campaign} stepOrdinal={step.ordinal} />
                  </div>
                </section>
              ))}
            </div>
          )}
        </PanelCard>
      </div>
      <div className="space-y-4">
        <ReadinessPanel campaign={campaign} />
        <WorkerHealthPanel health={workerHealth} />
      </div>
    </div>
  );
}

function ContactsTab({
  campaign,
  wizardLeads,
  isAdmin,
  sourceLabel,
  status,
  search,
  page,
  enrollmentResult,
}: {
  campaign: CampaignDetail;
  wizardLeads: CampaignWizardLead[];
  isAdmin: boolean;
  sourceLabel: string;
  status: string;
  search: string;
  page: number;
  enrollmentResult: Awaited<ReturnType<typeof queryCampaignEnrollments>> | null;
}) {
  return (
    <div className="space-y-5">
      <LaunchControls campaign={campaign} leads={wizardLeads} isAdmin={isAdmin} sourceLabel={sourceLabel} />
      <CampaignLeadsManager
        campaignId={campaign.id}
        result={enrollmentResult ?? emptyEnrollmentResult(page)}
        status={normalizeEnrollmentStatus(status)}
        search={search}
        isAdmin={isAdmin}
        inlineTab="contacts"
      />
    </div>
  );
}
function EmailsTab({ rows, campaignId }: { rows: Awaited<ReturnType<typeof queryCampaignEmailRows>>; campaignId: string }) {
  return (
    <PanelCard title="Emails" description="Rows are read from V2OutreachMessage. Empty means no message has been scheduled or sent yet.">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-border text-xs uppercase text-muted-foreground">
            <tr>
              <th className="py-2 pr-4">Recipient</th>
              <th className="py-2 pr-4">Email</th>
              <th className="py-2 pr-4">Step</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Sender</th>
              <th className="py-2 pr-4">Date</th>
              <th className="py-2 pr-4">Error</th>
              <th className="py-2 pr-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.id} className="align-top group hover:bg-muted/40 transition-colors">
                <td className="py-3 pr-4">
                  <div className="font-medium text-foreground">{row.contactName ?? "Unknown contact"}</div>
                  <div className="text-xs text-muted-foreground">{row.companyName ?? "Unknown company"}</div>
                </td>
                <td className="max-w-[360px] py-3 pr-4">
                  <div className="font-medium text-foreground">{row.subject ?? "(no subject)"}</div>
                  <div className="truncate text-xs text-muted-foreground">{row.bodyPreview ?? row.toAddress}</div>
                </td>
                <td className="py-3 pr-4 text-muted-foreground">
                  {row.stepOrdinal ? `Step ${row.stepOrdinal}` : "-"} {row.variantKey ? ` / ${row.variantKey}` : ""}
                </td>
                <td className="py-3 pr-4">
                  <StatusPill label={formatCampaignLabel(row.status)} tone={statusTone(row.status)} />
                </td>
                <td className="py-3 pr-4 text-muted-foreground">{row.senderDisplayName ?? row.senderFromAddress ?? "-"}</td>
                <td className="py-3 pr-4 text-muted-foreground">{formatDate(row.sentAt ?? row.failedAt ?? row.scheduledAt ?? row.createdAt)}</td>
                <td className="max-w-[260px] py-3 pr-4 text-xs text-muted-foreground">{row.errorMessage ?? row.errorCode ?? "-"}</td>
                <td className="py-3 pr-4 text-right">
                  <CampaignEmailRowMenu emailId={row.id} campaignId={campaignId} />
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  No email rows yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </PanelCard>
  );
}

function ActivityTab({ rows }: { rows: Awaited<ReturnType<typeof queryCampaignActivityRows>> }) {
  return (
    <PanelCard title="Activity" description="Outreach activity and audit events are shown in one tenant-scoped timeline.">
      <div className="divide-y divide-border">
        {rows.map((row) => (
          <div key={`${row.kind}:${row.id}`} className="grid gap-2 py-3 sm:grid-cols-[150px_minmax(0,1fr)_160px]">
            <div className="text-xs text-muted-foreground">{formatDate(row.occurredAt)}</div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">{formatCampaignLabel(row.eventKind)}</div>
              <div className="truncate text-xs text-muted-foreground">
                {[row.contactName, row.companyName, row.senderFromAddress].filter(Boolean).join(" / ") || row.reason || "Campaign event"}
              </div>
            </div>
            <div className="text-xs font-medium text-muted-foreground">{row.kind === "audit" ? "Audit" : row.channel ?? "Activity"}</div>
          </div>
        ))}
        {rows.length === 0 ? <div className="py-8 text-center text-sm text-muted-foreground">No activity yet.</div> : null}
      </div>
    </PanelCard>
  );
}

function ReportTab({
  campaign,
  emailRows,
}: {
  campaign: CampaignDetail;
  emailRows: Awaited<ReturnType<typeof queryCampaignEmailRows>>;
}) {
  const sent = emailRows.filter((row) => row.status === "SENT").length || campaign.sentCount;
  const failed = emailRows.filter((row) => row.status === "FAILED").length || campaign.failedCount;
  return (
    <div className="space-y-5">
      <WorkspaceMetricGrid>
        <MetricCard label="Delivered" value={Math.max(0, campaign.sentCount - campaign.bouncedCount - campaign.failedCount)} icon={CheckCircle2} />
        <MetricCard label="Sent" value={sent} icon={Send} />
        <MetricCard label="Failed" value={failed} icon={AlertTriangle} />
        <MetricCard label="Replies" value={campaign.repliedCount} icon={Activity} />
      </WorkspaceMetricGrid>
      <PanelCard title="Tracking report" description="Open and click metrics appear only when verified CTD-backed tracking exists.">
        {campaign.trackingEnabled && campaign.verifiedTrackingSenderCount > 0 ? (
          <p className="text-sm text-muted-foreground">
            Tracking is enabled for {campaign.verifiedTrackingSenderCount} verified sender(s). Open and click rows will populate from real
            events when available.
          </p>
        ) : (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            CTD-backed tracking is not ready for this campaign, so open and click rates are hidden instead of zero-filled.
          </div>
        )}
      </PanelCard>
    </div>
  );
}

function SettingsTab({
  campaign,
  availableSenders,
  isAdmin,
  workerHealth,
}: {
  campaign: CampaignDetail;
  availableSenders: Awaited<ReturnType<typeof queryCampaignAvailableSenders>>;
  isAdmin: boolean;
  workerHealth: WorkerHealth;
}) {
  const schedule = parseSchedule(campaign.scheduleJson);
  const editable = isAdmin && (campaign.status === "DRAFT" || campaign.status === "PAUSED");
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.72fr)]">
      <div className="space-y-5">
        <PanelCard title="Sequence settings" description="Backed by existing V2Sequence fields.">
          <form action={saveCampaignSettingsAction} className="space-y-3">
            <input type="hidden" name="campaignId" value={campaign.id} />
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Sequence name
              <input name="name" defaultValue={campaign.name} disabled={!editable} className={fieldCls} />
            </label>
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Description
              <textarea
                name="description"
                defaultValue={campaign.description ?? ""}
                disabled={!editable}
                rows={4}
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
              />
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <Toggle name="stopOnReply" label="Stop on reply" defaultChecked={campaign.stopOnReply ?? true} disabled={!editable} />
              <Toggle name="stopOnBounce" label="Stop on bounce" defaultChecked={campaign.stopOnBounce ?? true} disabled={!editable} />
              <Toggle name="stopOnMeeting" label="Stop on meeting" defaultChecked={campaign.stopOnMeeting ?? false} disabled={!editable} />
              <Toggle name="trackingEnabled" label="Tracking enabled" defaultChecked={campaign.trackingEnabled} disabled={!editable} />
            </div>
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Max touches
              <input name="maxTouches" type="number" min={1} max={100} defaultValue={campaign.maxTouches ?? ""} disabled={!editable} className={fieldCls} />
            </label>
            {editable ? <button type="submit" className={primaryButtonCls}>Save settings</button> : null}
          </form>
        </PanelCard>

        <ScheduleSettings campaign={campaign} schedule={schedule} editable={editable} />
        <SenderPoolSettings campaign={campaign} availableSenders={availableSenders} editable={editable} />
      </div>
      <div className="space-y-5">
        <LiveSendGuardPanel campaign={campaign} workerHealth={workerHealth} />
        <WorkerHealthPanel health={workerHealth} />
      </div>
    </div>
  );
}

function ScheduleSettings({
  campaign,
  schedule,
  editable,
}: {
  campaign: CampaignDetail;
  schedule: V2CampaignScheduleV1 | null;
  editable: boolean;
}) {
  return (
    <PanelCard title="Scheduling">
      <form action={saveCampaignScheduleAction} className="space-y-3">
        <input type="hidden" name="campaignId" value={campaign.id} />
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Timezone mode
          <select name="timezoneMode" defaultValue={campaign.timezoneMode} disabled={!editable} className={fieldCls}>
            {TIMEZONE_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {formatCampaignLabel(mode)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Fallback timezone
          <input name="fallbackTimezone" defaultValue={campaign.fallbackTimezone ?? "Asia/Ho_Chi_Minh"} disabled={!editable} className={fieldCls} />
        </label>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Start
            <input name="startLocalTime" type="time" defaultValue={schedule?.startLocalTime ?? "08:00"} disabled={!editable} className={fieldCls} />
          </label>
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            End
            <input name="endLocalTime" type="time" defaultValue={schedule?.endLocalTime ?? "17:00"} disabled={!editable} className={fieldCls} />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((day) => (
            <label key={day.value} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground">
              <input name="weekdays" type="checkbox" value={day.value} defaultChecked={(schedule?.weekdays ?? [1, 2, 3, 4, 5]).includes(day.value)} disabled={!editable} />
              {day.label}
            </label>
          ))}
        </div>
        {editable ? <button type="submit" className={primaryButtonCls}>Save schedule</button> : null}
      </form>
    </PanelCard>
  );
}

function SenderPoolSettings({
  campaign,
  availableSenders,
  editable,
}: {
  campaign: CampaignDetail;
  availableSenders: Awaited<ReturnType<typeof queryCampaignAvailableSenders>>;
  editable: boolean;
}) {
  return (
    <PanelCard title="Sender pool" description="Sender identity is shown by display name/address, never UUID first.">
      <div className="mb-3 flex flex-wrap gap-2">
        <Link href="/v2/outreach/senders?add=1" className={compactButtonCls}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Sender setup
        </Link>
      </div>
      <div className="space-y-2">
        {campaign.senders.map((sender) => (
          <form key={sender.id} action={saveCampaignSenderPoolAction} className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[minmax(0,1fr)_92px_80px]">
            <input type="hidden" name="campaignId" value={campaign.id} />
            <input type="hidden" name="poolId" value={sender.poolId} />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-foreground">{sender.displayName ?? sender.fromAddress}</div>
              <div className="truncate text-xs text-muted-foreground">{sender.fromAddress}</div>
            </div>
            <input name="weight" type="number" min={1} max={10000} defaultValue={sender.poolWeight} disabled={!editable} className="h-9 rounded-md border border-border bg-card px-2 text-sm" />
            <label className="inline-flex items-center justify-center gap-1 text-xs font-medium text-muted-foreground">
              <input name="enabled" type="checkbox" defaultChecked={sender.poolEnabled} disabled={!editable} />
              On
            </label>
            {editable ? (
              <button type="submit" className="sm:col-span-3 justify-self-start rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted">
                Save sender
              </button>
            ) : null}
          </form>
        ))}
      </div>
      {editable ? (
        <form action={addCampaignSenderToPoolAction} className="mt-4 flex flex-wrap items-end gap-2">
          <input type="hidden" name="campaignId" value={campaign.id} />
          <label className="min-w-64 flex-1 text-xs font-medium text-muted-foreground">
            Add sender
            <select name="senderAccountId" className={fieldCls} defaultValue="">
              <option value="" disabled>
                Select sender
              </option>
              {availableSenders
                .filter((sender) => !sender.alreadyInPool)
                .map((sender) => (
                  <option key={sender.id} value={sender.id}>
                    {sender.displayName} / {sender.fromAddress}
                  </option>
                ))}
            </select>
          </label>
          <button type="submit" className={compactButtonCls}>Add to pool</button>
        </form>
      ) : null}
    </PanelCard>
  );
}

function LaunchControls({
  campaign,
  leads,
  isAdmin,
  sourceLabel,
}: {
  campaign: CampaignDetail;
  leads: CampaignWizardLead[];
  isAdmin: boolean;
  sourceLabel: string;
}) {
  if (!isAdmin) {
    return (
      <PanelCard title="Launch controls">
        <p className="text-sm text-muted-foreground">Only outreach admins can launch, pause, or resume a campaign.</p>
      </PanelCard>
    );
  }

  if (campaign.status === "ACTIVE") {
    return (
      <PanelCard title="Operations" description="Campaign is live and sending on schedule.">
        <form action={pauseCampaignAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="campaignId" value={campaign.id} />
          <label className="flex-1 text-xs font-medium text-muted-foreground">
            Pause reason
            <input name="reason" className={fieldCls} placeholder="Why pause?" />
          </label>
          <button type="submit" className="inline-flex min-h-10 items-center gap-2 rounded-md bg-amber-600 px-3 text-sm font-semibold text-white hover:bg-amber-700">
            <CirclePause className="h-4 w-4" aria-hidden="true" /> Pause campaign
          </button>
        </form>
      </PanelCard>
    );
  }

  if (campaign.status === "PAUSED") {
    return (
      <PanelCard title="Operations" description="Resume recomputes each enrollment's next valid send window.">
        <form action={resumeCampaignAction}>
          <input type="hidden" name="campaignId" value={campaign.id} />
          <button type="submit" className={primaryButtonCls}>Resume campaign</button>
        </form>
      </PanelCard>
    );
  }

  if (campaign.status !== "DRAFT") {
    return (
      <PanelCard title="Launch controls">
        <p className="text-sm text-muted-foreground">This campaign is {formatCampaignLabel(campaign.status).toLowerCase()}; no launch action is available.</p>
      </PanelCard>
    );
  }

  const selectable = leads.filter((lead) => lead.selectable);
  const blocked = leads.filter((lead) => !lead.selectable);
  return (
    <PanelCard title="Review and launch" description="QUALIFIED leads are preselected. NEEDS_REVIEW or not-scored leads require an override reason.">
      <div className="mb-3 inline-flex rounded-md border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground">
        Lead source: {sourceLabel}
      </div>
      {selectable.length === 0 ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">No eligible leads with a valid, non-suppressed email.</p>
      ) : (
        <form action={launchCampaignAction} className="space-y-3">
          <input type="hidden" name="campaignId" value={campaign.id} />
          <div className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
            {selectable.map((lead) => {
              const isQualified = lead.qualification === "QUALIFIED";
              return (
                <div key={lead.id} className="flex flex-wrap items-center gap-3 p-3">
                  <input type="checkbox" name="leadId" value={lead.id} defaultChecked={isQualified} className="h-4 w-4" aria-label={`Select ${lead.companyName}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">{lead.companyName}</div>
                    <div className="truncate text-xs text-muted-foreground">{[formatCampaignLabel(lead.qualification), lead.contactName, lead.email].filter(Boolean).join(" / ")}</div>
                  </div>
                  {!isQualified ? <input name={`override:${lead.id}`} className="h-9 w-48 rounded-md border border-amber-300 bg-amber-50 px-2 text-xs text-amber-900" placeholder="Override reason required" /> : null}
                </div>
              );
            })}
          </div>
          {blocked.length > 0 ? (
            <div className="rounded-md border border-dashed border-border">
              <div className="border-b border-border bg-muted/40 px-3 py-1.5 text-xs font-semibold text-muted-foreground">{blocked.length} blocker(s), visible but not sendable</div>
              <ul className="max-h-40 divide-y divide-border overflow-y-auto">
                {blocked.map((lead) => (
                  <li key={lead.id} className="flex items-center gap-3 px-3 py-2 opacity-75">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-foreground">{lead.companyName}</div>
                      <div className="truncate text-xs text-muted-foreground">{lead.email ?? "no email"}</div>
                    </div>
                    <StatusPill label={lead.suppressed ? "Suppressed" : lead.issue ?? "Blocked"} tone="amber" />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" name="confirmLaunch" value="yes" className="h-4 w-4" />
            I confirm launching this campaign. Suppression runs again immediately before every provider call.
          </label>
          <button type="submit" className={primaryButtonCls}>
            <Send className="h-4 w-4" aria-hidden="true" /> Launch campaign
          </button>
        </form>
      )}
    </PanelCard>
  );
}

function ReadinessPanel({ campaign }: { campaign: CampaignDetail }) {
  const readiness = computeCampaignReadiness({
    stepCount: campaign.stepCount,
    senderCount: campaign.senderCount,
    liveSenderCount: campaign.liveSenderCount,
    enrolledCount: campaign.enrolledCount,
    trackingEnabled: campaign.trackingEnabled,
    verifiedTrackingSenderCount: campaign.verifiedTrackingSenderCount,
    hasSchedule: parseSchedule(campaign.scheduleJson) !== null,
    outreachReadyLeadRatio: null,
  });
  const barTone = readiness.band === "ready" ? "bg-emerald-500" : readiness.band === "almost" ? "bg-amber-400" : "bg-red-400";
  return (
    <PanelCard title="Launch readiness">
      <div className="mb-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium text-foreground">Readiness</span>
          <span className="text-2xl font-bold tabular-nums text-foreground">{readiness.score}<span className="text-sm font-medium text-muted-foreground">/100</span></span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
          <div className={`h-full rounded-full ${barTone}`} style={{ width: `${readiness.score}%` }} />
        </div>
        <ul className="mt-2 space-y-1">
          {readiness.checks.map((c) => (
            <li key={c.key} className="flex items-center gap-2 text-xs">
              {c.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />}
              <span className={c.ok ? "text-muted-foreground" : "font-medium text-foreground"}>{c.label}</span>
            </li>
          ))}
        </ul>
      </div>
      {campaign.readiness.length === 0 ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          Campaign setup is ready for the worker-gated launch path.
        </div>
      ) : (
        <div className="space-y-2">
          {campaign.readiness.map((blocker) => (
            <div key={blocker} className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="font-semibold">{READINESS_LABELS[blocker]}</div>
              <div className="mt-1 text-xs">Resolve this blocker before launch.</div>
            </div>
          ))}
        </div>
      )}
    </PanelCard>
  );
}

function LiveSendGuardPanel({ campaign, workerHealth }: { campaign: CampaignDetail; workerHealth: WorkerHealth }) {
  const hasLiveSender = campaign.liveSenderCount > 0;
  const hasVerifiedSender = campaign.senderCount > 0;
  return (
    <PanelCard title="Live-send setup" description="Live send remains gated by the existing worker path.">
      <ul className="space-y-2 text-sm text-muted-foreground">
        <GuardRow ok={hasVerifiedSender} label="Verified sender in pool" />
        <GuardRow ok={hasLiveSender} label="Sender liveSendEnabled=true" />
        <GuardRow ok={isJobWorkerHealthy(workerHealth)} label="Healthy V2 worker heartbeat in production" />
        <GuardRow ok={campaign.readiness.length === 0} label="Launch readiness blockers resolved" />
        <GuardRow ok={false} label="Credential key and kill switch are evaluated server-side at send time" neutral />
        <GuardRow ok={true} label="Final synchronous suppression check runs before every provider call" />
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">
        This panel never declares live send available by itself; outreach.admin, credentials, kill switch, sender verification, worker
        heartbeat, and suppression gates must pass in the runtime path.
      </p>
    </PanelCard>
  );
}

function PreviewHelperPanel({ campaign, stepOrdinal }: { campaign: CampaignDetail; stepOrdinal: number }) {
  const schedule = parseSchedule(campaign.scheduleJson);
  const timezone = resolveCampaignTimezone({
    mode: campaign.timezoneMode as "LEAD" | "CAMPAIGN" | "ORGANIZATION",
    campaignTimezone: campaign.fallbackTimezone,
  });
  const nextWindow = schedule ? safeNextCampaignWindow(schedule, timezone) : null;
  return (
    <div className="rounded-md border border-border bg-muted/40 p-3">
      <div className="text-xs font-semibold uppercase text-muted-foreground">Preview context</div>
      <div className="mt-3 space-y-2 text-sm text-muted-foreground">
        <div className="flex items-center justify-between gap-3">
          <span>Step</span>
          <span className="font-medium text-foreground">{stepOrdinal}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>Timezone</span>
          <span className="font-medium text-foreground">{timezone}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>Next window</span>
          <span className="font-medium text-foreground">{nextWindow ? formatDate(nextWindow.toISOString()) : "Not configured"}</span>
        </div>
      </div>
    </div>
  );
}

function Toggle({ name, label, defaultChecked, disabled }: { name: string; label: string; defaultChecked: boolean; disabled: boolean }) {
  return (
    <label className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-foreground">
      <input name={name} type="checkbox" defaultChecked={defaultChecked} disabled={disabled} className="h-4 w-4" />
      {label}
    </label>
  );
}

function GuardRow({ ok, label, neutral = false }: { ok: boolean; label: string; neutral?: boolean }) {
  return (
    <li className="flex items-center gap-2">
      {neutral ? (
        <RadioTower className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      ) : ok ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
      ) : (
        <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />
      )}
      <span>{label}</span>
    </li>
  );
}

function StatusPill({ label, tone }: { label: string; tone: "blue" | "green" | "amber" | "red" | "slate" }) {
  const cls =
    tone === "green"
      ? "bg-emerald-50 text-emerald-700"
      : tone === "amber"
        ? "bg-amber-50 text-amber-800"
        : tone === "red"
          ? "bg-red-50 text-red-700"
          : tone === "blue"
            ? "bg-accent text-primary"
            : "bg-muted text-foreground";
  return <span className={"inline-flex rounded-full px-2 py-0.5 text-xs font-semibold " + cls}>{label}</span>;
}


function enrollmentStatusCount(campaign: CampaignDetail, status: string): number {
  return Number(campaign.enrollmentStatuses.find((row) => row.status === status)?.count ?? 0);
}
function normalizeEnrollmentStatus(value: string): EnrollmentStatus | "" {
  const allowed = new Set(["ACTIVE", "PAUSED", "COMPLETED", "HALTED"]);
  return allowed.has(value) ? (value as EnrollmentStatus) : "";
}

function statusTone(status: string): "blue" | "green" | "amber" | "red" | "slate" {
  if (status === "SENT" || status === "DELIVERED" || status === "FINISHED") return "green";
  if (status === "SCHEDULED" || status === "ACTIVE") return "blue";
  if (status === "BOUNCED" || status === "FAILED") return "red";
  if (status === "PAUSED" || status === "SUPPRESSED") return "amber";
  return "slate";
}

function describeLeadSource(source: ReturnType<typeof parseCampaignSource>, shown: number): string {
  if (source.kind === "selected") {
    return `${source.leadAssignmentIds.length} selected lead${source.leadAssignmentIds.length === 1 ? "" : "s"} from the workspace`;
  }
  if (source.kind === "filter") {
    const parts = [
      source.projectId ? "project" : null,
      source.icpVersionId ? "ICP" : null,
      source.ownerUserId ? "owner" : null,
      source.clientAccountId ? "account" : null,
    ].filter(Boolean);
    return parts.length > 0 ? `filtered by ${parts.join(" + ")} (${shown} shown)` : `filtered (${shown} shown)`;
  }
  return `recent activity (${shown} shown)`;
}


function parseSchedule(value: unknown): V2CampaignScheduleV1 | null {
  if (!value || typeof value !== "object") return null;
  const schedule = value as Partial<V2CampaignScheduleV1>;
  if (schedule.schemaVersion !== "v2.campaign-schedule.v1") return null;
  if (!Array.isArray(schedule.weekdays)) return null;
  if (typeof schedule.startLocalTime !== "string" || typeof schedule.endLocalTime !== "string") return null;
  return {
    schemaVersion: "v2.campaign-schedule.v1",
    weekdays: schedule.weekdays.filter((day): day is 1 | 2 | 3 | 4 | 5 | 6 | 7 =>
      Number.isInteger(day) && day >= 1 && day <= 7
    ),
    startLocalTime: schedule.startLocalTime,
    endLocalTime: schedule.endLocalTime,
  };
}

function safeNextCampaignWindow(schedule: V2CampaignScheduleV1, timezone: string): Date | null {
  try {
    return nextCampaignWindow(new Date(), schedule, timezone);
  } catch {
    return null;
  }
}
function formatDelay(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}


function isJobWorkerHealthy(workerHealth: WorkerHealth): boolean {
  return workerHealth.workers.find((worker) => worker.kind === "job_worker")?.healthy ?? false;
}

function emptyEnrollmentResult(page: number): Awaited<ReturnType<typeof queryCampaignEnrollments>> {
  return {
    rows: [],
    total: 0,
    facets: { ACTIVE: 0, PAUSED: 0, COMPLETED: 0, HALTED: 0 },
    pagination: { page, pageSize: 50, total: 0, totalPages: 1 },
  };
}
const READINESS_LABELS: Record<CampaignReadinessCode, string> = {
  NO_EMAIL_STEP: "Add at least one email step and variant body.",
  NO_SENDER_POOL: "Assign at least one sender to the campaign.",
  NO_LIVE_SENDER: "Verify a healthy SMTP sender, set cap/warmup, then flip it live.",
  NO_ENROLLED_LEADS: "Select qualified leads with valid, non-suppressed email.",
  SCHEDULE_MISSING: "Configure send days, local window, and fallback IANA timezone.",
  TRACKING_DOMAIN_UNVERIFIED: "Tracking is enabled, so verify the custom tracking domain first.",
};
