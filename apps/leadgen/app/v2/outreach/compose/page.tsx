import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  Filter,
  Lock,
  Mail,
  Search,
  ShieldAlert,
  Sparkles,
  UserRound,
} from "lucide-react";

import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { PageHeader } from "@/components/shared/PageHeader";
import { saveComposeDraftAsTemplateAction } from "@/app/v2/outreach/templates/actions";
import { ComposeSendButton } from "@/components/v2/outreach/ComposeSendButton";
import { ActionQueue, DataState, InsightStrip, OutreachPanel, OutreachPill, ReadinessChecklist } from "@/components/v2/outreach/OutreachCommandPrimitives";
import { CompanyIntelligencePanel } from "@/components/v2/company-intelligence/CompanyIntelligencePanel";
import { prisma } from "@/lib/server/prisma";
import { getLatestCompanyIntelligenceProfile } from "@/lib/v2/company-intelligence/readModel";
import { presentCompanyIntelligence } from "@telestar/core-intel/presentIntelligence";
import { leadDrawerHref } from "@/lib/v2/crm/leadRoutes";
import { resolveContactDisplayName } from "@/lib/v2/crm/resolveContactDisplayName";
import { drainIfNoWorker } from "@/lib/v2/jobs/drainIfNoWorker";
import type { V2JobDatabase } from "@/lib/v2/jobs/types";
import { isKillSwitchEngaged } from "@/lib/v2/outreach/limits/liveSendGuards";
import { createManualSend, type ManualSendDb } from "@/lib/v2/outreach/send/createManualSend";
import { markTemplateUsed, queryComposeTemplateDetail, queryComposeTemplates, type ComposeTemplateSummary } from "@/lib/v2/outreach/templates/queryComposeTemplates";
import { renderTemplatePreview } from "@/lib/v2/outreach/templates/renderTemplatePreview";
import { resolveTransportMode } from "@/lib/v2/outreach/send/transportMode";
import { RichComposeEditor } from "@/components/v2/outreach/RichComposeEditor";
import { looksLikeHtml } from "@/lib/v2/outreach/send/buildOutreachMessage";
import { getTenantErrorMessage, requirePermission, V2TenantError } from "@/lib/v2/tenant";

export const dynamic = "force-dynamic";

type LeadPick = {
  leadAssignmentId: string;
  companyName: string;
  contactName: string | null;
  contactTitle: string | null;
  email: string | null;
  qualification: string | null;
  fitScore: number | null;
  suppressed: boolean;
};

type LeadComposeDetail = {
  leadAssignmentId: string;
  companyId: string;
  companyName: string;
  companySummary: string | null;
  companyDomain: string | null;
  contactId: string | null;
  contactName: string | null;
  contactTitle: string | null;
  email: string | null;
  qualification: string | null;
  fitScore: number | null;
  confidence: string | null;
  reason: string | null;
};

type SenderPick = { id: string; displayName: string; fromAddress: string; status: string; liveSendEnabled: boolean; signatureHtml: string | null };

async function sendAction(formData: FormData) {
  "use server";
  let context;
  try {
    context = await requirePermission("workflow.update");
  } catch {
    return;
  }
  const get = (k: string) => (formData.get(k)?.toString() ?? "").trim();
  const leadAssignmentId = get("leadAssignmentId");
  const senderAccountId = get("senderAccountId");
  const contactId = get("contactId") || null;
  const toAddress = get("toAddress");
  const subject = get("subject");
  const body = get("body");
  const templateId = get("templateId");
  const attachmentIds = parseAttachmentIds(get("attachmentIds"));
  if (!leadAssignmentId || !senderAccountId || !toAddress) return;

  let outcome: "submitted" | "send-failed" = "submitted";
  try {
    await createManualSend(prisma as unknown as ManualSendDb, {
      organizationId: context.organizationId,
      createdByUserId: context.userId,
      leadAssignmentId,
      contactId,
      senderAccountId,
      toAddress,
      subject,
      body,
      attachmentIds,
      sendRequestId: `${Date.now()}`,
    });
    if (templateId) await markTemplateUsed(context.organizationId, templateId);
    await drainIfNoWorker(prisma as unknown as V2JobDatabase, {
      organizationId: context.organizationId,
      jobType: "EMAIL_SEND",
      max: 3,
    });
  } catch {
    outcome = "send-failed";
  }
  const templateParam = templateId ? `&templateId=${templateId}` : "";
  redirect(`/v2/outreach/compose?leadAssignmentId=${leadAssignmentId}${templateParam}&notice=${outcome}`);
}

