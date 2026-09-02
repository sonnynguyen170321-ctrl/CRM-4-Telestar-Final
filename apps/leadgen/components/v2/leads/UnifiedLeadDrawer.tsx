"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import {
  X, Mail, Phone, MapPin, ExternalLink, UserCircle2, CalendarClock,
  ListTodo, Activity, CheckCircle2, ChevronLeft, ChevronRight, Target, Sparkles, Users2,
  UserPlus, AlertCircle, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";

import {
  addLeadNoteAction,
  createLeadTaskAction,
  completeLeadTaskAction,
  logLeadActivityAction,
  overrideLeadQualificationAction,
} from "@/app/v2/workspace/leads/actions";
import { WorkflowBadge, QualificationBadge } from "@/components/v2/leads/AssessmentSummaryCard";
import { LeadDrawerActions } from "@/components/v2/leads/LeadDrawerActions";
import { useLeadDrawer } from "@/components/v2/leads/LeadDrawerProvider";
import { CompanyIntelligencePanel } from "@/components/v2/company-intelligence/CompanyIntelligencePanel";
import { presentCompanyIntelligence } from "@/lib/v2/company-intelligence/presentIntelligence";
import { deriveOutreachAngles } from "@/lib/v2/crm/outreachAngles";
import { formatDate, formatRelative } from "@/lib/v2/format/datetime";
import { toExternalHref, toGoogleSearchHref } from "@/lib/v2/format/url";
import { describeIdentifierValidity } from "@/lib/v2/crm/identifierDisplay";
import { DrawerExternalLinks } from "@/components/v2/shared/DrawerExternalLinks";
import { presentScoreExplanation } from "@/lib/v2/crm/presentScoreExplanation";
import { contactabilityLabel, contactQualityReasonLabel, deriveContactability } from "@/lib/v2/crm/contactQuality";
import type {
  LeadWorkspaceDetail, LeadTimelineEvent, LeadNote, LeadTask, AssignableMember,
} from "@/lib/v2/crm";
import type { ContactDetail } from "@/lib/v2/crm/queryContacts";
import type { LeadEnrollment } from "@/lib/v2/outreach/sequences/queryEnrollment";
import type { CampaignOption } from "@/components/v2/leads/AddToCampaignDialog";

// evidenceSnapshotJson.dimensionResults ships as EITHER an object keyed by dimension
// ({ signals: { hits: [...] }, ... }) — the shape every persisted assessment actually uses — OR a
// legacy array ([{ dimension: "signals", hits: [...] }]). The old drawer code called .find() on it
// and crashed the whole render ("find is not a function") for every object-form assessment. Read
// both shapes and guard every level so a malformed/absent snapshot can never throw at render time.
function extractPenalizedSignals(evidenceSnapshotJson: unknown): string[] {
  if (!evidenceSnapshotJson || typeof evidenceSnapshotJson !== "object") return [];
  const raw = (evidenceSnapshotJson as Record<string, unknown>).dimensionResults;
  let signals: unknown = null;
  if (Array.isArray(raw)) {
    signals = raw.find(
      (d) => d && typeof d === "object" && (d as Record<string, unknown>).dimension === "signals"
    );
  } else if (raw && typeof raw === "object") {
    signals = (raw as Record<string, unknown>).signals;
  }
  const hits = signals && typeof signals === "object" ? (signals as Record<string, unknown>).hits : null;
  if (!Array.isArray(hits)) return [];
  const labels: string[] = [];
  for (const hit of hits) {
    if (!hit || typeof hit !== "object") continue;
    const { id, label } = hit as Record<string, unknown>;
    if (typeof id === "string" && id.startsWith("signal_neg_") && typeof label === "string") {
      labels.push(label.replace("Negative Signal: ", ""));
    }
  }
  return labels;
}

// subScores.semantic ships inside evidenceSnapshotJson; guard the shape so a non-object snapshot
// (or a missing/non-numeric semantic) can never throw or return junk during render.
function readSemanticSubScore(evidenceSnapshotJson: unknown): number | null {
  if (!evidenceSnapshotJson || typeof evidenceSnapshotJson !== "object") return null;
  const subScores = (evidenceSnapshotJson as Record<string, unknown>).subScores;
  if (!subScores || typeof subScores !== "object") return null;
  const semantic = (subScores as Record<string, unknown>).semantic;
  return typeof semantic === "number" ? semantic : null;
}