export default async function V2OutreachComposePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const leadAssignmentId = pick(params, "leadAssignmentId");
  const templateId = pick(params, "templateId");
  const notice = pick(params, "notice");
  const context = await getContext();
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

  const [senders, detail, queue, templates, selectedTemplate] = await Promise.all([
    loadSenders(context.organizationId),
    leadAssignmentId ? loadLeadDetail(context.organizationId, leadAssignmentId) : Promise.resolve(null),
    loadLeadQueue(context.organizationId),
    queryComposeTemplates(context.organizationId, { status: "ACTIVE" }),
    templateId ? queryComposeTemplateDetail(context.organizationId, templateId) : Promise.resolve(null),
  ]);
  const [suppressed, intelligenceProfile] = await Promise.all([
    detail?.email ? isSuppressed(context.organizationId, detail.email) : Promise.resolve(false),
    detail
      ? getLatestCompanyIntelligenceProfile({ organizationId: context.organizationId, companyId: detail.companyId })
      : Promise.resolve(null),
  ]);

  const intelligence = presentCompanyIntelligence(intelligenceProfile);
  const templatePreview = detail && selectedTemplate
    ? await renderTemplatePreview({
        organizationId: context.organizationId,
        subjectTemplate: selectedTemplate.subjectTemplate,
        bodyTemplate: selectedTemplate.bodyTemplate,
        requiredVariables: selectedTemplate.requiredVariables,
        leadAssignmentId: detail.leadAssignmentId,
      })
    : null;
  const healthySender = senders.find((s) => s.status === "ACTIVE") ?? null;
  const draft = detail ? buildDraft(detail, selectedTemplate, templatePreview) : null;
  const transport = resolveTransportMode({
    senderLiveSendEnabled: Boolean(healthySender?.liveSendEnabled),
    killSwitchEngaged: isKillSwitchEngaged(),
    credentialKeyPresent: Boolean(process.env.V2_OUTREACH_CREDENTIAL_KEY),
  });
  const blockers = buildComposeBlockers({ detail, suppressed, healthySender, draft });
  const canSend = blockers.length === 0;
  const stats = buildQueueStats(queue);

  return (
    <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0">
      <PageHeader
        eyebrow="Outreach"
        title="Smart compose"
        description="A guided manual send workspace with contact context, sender readiness, transport truth, and final suppression-gate visibility."
      />

      <div className="space-y-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/v2/outreach" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary hover:text-primary">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to outreach
          </Link>
          <div className="flex flex-wrap gap-2">
            <OutreachPill tone={transport.mode === "live" ? "green" : "slate"} icon={transport.mode === "live" ? CheckCircle2 : Lock}>
              {transport.label}
            </OutreachPill>
            <OutreachPill tone={blockers.length === 0 ? "green" : "amber"} icon={blockers.length === 0 ? CheckCircle2 : ShieldAlert}>
              {blockers.length === 0 ? "Ready to enqueue" : `${blockers.length} blockers`}
            </OutreachPill>
          </div>
        </div>

        {notice === "submitted" ? (
          <InsightStrip tone="green" icon={CheckCircle2}>
            Message submitted. The EMAIL_SEND handler still owns the final synchronous suppression check and transport decision.
            {detail ? (
              <Link href={leadDrawerHref(detail.leadAssignmentId)} className="ml-1 font-semibold underline">
                Open the lead timeline
              </Link>
            ) : null}
            .
          </InsightStrip>
        ) : notice === "send-failed" ? (
          <InsightStrip tone="red" icon={AlertTriangle}>
            The send could not be created. Re-check recipient, sender, and readiness blockers before trying again.
          </InsightStrip>
        ) : null}

        {senders.length === 0 ? (
          <InsightStrip tone="amber" icon={ShieldAlert}>
            No sender account yet. <Link href="/v2/outreach/senders?add=1" className="font-semibold underline">Add a sender</Link> with encrypted credentials before composing. Sending stays gated until a sender is verified and live.
          </InsightStrip>
        ) : null}

        <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)_360px]">
          <LeadQueuePanel leads={queue} stats={stats} selectedId={detail?.leadAssignmentId ?? null} templateId={templateId ?? null} />

          {detail ? (
            <OutreachPanel
              title={
                <div className="flex min-w-0 items-center gap-2">
                  <Mail className="h-4 w-4 text-primary" aria-hidden="true" />
                  <span className="truncate">Compose to {detail.companyName}</span>
                </div>
              }
              description="Subject and body are deterministic draft hints from V2 lead/company data. Edit before enqueueing."
              actions={<OutreachPill tone={canSend ? "green" : "amber"}>{canSend ? "All checks pass" : "Blocked"}</OutreachPill>}
              className="min-w-0"
            >
              <TemplatePicker templates={templates} selectedTemplateId={selectedTemplate?.id ?? null} leadAssignmentId={detail.leadAssignmentId} />
              <form action={sendAction} className="space-y-4 p-4">
                <input type="hidden" name="leadAssignmentId" value={detail.leadAssignmentId} />
                <input type="hidden" name="contactId" value={detail.contactId ?? ""} />
                <input type="hidden" name="toAddress" value={detail.email ?? ""} />
                <input type="hidden" name="templateId" value={selectedTemplate?.id ?? ""} />
                <input type="hidden" name="companyName" value={detail.companyName} />

                <div className="grid gap-3 md:grid-cols-2">
                  <Labeled label="To">
                    <div className="flex min-h-11 items-center rounded-md border border-border bg-muted/40 px-3 text-sm text-foreground">
                      <span className="truncate">{detail.contactName ? `${detail.contactName} - ` : ""}{detail.email ?? "No email on file"}</span>
                    </div>
                  </Labeled>
                  <Labeled label="From sender">
                    <select name="senderAccountId" className={inputCls} defaultValue={healthySender?.id ?? ""}>
                      {senders.map((s) => (
                        <option key={s.id} value={s.id} disabled={s.status !== "ACTIVE"}>
                          {s.displayName} ({s.fromAddress}){s.status !== "ACTIVE" ? ` - ${s.status}` : ""}
                        </option>
                      ))}
                    </select>
                  </Labeled>
                </div>

                <Labeled label="Subject">
                  <input name="subject" className={inputCls} defaultValue={draft?.subject} required />
                </Labeled>
                <Labeled label="Body">
                  <RichComposeEditor
                    name="body"
                    value={draft ? (looksLikeHtml(draft.body) ? draft.body : textToHtml(draft.body)) : ""}
                    minHeightPx={260}
                    uploadUrl="/v2/outreach/attachments"
                    attachmentsFieldName="attachmentIds"
                    signatureHtml={healthySender?.signatureHtml ?? null}
                  />
                </Labeled>

                <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card/95 px-4 py-3 backdrop-blur">
                  <div className="min-w-0 text-xs leading-5 text-muted-foreground">
                    <div className="font-medium text-foreground">Pre-flight summary</div>
                    {blockers.length > 0 ? blockers.join("; ") : `${transport.label}. Final suppression check still runs immediately before provider call.`}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="submit" formAction={saveComposeDraftAsTemplateAction} className="inline-flex min-h-11 items-center rounded-md border border-border bg-white px-3 text-sm font-semibold text-foreground hover:bg-muted/40">
                      Save as template
                    </button>
                    <ComposeSendButton canSend={canSend} mode={transport.mode} blockers={blockers} />
                  </div>
                </div>
              </form>
            </OutreachPanel>
          ) : (
            <OutreachPanel title="Pick a lead to compose" description="Select a tenant-scoped active LeadAssignment from the queue." className="min-w-0">
              <DataState
                icon={Search}
                title="Choose a lead from the queue"
                description="The composer opens once a contact is selected. Suppressed, missing-email, and needs-review leads stay visible as blockers."
              />
            </OutreachPanel>
          )}

          <aside className="space-y-5 xl:sticky xl:top-5 xl:self-start">
            <OutreachPanel title="Send readiness" description="The button stays disabled until blockers are resolved.">
              <div className="p-4">
                <ReadinessChecklist
                  items={buildReadinessItems({ detail, suppressed, healthySender, draft })}
                  footer="The UI can enqueue only after these checks pass; the worker send path still performs the final suppression check."
                />
              </div>
            </OutreachPanel>

            <OutreachPanel title="Next best action" description="Computed from current recipient, sender, and transport state.">
              <div className="p-4">
                <ActionQueue items={buildActionItems(blockers, detail)} emptyLabel="Ready for a reviewed manual send." />
              </div>
            </OutreachPanel>

            {detail ? (
              <OutreachPanel title="Lead context" description="Human identity first; IDs stay hidden in form state.">
                <div className="space-y-3 p-4 text-sm">
                  <ContextLine icon={UserRound} label="Contact" value={[detail.contactName, detail.contactTitle].filter(Boolean).join(" / ") || "Company-level contact"} />
                  <ContextLine icon={Building2} label="ICP fit" value={formatScore(detail)} />
                  <ContextLine icon={Sparkles} label="Domain" value={detail.companyDomain ?? "No domain recorded"} />
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground">Why this lead</div>
                    <p className="mt-1 text-sm leading-6 text-foreground">
                      {detail.reason ?? detail.companySummary ?? "No scoring or company-intelligence summary is recorded yet."}
                    </p>
                  </div>
                </div>
              </OutreachPanel>
            ) : null}

            {detail ? <CompanyIntelligencePanel view={intelligence} /> : null}
          </aside>
        </div>
      </div>
    </WorkspaceFrame>
  );
}

function TemplatePicker({
  templates,
  selectedTemplateId,
  leadAssignmentId,
}: {
  templates: ComposeTemplateSummary[];
  selectedTemplateId: string | null;
  leadAssignmentId: string;
}) {
  return (
    <div className="border-b border-border bg-muted/40 px-4 py-3">
      <form action="/v2/outreach/compose" className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <input type="hidden" name="leadAssignmentId" value={leadAssignmentId} />
        <Labeled label="Use template">
          <select name="templateId" className={inputCls} defaultValue={selectedTemplateId ?? ""}>
            <option value="">No template - use smart draft</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}{template.category ? ` / ${template.category}` : ""}
              </option>
            ))}
          </select>
        </Labeled>
        <button type="submit" className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary">
          Apply
        </button>
        <Link href="/v2/outreach/templates" className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-white px-4 text-sm font-semibold text-foreground hover:bg-muted/40">
          Manage templates
        </Link>
      </form>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        Templates render into editable subject/body snapshots. Applying one does not change suppression, sender, or transport readiness.
      </p>
    </div>
  );
}
function LeadQueuePanel({ leads, stats, selectedId, templateId }: { leads: LeadPick[]; stats: QueueStats; selectedId: string | null; templateId: string | null }) {
  return (
    <OutreachPanel
      title="Lead queue"
      description="Active assignments ranked by sendability."
      actions={<OutreachPill tone="blue" icon={Filter}>{leads.length} leads</OutreachPill>}
      className="min-w-0"
    >
      <div className="space-y-3 p-3">
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 xl:grid-cols-2">
          <QueueChip label="Qualified" value={stats.qualified} />
          <QueueChip label="Needs review" value={stats.needsReview} />
          <QueueChip label="Missing email" value={stats.missingEmail} />
          <QueueChip label="Suppressed" value={stats.suppressed} />
        </div>
        {leads.length === 0 ? (
          <DataState icon={Mail} title="No active contact queue" description="Qualify leads and enrich contact emails first." />
        ) : (
          <div className="max-h-[640px] space-y-2 overflow-y-auto pr-1">
            {leads.map((lead) => {
              const state = leadQueueState(lead);
              const selected = lead.leadAssignmentId === selectedId;
              return (
                <Link
                  key={lead.leadAssignmentId}
                  href={`/v2/outreach/compose?leadAssignmentId=${lead.leadAssignmentId}${templateId ? `&templateId=${templateId}` : ""}`}
                  className={`block rounded-md border p-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/20 ${selected ? "border-primary/20 bg-accent" : "border-border bg-card hover:bg-muted/40"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-foreground">{lead.companyName}</div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {lead.contactName ?? "Company-level"}{lead.contactTitle ? ` / ${lead.contactTitle}` : ""}
                      </div>
                    </div>
                    <OutreachPill tone={state.tone} className="min-h-6 shrink-0 px-2 py-0 text-[11px]">
                      {state.label}
                    </OutreachPill>
                  </div>
                  <div className="mt-2 truncate text-xs text-muted-foreground">{lead.email ?? "No valid email"}</div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </OutreachPanel>
  );
}

function QueueChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 px-2.5 py-2">
      <div className="text-base font-semibold tabular-nums text-foreground">{value}</div>
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
    </div>
  );
}

function ContextLine({ icon: Icon, label, value }: { icon: typeof UserRound; label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0">
        <div className="text-xs font-semibold text-muted-foreground">{label}</div>
        <div className="mt-0.5 text-sm font-medium text-foreground">{value}</div>
      </div>
    </div>
  );
}

function buildComposeBlockers({
  detail,
  suppressed,
  healthySender,
  draft,
}: {
  detail: LeadComposeDetail | null;
  suppressed: boolean;
  healthySender: SenderPick | null;
  draft: ReturnType<typeof buildDraft> | null;
}) {
  const blockers: string[] = [];
  if (!detail) blockers.push("Select a LeadAssignment");
  if (detail && !detail.email) blockers.push("Recipient has no valid email");
  if (suppressed) blockers.push("Recipient is suppressed");
  if (!healthySender) blockers.push("No active sender account is available");
  if (detail && !draft?.body.trim()) blockers.push("Email body is empty");
  return blockers;
}

function buildReadinessItems(input: {
  detail: LeadComposeDetail | null;
  suppressed: boolean;
  healthySender: SenderPick | null;
  draft: ReturnType<typeof buildDraft> | null;
}) {
  return [
    { ok: Boolean(input.detail), label: "LeadAssignment selected", detail: input.detail?.companyName ?? "Pick a lead from the queue." },
    { ok: Boolean(input.detail?.email), label: "Recipient email available", detail: input.detail?.email ?? "Missing or invalid contact email." },
    { ok: !input.suppressed, label: input.suppressed ? "Recipient is suppressed" : "Suppression pre-check passed", detail: "The final suppression check still runs in the send handler." },
    { ok: Boolean(input.healthySender), label: "Active sender available", detail: input.healthySender ? `${input.healthySender.displayName} (${input.healthySender.fromAddress})` : "Add or activate a sender." },
    { ok: Boolean(input.draft?.body.trim()), label: "Draft body prepared", detail: "Review and personalize before enqueueing." },
  ];
}

function buildActionItems(blockers: string[], detail: LeadComposeDetail | null) {
  if (blockers.length === 0) return [];
  return blockers.map((blocker) => ({
    label: blocker,
    tone: blocker.includes("suppressed") ? "red" as const : "amber" as const,
    detail: actionDetail(blocker, detail),
    action: blocker.includes("sender") ? (
      <Link href="/v2/outreach/senders?add=1" className="inline-flex min-h-9 items-center rounded-md bg-primary px-3 text-xs font-semibold text-white hover:bg-primary">
        Open sender setup
      </Link>
    ) : null,
  }));
}

function actionDetail(blocker: string, detail: LeadComposeDetail | null) {
  if (blocker.includes("LeadAssignment")) return "Choose a recipient from the left queue.";
  if (blocker.includes("email")) return detail ? "Enrich or attach a valid contact email before sending." : "Select a lead first.";
  if (blocker.includes("suppressed")) return "Suppressed recipients remain visible for diagnosis but are never sendable.";
  if (blocker.includes("sender")) return "Create, verify, and activate a sender before enqueueing manual sends.";
  return "Review the composer fields.";
}

type QueueStats = { qualified: number; needsReview: number; missingEmail: number; suppressed: number };

function buildQueueStats(leads: LeadPick[]): QueueStats {
  return leads.reduce(
    (acc, lead) => {
      if (lead.qualification === "QUALIFIED") acc.qualified += 1;
      if (lead.qualification === "NEEDS_REVIEW") acc.needsReview += 1;
      if (!lead.email) acc.missingEmail += 1;
      if (lead.suppressed) acc.suppressed += 1;
      return acc;
    },
    { qualified: 0, needsReview: 0, missingEmail: 0, suppressed: 0 }
  );
}

function leadQueueState(lead: LeadPick): { label: string; tone: "green" | "amber" | "red" | "slate" } {
  if (lead.suppressed) return { label: "Suppressed", tone: "red" };
  if (!lead.email) return { label: "No email", tone: "amber" };
  if (lead.qualification === "QUALIFIED") return { label: "Qualified", tone: "green" };
  if (lead.qualification === "NEEDS_REVIEW") return { label: "Needs review", tone: "amber" };
  return { label: "Not scored", tone: "slate" };
}

function formatScore(detail: LeadComposeDetail) {
  const parts = [
    detail.qualification ? formatLabel(detail.qualification) : null,
    detail.fitScore != null ? `${detail.fitScore}/100 fit` : null,
    detail.confidence ? `${detail.confidence} confidence` : null,
  ].filter(Boolean);
  return parts.join(" / ") || "Not scored yet";
}

function buildDraft(detail: LeadComposeDetail, template: { subjectTemplate: string; bodyTemplate: string } | null = null, preview: { subject: { text: string; error: string | null }; body: { text: string; error: string | null } } | null = null) {
  if (template) {
    return {
      subject: preview?.subject.text || template.subjectTemplate,
      body: preview?.body.text || template.bodyTemplate,
    };
  }
  const contact = detail.contactName?.split(" ")[0] || "there";
  const summary = detail.companySummary ?? detail.reason;
  const titleLine = detail.contactTitle ? `Saw your role in ${detail.contactTitle.toLowerCase()} and wanted to reach out.` : "Wanted to reach out with a quick idea.";
  return {
    subject: `Quick question for ${detail.companyName}`,
    body: [
      `Hi ${contact},`,
      "",
      titleLine,
      summary ? `I noticed ${detail.companyName}: ${summary}` : `I was looking at ${detail.companyName} and thought there may be a relevant fit.`,
      "",
      "Would it be worth a quick conversation next week?",
      "",
      "Best,",
    ].join("\n"),
  };
}

const inputCls =
  "min-h-11 w-full rounded-md border border-border bg-white px-3 text-sm text-foreground outline-none focus:border-primary/20 focus:ring-2 focus:ring-primary/20";

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

// Seed the rich editor from a plaintext smart-draft: paragraphs on blank lines, <br> on single ones.
function textToHtml(text: string): string {
  if (!text.trim()) return "";
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${para.split("\n").map(esc).join("<br />")}</p>`)
    .join("");
}

async function loadSenders(organizationId: string): Promise<SenderPick[]> {
  return prisma.$queryRawUnsafe<SenderPick[]>(
    `SELECT "id", "displayName", "fromAddress", "status"::text AS "status", "liveSendEnabled", "signatureHtml"
     FROM "V2SenderAccount"
     WHERE "organizationId" = $1 AND "deletedAt" IS NULL
     ORDER BY "createdAt" DESC`,
    organizationId
  );
}

async function loadLeadDetail(organizationId: string, leadAssignmentId: string): Promise<LeadComposeDetail | null> {
  const rows = await prisma.$queryRawUnsafe<LeadComposeDetail[]>(
    `SELECT la."id" AS "leadAssignmentId", la."companyId", company."name" AS "companyName",
            profile."companySummary", profile."canonicalDomain" AS "companyDomain",
            contact."id" AS "contactId", contact."fullName" AS "contactName", contact."title" AS "contactTitle",
            (SELECT ci."normalizedValue" FROM "V2ContactIdentifier" ci
               WHERE ci."contactId" = contact."id" AND ci."type" = 'EMAIL' AND ci."isValid" = true
               ORDER BY ci."createdAt" ASC LIMIT 1) AS "email",
            assessment."qualification"::text AS "qualification",
            assessment."fitScore",
            assessment."confidence"::text AS "confidence",
            assessment."reason"
     FROM "V2LeadAssignment" la
     INNER JOIN "V2Company" company ON company."id" = la."companyId" AND company."organizationId" = la."organizationId"
     LEFT JOIN "V2Contact" contact ON contact."id" = la."contactId" AND contact."organizationId" = la."organizationId" AND contact."deletedAt" IS NULL
     LEFT JOIN "V2HardRuleAssessment" assessment ON assessment."id" = la."latestHardRuleAssessmentId" AND assessment."organizationId" = la."organizationId"
     LEFT JOIN LATERAL (
       SELECT cip."companySummary", cip."canonicalDomain"
       FROM "V2CompanyIntelligenceProfile" cip
       WHERE cip."organizationId" = la."organizationId" AND cip."companyId" = la."companyId"
       ORDER BY cip."createdAt" DESC
       LIMIT 1
     ) profile ON true
     WHERE la."id" = $1 AND la."organizationId" = $2 AND la."deletedAt" IS NULL
     LIMIT 1`,
    leadAssignmentId,
    organizationId
  );
  const row = rows[0] ?? null;
  if (!row) return null;
  return {
    ...row,
    contactName: row.contactId
      ? resolveContactDisplayName({ fullName: row.contactName, email: row.email, companyName: row.companyName })
      : row.contactName,
    fitScore: row.fitScore == null ? null : Number(row.fitScore),
  };
}

async function loadLeadQueue(organizationId: string): Promise<LeadPick[]> {
  const rows = await prisma.$queryRawUnsafe<LeadPick[]>(
    `SELECT la."id" AS "leadAssignmentId", company."name" AS "companyName",
            contact."fullName" AS "contactName", contact."title" AS "contactTitle",
            email."value" AS "email",
            assessment."qualification"::text AS "qualification",
            assessment."fitScore",
            CASE WHEN email."value" IS NULL THEN false ELSE EXISTS (
              SELECT 1 FROM "V2SuppressionEntry" suppression
              WHERE suppression."organizationId" = la."organizationId"
                AND suppression."deletedAt" IS NULL
                AND suppression."identifierType" = 'EMAIL'
                AND suppression."identifierValueNormalized" = lower(email."value")
                AND (suppression."expiresAt" IS NULL OR suppression."expiresAt" > CURRENT_TIMESTAMP)
            ) END AS "suppressed"
     FROM "V2LeadAssignment" la
     INNER JOIN "V2Company" company ON company."id" = la."companyId" AND company."organizationId" = la."organizationId"
     LEFT JOIN "V2Contact" contact ON contact."id" = la."contactId" AND contact."organizationId" = la."organizationId" AND contact."deletedAt" IS NULL
     LEFT JOIN "V2HardRuleAssessment" assessment ON assessment."id" = la."latestHardRuleAssessmentId" AND assessment."organizationId" = la."organizationId"
     LEFT JOIN LATERAL (
       SELECT ci."normalizedValue" AS "value"
       FROM "V2ContactIdentifier" ci
       WHERE ci."contactId" = contact."id" AND ci."type" = 'EMAIL' AND ci."isValid" = true
       ORDER BY ci."createdAt" ASC LIMIT 1
     ) email ON true
     WHERE la."organizationId" = $1 AND la."deletedAt" IS NULL AND la."status" = 'ACTIVE'
     ORDER BY CASE assessment."qualification" WHEN 'QUALIFIED' THEN 0 WHEN 'NEEDS_REVIEW' THEN 1 ELSE 2 END,
              CASE WHEN email."value" IS NULL THEN 1 ELSE 0 END,
              la."updatedAt" DESC
     LIMIT 40`,
    organizationId
  );
  return rows.map((row) => ({
    ...row,
    contactName: row.contactName
      ? resolveContactDisplayName({ fullName: row.contactName, email: row.email, companyName: row.companyName })
      : row.contactName,
    fitScore: row.fitScore == null ? null : Number(row.fitScore),
    suppressed: Boolean(row.suppressed),
  }));
}

async function isSuppressed(organizationId: string, email: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT COUNT(*)::int AS n FROM "V2SuppressionEntry"
     WHERE "organizationId" = $1 AND "deletedAt" IS NULL
       AND "identifierType" = 'EMAIL' AND "identifierValueNormalized" = $2
       AND ("expiresAt" IS NULL OR "expiresAt" > CURRENT_TIMESTAMP)`,
    organizationId,
    email.toLowerCase()
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

function pick(params: Record<string, string | string[] | undefined>, key: string) {
  const v = params[key];
  const first = Array.isArray(v) ? v[0] : v;
  return first && first.trim() ? first.trim() : undefined;
}

function parseAttachmentIds(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string").slice(0, 10) : [];
  } catch {
    return [];
  }
}

function formatLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

async function getContext() {
  try {
    return await requirePermission("crm.read");
  } catch (error) {
    if (error instanceof V2TenantError) return error;
    throw error;
  }
}