type Props = {
  detail: LeadWorkspaceDetail | null;
  contactDetail: ContactDetail | null;
  timeline?: LeadTimelineEvent[];
  leadNotes?: LeadNote[];
  leadTasks?: LeadTask[];
  assignableMembers?: AssignableMember[];
  enrollments?: LeadEnrollment[];
  campaigns?: CampaignOption[];
  onClose: () => void;
  onOpenLead: (leadAssignmentId: string) => void;
  variant?: "overlay" | "inline";
};

const inputCls =
  "w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-primary/20 focus:ring-2 focus:ring-primary/20";

// SSR-safe (deterministic UTC/en-US) date + relative formatting — avoids the toLocale* hydration
// mismatch. See lib/v2/format/datetime.ts.
function fmt(iso: string | null): string {
  return formatDate(iso);
}
function rel(iso: string): string {
  return formatRelative(iso);
}

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/shared/Tabs";

type TabKey = "outreach" | "qualification" | "intelligence" | "activity" | "linked";

export function UnifiedLeadDrawer({
  detail, contactDetail,
  timeline = [], leadNotes = [], leadTasks = [], assignableMembers = [],
  enrollments = [], campaigns = [],
  onClose, onOpenLead, variant = "overlay",
}: Props) {
  const { refresh, prev, next, canPrev, canNext, position } = useLeadDrawer();
  const [pendingAction, setPendingAction] = useState<"QUALIFIED" | "UNQUALIFIED" | null>(null);
  const [, startTransition] = useTransition();

  // Optimistic desk state — the action persists in the background and refresh() reconciles.
  const [optQual, setOptQual] = useOptimistic(detail?.qualification ?? "NEEDS_REVIEW");
  const [optNotes, addOptNote] = useOptimistic(leadNotes, (s: LeadNote[], n: LeadNote) => [n, ...s]);
  const [optTasks, mutateTasks] = useOptimistic(
    leadTasks,
    (s: LeadTask[], a: { kind: "add"; task: LeadTask } | { kind: "done"; id: string }) =>
      a.kind === "add" ? [a.task, ...s] : s.map((t) => (t.id === a.id ? { ...t, status: "DONE" } : t))
  );
  const [optTouches, addOptTouch] = useOptimistic(timeline, (s: LeadTimelineEvent[], e: LeadTimelineEvent) => [e, ...s]);

  const leadId = detail?.leadAssignmentId ?? "";

  // Keyboard deck controls: ←/J prev, →/K next, Q qualify, U disqualify. Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (e.key === "ArrowLeft" || e.key === "j" || e.key === "J") { if (canPrev) { e.preventDefault(); prev(); } }
      else if (e.key === "ArrowRight" || e.key === "k" || e.key === "K") { if (canNext) { e.preventDefault(); next(); } }
      else if (e.key === "q" || e.key === "Q") { e.preventDefault(); qualify("QUALIFIED"); }
      else if (e.key === "u" || e.key === "U") { e.preventDefault(); qualify("UNQUALIFIED"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPrev, canNext, prev, next, leadId]);

  if (!detail) return null;

  const asideCls =
    variant === "inline"
      ? "flex h-full w-full flex-col bg-surface"
      : "fixed inset-y-0 right-0 z-40 flex w-full max-w-[880px] flex-col border-l border-hairline bg-surface/95 shadow-2xl backdrop-blur-xl transition-all";

  const c = contactDetail?.contact;
  // The contact's OWN LinkedIn (sourced from the contact's LINKEDIN identifier), normalized to a
  // safe external href so a scheme-less stored value can't resolve to the app's 404 page.
  const contactLinkedIn = toExternalHref(c?.linkedInUrl);
  const companyWebsite = toExternalHref(detail.companyWebsiteUrl ?? detail.companyDomain);
  const contactGoogle = toGoogleSearchHref([detail.contactDisplayName ?? detail.contactName, detail.contactTitle, detail.companyName]);
  const location = [c?.city, c?.country].filter(Boolean).join(", ");
  const linked = contactDetail?.linkedLeadAssignments ?? [];
  const projects = Array.from(new Set(linked.map((l) => l.projectName)));
  const icps = Array.from(new Set(linked.map((l) => `${l.icpProfileName} v${l.icpVersionNumber}`)));
  const openTasks = optTasks.filter((t) => t.status === "OPEN");
  const nextAction = openTasks[0] ?? null;
  const touches = optTouches.filter((e) => e.source === "outreach" || e.source === "activity").slice(0, 8);
  const intelligence = presentCompanyIntelligence(detail.companyIntelligence);
  const angles = deriveOutreachAngles(intelligence, { companyName: detail.companyName, contactTitle: detail.contactTitle });
  const score = detail.latestAssessment?.fitScore ?? null;
  const explanation = detail.latestAssessment
    ? presentScoreExplanation({
        evidenceSnapshotJson: detail.latestAssessment.evidenceSnapshotJson,
        hardGateResultsJson: detail.latestAssessment.hardGateResultsJson,
        dataQualityJson: detail.latestAssessment.dataQualityJson,
      })
    : null;

  const matchedNegatives = extractPenalizedSignals(detail.latestAssessment?.evidenceSnapshotJson);

  const semanticScore = readSemanticSubScore(detail.latestAssessment?.evidenceSnapshotJson);

  function qualify(qualification: "QUALIFIED" | "UNQUALIFIED") {
    const fd = new FormData();
    fd.append("leadAssignmentId", leadId);
    fd.append("qualification", qualification);
    setPendingAction(qualification);
    startTransition(async () => {
      setOptQual(qualification);
      await overrideLeadQualificationAction(fd);
      refresh();
      setPendingAction(null);
    });
  }

  function submitNote(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const body = (fd.get("body") as string)?.trim();
    if (!body) return;
    fd.append("leadAssignmentId", leadId);
    form.reset();
    startTransition(async () => {
      addOptNote({ id: `tmp-${Date.now()}`, body, authorName: "You", createdAt: new Date().toISOString() });
      await addLeadNoteAction(fd);
      refresh();
    });
  }

  function submitTask(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const title = (fd.get("title") as string)?.trim();
    if (!title) return;
    const dueAt = (fd.get("dueAt") as string) || null;
    fd.append("leadAssignmentId", leadId);
    form.reset();
    startTransition(async () => {
      mutateTasks({ kind: "add", task: { id: `tmp-${Date.now()}`, title, detail: null, dueAt, status: "OPEN", ownerName: "You", createdAt: new Date().toISOString() } });
      await createLeadTaskAction(fd);
      refresh();
    });
  }

  function completeTask(id: string) {
    const fd = new FormData();
    fd.append("taskId", id);
    startTransition(async () => {
      mutateTasks({ kind: "done", id });
      await completeLeadTaskAction(fd);
      refresh();
    });
  }

  function submitActivity(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const channel = (fd.get("channel") as string) || "note";
    const outcome = (fd.get("outcome") as string) || "";
    fd.append("leadAssignmentId", leadId);
    form.reset();
    startTransition(async () => {
      addOptTouch({ source: "activity", sourceId: `tmp-${Date.now()}`, title: outcome || `${channel} logged`, channel, occurredAt: new Date().toISOString() } as LeadTimelineEvent);
      await logLeadActivityAction(fd);
      refresh();
    });
  }

  const idents = contactDetail?.identifiers ?? [];
  const emailIdent = idents.find((i) => i.type === "EMAIL");
  const phoneIdent = idents.find((i) => i.type === "PHONE");
  const linkedInIdent = idents.find((i) => i.type === "LINKEDIN");
  const contactability = deriveContactability({
    email: c?.email ?? emailIdent?.normalizedValue ?? null,
    title: c?.title ?? detail.contactTitle,
    linkedInUrl: c?.linkedInUrl ?? linkedInIdent?.normalizedValue ?? null,
    linkedInValidityStatus: linkedInIdent?.validityStatus ?? null,
    emailValidityStatus: emailIdent?.validityStatus ?? null,
    emailIsGeneric: emailIdent?.isGeneric ?? false,
    phone: c?.phone ?? phoneIdent?.normalizedValue ?? null,
  });
  const outreachReady = contactability.status === "ready";
  const outreachDisabledReason = outreachBlockReason(contactability.status);

  const tabs: { key: TabKey; label: string }[] = [
    { key: "outreach", label: "Outreach" },
    { key: "qualification", label: "Qualification" },
    { key: "intelligence", label: "Company Intel" },
    { key: "activity", label: "Activity" },
    { key: "linked", label: "Linked ICPs" },
  ];

  const qualifyDisabled = (target: "QUALIFIED" | "UNQUALIFIED") => optQual === target;

  return (
    <aside className={asideCls}>
      {/* Header */}
      <div className="shrink-0 border-b border-hairline px-6 pt-4 bg-background/30">
        {/* Deck nav */}
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button type="button" onClick={prev} disabled={!canPrev} title="Previous (←/J)" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-30">
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" onClick={next} disabled={!canNext} title="Next (→/K)" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-30">
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
            {position ? <span className="ml-1 text-xs font-semibold text-muted-foreground">Lead {position.index} of {position.total}</span> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Close (Esc)" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-xl font-bold text-foreground">{detail.contactDisplayName ?? detail.contactName ?? "Company-level lead"}</h2>
              {score !== null && (
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold shadow-sm ${score >= 80 ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600" : score >= 50 ? "border-amber-500/20 bg-amber-500/10 text-amber-600" : "border-hairline bg-secondary text-foreground"}`}>
                  Fit {score}
                </span>
              )}
              <QualificationBadge qualification={optQual} />
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${contactabilityBadgeClass(contactability.status)}`}>{contactabilityLabel(contactability.status)}</span>
            </div>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {[detail.contactTitle, detail.companyName].filter(Boolean).join(" at ") || detail.companyName}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {c?.email ? (
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                  {c.email}
                  {emailIdent?.validityStatus && (() => {
                    const ev = describeIdentifierValidity(emailIdent.validityStatus);
                    return (
                    <span className={`inline-flex items-center rounded-full px-1.5 py-0.2 text-[9px] font-bold uppercase ${
                      ev.tone === "good" ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20" :
                      ev.tone === "bad" ? "bg-red-500/10 text-red-600 border border-red-500/20" :
                      "bg-secondary text-foreground border border-hairline"
                    }`}>
                      {ev.label}
                    </span>
                    );
                  })()}
                </span>
              ) : null}
              {c?.phone ? (
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                  {c.phone}
                  {phoneIdent?.validityStatus && (
                    <span className="inline-flex items-center rounded-full px-1.5 py-0.2 text-[9px] font-bold bg-secondary text-foreground border border-hairline">
                      {phoneIdent.validityStatus}
                    </span>
                  )}
                </span>
              ) : null}
              {location ? <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" aria-hidden="true" />{location}</span> : null}
              {contactLinkedIn ? <a href={contactLinkedIn} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-primary hover:text-primary/80 transition-colors font-semibold"><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />LinkedIn</a> : null}
            </div>
            <DrawerExternalLinks website={companyWebsite} google={contactGoogle} className="mt-2.5" />
          </div>
          <div className="flex shrink-0 flex-col items-end gap-3">
            {/* Always-on qualify (Q / U) */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => qualify("QUALIFIED")}
                disabled={qualifyDisabled("QUALIFIED") || pendingAction !== null}
                title="Mark Qualified (Q)"
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-[13px] font-semibold text-emerald-600 shadow-sm transition-colors hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-40"
              >
                {pendingAction === "QUALIFIED" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Qualify
              </button>
              <button
                type="button"
                onClick={() => qualify("UNQUALIFIED")}
                disabled={qualifyDisabled("UNQUALIFIED") || pendingAction !== null}
                title="Disqualify (U)"
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-hairline bg-surface px-3 py-1.5 text-[13px] font-semibold text-foreground shadow-sm transition-colors hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-40"
              >
                {pendingAction === "UNQUALIFIED" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Disqualify
              </button>
            </div>
            {!detail.contactId ? (
              <Button size="sm" className="bg-primary hover:bg-primary/80 text-primary-foreground font-semibold shadow-premium" asChild>
                <Link href={`/v2/crm/contacts/new?companyId=${detail.companyId}`}>
                  <UserPlus className="mr-1.5 h-4 w-4" />
                  Find/Add contact
                </Link>
              </Button>
            ) : null}
            <LeadDrawerActions leadAssignmentId={leadId} enrollments={enrollments} campaigns={campaigns} outreachReady={outreachReady} outreachDisabledReason={outreachDisabledReason} />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="outreach" className="flex flex-col flex-1 min-h-0 mt-5">
        <div className="px-6 pb-0">
          <TabsList className="bg-transparent border-b border-hairline w-full justify-start rounded-none h-auto p-0">
            {tabs.map((tab) => (
              <TabsTrigger 
                key={tab.key} 
                value={tab.key}
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      {/* Body */}
      <div className="flex-1 overflow-y-auto bg-background/30 p-6">
        <TabsContent value="outreach" className="m-0 focus-visible:outline-none">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <Card title="Outreach readiness" icon={<Mail className="h-4 w-4 text-primary" />}>
              <div className="space-y-3 text-sm">
                <div className={`rounded-xl border p-3 ${outreachReady ? "border-emerald-500/20 bg-emerald-500/5" : "border-amber-500/25 bg-amber-500/5"}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${contactabilityBadgeClass(contactability.status)}`}>{contactabilityLabel(contactability.status)}</span>
                    <span className="text-xs font-medium text-muted-foreground">Primary channel: {contactability.primaryChannel}</span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">{outreachReady ? "Email and campaign actions are available for this ICP-scoped lead assignment." : outreachDisabledReason}</p>
                </div>
                <ChannelRow icon={<Mail className="h-4 w-4" />} label="Email" value={c?.email ?? emailIdent?.normalizedValue ?? null} status={emailIdent?.validityStatus ?? "missing"} source={emailIdent ? (emailIdent.isGeneric ? "generic" : "person") : null} ready={contactability.emailUsable} />
                <ChannelRow icon={<Phone className="h-4 w-4" />} label="Phone" value={c?.phone ?? phoneIdent?.normalizedValue ?? null} status={phoneIdent?.validityStatus ?? "missing"} source={phoneIdent?.isValid ? "valid" : null} ready={contactability.primaryChannel === "phone"} />
                <ChannelRow icon={<ExternalLink className="h-4 w-4" />} label="LinkedIn" value={c?.linkedInUrl ?? linkedInIdent?.normalizedValue ?? null} status={linkedInIdent?.validityStatus ?? "missing"} source={linkedInIdent?.isValid ? "valid" : null} ready={contactability.primaryChannel === "linkedin"} href={contactLinkedIn} />
                {contactability.reasons.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {contactability.reasons.map((reason) => (
                      <span key={reason} className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{contactQualityReasonLabel(reason)}</span>
                    ))}
                  </div>
                ) : null}
              </div>
            </Card>

            <Card title="Lead context" icon={<Target className="h-4 w-4 text-emerald-600" />}>
              <div className="space-y-2.5 text-sm">
                <Row label="ICP">{detail.icpProfileName} v{detail.icpVersionNumber}</Row>
                <Row label="Project">{detail.projectName}</Row>
                <Row label="Company"><Link href={`/v2/crm/companies?companyId=${detail.companyId}`} className="font-semibold text-primary hover:text-primary/80 transition-colors">{detail.companyName}</Link></Row>
                <Row label="Last touch">{detail.lastTouchAt ? `${rel(detail.lastTouchAt)}${detail.lastTouchChannel ? ` via ${detail.lastTouchChannel}` : ""}` : "No touch yet"}</Row>
                <Row label="Campaign sequence">{enrollments.length > 0 ? `${enrollments.length} active/history campaign sequence${enrollments.length === 1 ? "" : "s"}` : "No campaign sequence"}</Row>
              </div>
            </Card>

            <div className="lg:col-span-2">
              <Card title="Suggested angles" icon={<Sparkles className="h-4 w-4 text-amber-500" />}>
                {angles.length > 0 ? (
                  <ul className="grid gap-2 md:grid-cols-2">
                    {angles.slice(0, 4).map((a, i) => (
                      <li key={i} className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 shadow-premium">
                        <div className="text-sm font-bold text-foreground">{a.title}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{a.detail}</div>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-muted-foreground italic">Run company intelligence to unlock outreach angles.</p>}
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="qualification" className="m-0 focus-visible:outline-none">
          <div className="space-y-5">
            {/* Brainstorm canvas — who they target + angles, so a fresh SDR can pitch */}
            <div className="grid gap-5 md:grid-cols-2">
              <Card title="Who they sell to" icon={<Users2 className="h-4 w-4 text-primary" />}>
                {intelligence.likelyBuyers.length > 0 || intelligence.targetMarket.length > 0 || intelligence.businessModel ? (
                  <div className="space-y-2.5 text-sm">
                    {intelligence.likelyBuyers.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {intelligence.likelyBuyers.map((b, i) => <span key={i} className="rounded-full bg-purple-500/10 text-purple-600 px-2 py-0.5 text-xs font-semibold border border-purple-500/20">{b}</span>)}
                      </div>
                    ) : null}
                    {intelligence.targetMarket.length > 0 ? <Row label="Segment">{intelligence.targetMarket.join(", ")}</Row> : null}
                    {intelligence.businessModel ? <Row label="Model">{intelligence.businessModel}</Row> : null}
                    {intelligence.whatTheySell.length > 0 ? <Row label="Sells">{intelligence.whatTheySell.slice(0, 3).join(", ")}</Row> : null}
                  </div>
                ) : <EmptyIntel />}
              </Card>

              <Card title="Why they fit" icon={<Target className="h-4 w-4 text-emerald-600" />}>
                <div className="space-y-2.5 text-sm">
                  <Row label="ICP">{detail.icpProfileName} v{detail.icpVersionNumber}</Row>
                  <Row label="Fit">{score !== null ? `${score}/100` : "Not scored"}</Row>
                  {semanticScore !== null && (
                    <Row label="AI Semantic Match">
                      <span className="font-bold text-primary">{semanticScore}%</span>
                    </Row>
                  )}
                  {matchedNegatives.length > 0 && (
                    <div className="rounded-xl border border-red-500/25 bg-red-500/5 p-2.5 text-xs text-red-600 font-semibold shadow-premium flex items-start gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold">Penalized signals:</span> {matchedNegatives.join(", ")}
                      </div>
                    </div>
                  )}
                  {detail.latestAssessment?.reason ? (
                    <p className="rounded-xl border border-hairline bg-surface p-2.5 text-xs leading-5 text-muted-foreground shadow-premium">{detail.latestAssessment.reason}</p>
                  ) : <p className="text-xs text-muted-foreground italic">Re-score to get a fit rationale.</p>}

                  {/* Graduated per-dimension breakdown + gates/missing evidence (persisted) */}
                  {explanation && explanation.dimensions.length > 0 ? (
                    <div className="space-y-1.5 pt-1">
                      {explanation.dimensions.map((d) => (
                        <div key={d.key} className="flex items-center gap-2">
                          <span className="w-24 shrink-0 text-[11px] text-muted-foreground font-semibold">{d.label}</span>
                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                            <span className={`block h-full rounded-full ${d.score >= 70 ? "bg-emerald-500" : d.score >= 40 ? "bg-amber-400" : "bg-muted-foreground/35"}`} style={{ width: `${d.score}%` }} />
                          </span>
                          <span className="w-7 shrink-0 text-right text-[11px] font-bold tabular-nums text-foreground">{d.score}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {explanation && (explanation.gateHits.length > 0 || explanation.missingEvidence.length > 0) ? (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {explanation.gateHits.map((g, i) => (
                        <span key={`g${i}`} className="rounded-full bg-red-500/10 border border-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-600">{g}</span>
                      ))}
                      {explanation.missingEvidence.map((m, i) => (
                        <span key={`m${i}`} className="rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-600">Missing: {m}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </Card>
            </div>

            {/* Outreach angles (heuristic, from real signals) */}
            <Card title="Outreach angles" icon={<Sparkles className="h-4 w-4 text-amber-500" />}>
              {angles.length > 0 ? (
                <ul className="space-y-2.5">
                  {angles.map((a, i) => (
                    <li key={i} className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 shadow-premium">
                      <div className="text-sm font-bold text-foreground">{a.title}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{a.detail}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground italic">Not enough company intelligence yet — run extraction on the company to unlock angles.</p>
              )}
            </Card>

            {/* Assignment + next action */}
            <div className="grid gap-5 md:grid-cols-2">
              <Card title="Assignment">
                <Row label="Company">
                  <Link href={`/v2/crm/companies?companyId=${detail.companyId}`} className="font-semibold text-primary hover:text-primary/80 transition-colors">{detail.companyName}</Link>
                </Row>
                <Row label="Project">{detail.projectName}</Row>
                <Row label="Status"><div className="flex flex-wrap gap-1"><WorkflowBadge workflowStatus={detail.workflowStatus} /><QualificationBadge qualification={optQual} /></div></Row>
                <Row label="Owner" icon={<UserCircle2 className="h-4 w-4" />}>{detail.ownerName ?? <span className="text-muted-foreground italic">Unassigned</span>}</Row>
                <Row label="Assigned" icon={<CalendarClock className="h-4 w-4" />}>{detail.assignedAt ? fmt(detail.assignedAt) : "—"}</Row>
              </Card>

              <Card title="Next action" icon={<ListTodo className="h-4 w-4 text-primary" />}>
                {nextAction ? (
                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 shadow-premium">
                    <div className="text-sm font-bold text-foreground">{nextAction.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{nextAction.dueAt ? `Due ${fmt(nextAction.dueAt)}` : "No due date"}{nextAction.ownerName ? ` · ${nextAction.ownerName}` : ""}</div>
                  </div>
                ) : <p className="text-sm text-muted-foreground italic">No open task. Add one in the Activity tab.</p>}
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="intelligence" className="m-0 max-w-3xl focus-visible:outline-none">
          <CompanyIntelligencePanel view={intelligence} />
        </TabsContent>

        <TabsContent value="activity" className="m-0 focus-visible:outline-none">
          <div className="grid gap-6 md:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-5">
              <Card title="Recent touch history" icon={<Activity className="h-4 w-4 text-muted-foreground" />}>
                {touches.length > 0 ? (
                  <ol className="relative ml-2 space-y-4 border-l border-hairline">
                    {touches.map((e, i) => (
                      <li key={`${e.source}-${e.sourceId}-${i}`} className="ml-5">
                        <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-muted-foreground ring-4 ring-surface" />
                        <div className="text-sm font-bold text-foreground">{e.title}</div>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span>{rel(e.occurredAt)}</span>
                          {e.channel && e.channel !== "system" ? <span className="rounded bg-secondary border border-hairline px-1.5 py-0.5 text-foreground font-semibold">{e.channel}</span> : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : <p className="text-sm text-muted-foreground italic">No touches recorded yet.</p>}
              </Card>

              <Card title="Notes">
                {optNotes.length > 0 ? (
                  <div className="space-y-3">
                    {optNotes.map((n) => (
                      <div key={n.id} className="rounded-xl border border-hairline bg-surface p-3 shadow-premium">
                        <p className="whitespace-pre-wrap text-sm text-foreground/80">{n.body}</p>
                        <div className="mt-2 text-xs font-semibold text-muted-foreground">{n.authorName ?? "System"} · {fmt(n.createdAt)}</div>
                      </div>
                    ))}
                  </div>
                ) : <span className="text-sm text-muted-foreground italic">No notes yet.</span>}
              </Card>
            </div>

            <div className="space-y-4">
              <Card title="Log activity">
                <form onSubmit={submitActivity} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <select name="channel" defaultValue="call" className={inputCls} aria-label="Channel">
                      <option value="call">Call</option><option value="email">Email</option>
                      <option value="linkedin">LinkedIn</option><option value="meeting">Meeting</option>
                      <option value="note">Note</option><option value="other">Other</option>
                    </select>
                    <input name="outcome" placeholder="Outcome" className={inputCls} />
                  </div>
                  <button type="submit" className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-premium transition-colors hover:bg-primary/80">Log activity</button>
                </form>
              </Card>

              <Card title="Add a note">
                <form onSubmit={submitNote} className="space-y-3">
                  <textarea name="body" rows={4} placeholder="Write a note..." className={`${inputCls} resize-none`} required />
                  <button type="submit" className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-sm font-semibold text-foreground shadow-premium transition-colors hover:bg-surface-raised">Save note</button>
                </form>
              </Card>

              <Card title="Create task">
                <form onSubmit={submitTask} className="space-y-3">
                  <input name="title" placeholder="Task title..." className={inputCls} required />
                  <input type="datetime-local" name="dueAt" className={inputCls} aria-label="Due" />
                  <select name="ownerUserId" defaultValue="" className={inputCls} aria-label="Assign to">
                    <option value="">Assign to me</option>
                    {assignableMembers.map((m) => <option key={m.userId} value={m.userId}>{m.name ?? m.email}</option>)}
                  </select>
                  <button type="submit" className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-premium transition-colors hover:bg-primary/80">Add task</button>
                </form>
              </Card>

              {openTasks.length > 0 ? (
                <Card title={`Open tasks (${openTasks.length})`}>
                  <ul className="space-y-1.5">
                    {openTasks.map((t) => (
                      <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate text-foreground">{t.title}</span>
                        <button type="button" onClick={() => completeTask(t.id)} className="inline-flex shrink-0 items-center gap-1 text-muted-foreground hover:text-emerald-600">
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Done
                        </button>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="linked" className="m-0 focus-visible:outline-none">
          <div className="grid gap-5 md:grid-cols-2">
            <Card title={`Lead assignments (${linked.length})`}>
              {linked.length > 0 ? (
                <div className="space-y-2">
                  {linked.map((l) => (
                    <button type="button" key={l.leadAssignmentId} onClick={() => onOpenLead(l.leadAssignmentId)} className={`flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left transition-colors hover:bg-muted/40 ${l.leadAssignmentId === leadId ? "border-primary/20 bg-accent/50" : "border-border bg-white"}`}>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">{l.projectName}</div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">{l.icpProfileName} v{l.icpVersionNumber}</div>
                      </div>
                      <WorkflowBadge workflowStatus={l.workflowStatus} />
                    </button>
                  ))}
                </div>
              ) : <p className="text-sm text-muted-foreground">No linked assignments.</p>}
            </Card>

            <div className="space-y-5">
              <Card title={`Projects (${projects.length})`}>
                {projects.length > 0 ? <ul className="list-inside list-disc space-y-1 text-sm text-foreground">{projects.map((p, i) => <li key={i}>{p}</li>)}</ul> : <span className="text-sm text-muted-foreground">—</span>}
              </Card>
              <Card title={`ICPs (${icps.length})`}>
                {icps.length > 0 ? <ul className="list-inside list-disc space-y-1 text-sm text-foreground">{icps.map((x, i) => <li key={i}>{x}</li>)}</ul> : <span className="text-sm text-muted-foreground">—</span>}
              </Card>
            </div>
          </div>
        </TabsContent>
      </div>
      </Tabs>
    </aside>
  );
}

function Card({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        {icon}
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function Row({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 py-1 text-sm">
      <dt className="flex items-center gap-1.5 text-muted-foreground">{icon}{label}</dt>
      <dd className="min-w-0 font-medium text-foreground">{children}</dd>
    </div>
  );
}

function outreachBlockReason(status: string): string {
  switch (status) {
    case "review":
      return "Review the contact channel first; email is present but not verified as a person-ready address.";
    case "linkedin_only":
      return "Only LinkedIn is usable right now. Add or verify a person email before email or campaign outreach.";
    case "company_phone":
      return "Only phone is available. Enrich a person email before email or campaign outreach.";
    case "missing":
      return "No usable contact channel is available. Enrich email or phone before outreach.";
    default:
      return "Needs a verified, non-generic email before email or campaign outreach.";
  }
}

function contactabilityBadgeClass(status: string): string {
  switch (status) {
    case "ready":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700";
    case "review":
      return "border-amber-500/25 bg-amber-500/10 text-amber-700";
    case "linkedin_only":
      return "border-sky-500/20 bg-sky-500/10 text-sky-700";
    case "company_phone":
      return "border-violet-500/20 bg-violet-500/10 text-violet-700";
    default:
      return "border-border bg-secondary text-muted-foreground";
  }
}

function ChannelRow({
  icon,
  label,
  value,
  status,
  source,
  ready,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  status: string | null;
  source?: string | null;
  ready?: boolean;
  href?: string | null;
}) {
  const content = value ? (
    href ? <a href={href} target="_blank" rel="noreferrer" className="truncate text-primary hover:text-primary/80">{value}</a> : <span className="truncate text-foreground">{value}</span>
  ) : <span className="italic text-muted-foreground">Missing</span>;

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-white px-3 py-2 shadow-sm">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">{icon}</span>
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="truncate text-sm font-semibold">{content}</div>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${ready ? "bg-emerald-500/10 text-emerald-700" : "bg-secondary text-muted-foreground"}`}>{ready ? "ready" : status ?? "unknown"}</span>
        {source ? <span className="text-[10px] font-medium text-muted-foreground">{source}</span> : null}
      </div>
    </div>
  );
}
function EmptyIntel() {
  return <p className="text-sm text-muted-foreground">No company intelligence yet. Run extraction on the company to learn who they sell to.</p>;
}
