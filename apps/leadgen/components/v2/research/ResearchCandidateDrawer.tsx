"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Building2, CheckCircle2, ExternalLink, FileSearch, Globe, Languages, Lightbulb, ListChecks, Loader2, Mail, MapPin, Phone, Radar, ShieldCheck, Sparkles, TrendingUp, User, UserPlus } from "lucide-react";

import { findCandidateEmailAction, launchCompanyWebsiteRunAction, launchLookalikeRunAction, launchPeopleRunAction, translateCandidateAction } from "@/app/v2/research/actions";
import { DrawerSection as Section, EntityHeader, NextActionRail, V2DetailDrawer } from "@/components/v2/drawers/V2DetailDrawer";
import { distill } from "@/lib/v2/insight/paraphrasePrompt";
import { toExternalHref, toGoogleSearchHref } from "@/lib/v2/format/url";
import { DrawerExternalLinks } from "@/components/v2/shared/DrawerExternalLinks";
import type { ResearchCandidateDrawer as DrawerData, ResearchRecommendedAction } from "@/lib/v2/research/queryResearch";

export function ResearchCandidateDrawer({
  open,
  loading,
  detail,
  error,
  onClose,
  onAction,
}: {
  open: boolean;
  loading: boolean;
  detail: DrawerData | null;
  error: string | null;
  onClose: () => void;
  onAction: (action: ResearchRecommendedAction, candidateId: string) => void;
}) {
  const candidate = detail?.candidate ?? null;
  const company = detail?.matchedCompany ?? null;
  const contact = detail?.matchedContact ?? null;
  const companyIdentity = candidate?.company ?? null;

  const router = useRouter();
  const [translating, startTranslate] = useTransition();
  const [discovering, startDiscover] = useTransition();
  // Local overrides keyed by candidate id so switching candidates auto-resets without an effect.
  const [override, setOverride] = useState<{ id: string; name: string | null; snippet: string | null } | null>(null);
  const [errState, setErrState] = useState<{ id: string; msg: string } | null>(null);
  const [emailFound, setEmailFound] = useState<{ id: string; email: string | null; phone: string | null; emailDecision?: ChannelDecision | null; phoneDecision?: ChannelDecision | null; partial?: boolean } | null>(null);

  const translation = candidate
    ? override?.id === candidate.id
      ? override
      : candidate.translatedName || candidate.translatedSnippet
        ? { id: candidate.id, name: candidate.translatedName, snippet: candidate.translatedSnippet }
        : null
    : null;
  const translateError = candidate && errState?.id === candidate.id ? errState.msg : null;
  const emailValue = candidate ? (emailFound?.id === candidate.id ? emailFound.email : null) ?? candidate.emailGuess : null;
  const phoneValue = candidate ? (emailFound?.id === candidate.id ? emailFound.phone : null) ?? candidate.phone : null;
  const emailDecision = candidate ? (emailFound?.id === candidate.id ? emailFound.emailDecision : null) ?? inferEmailDecision(emailValue, candidate.emailStatus) : null;
  const phoneDecision = candidate ? (emailFound?.id === candidate.id ? emailFound.phoneDecision : null) ?? inferPhoneDecision(phoneValue) : null;
  const contactability = contactabilityMeta(emailValue, candidate?.emailStatus ?? null, phoneValue, emailDecision, phoneDecision);

  function translate() {
    if (!candidate) return;
    const id = candidate.id;
    setErrState(null);
    startTranslate(async () => {
      const fd = new FormData();
      fd.set("candidateId", id);
      const res = (await translateCandidateAction(fd)) as { ok: boolean; name?: string | null; snippet?: string | null; error?: string };
      if (res.ok) setOverride({ id, name: res.name ?? null, snippet: res.snippet ?? null });
      else setErrState({ id, msg: res.error ?? "Translation failed." });
    });
  }

  function launchSeeded(action: (fd: FormData) => Promise<unknown>) {
    if (!candidate) return;
    const id = candidate.id;
    startDiscover(async () => {
      const fd = new FormData();
      fd.set("candidateId", id);
      const res = (await action(fd)) as { ok: boolean; runId?: string; error?: string };
      if (res.ok && res.runId) { onClose(); router.push(`/v2/research?runId=${res.runId}`); }
      else setErrState({ id, msg: res.error ?? "Could not start run." });
    });
  }

  function findEmail() {
    if (!candidate) return;
    const id = candidate.id;
    startDiscover(async () => {
      const fd = new FormData();
      fd.set("candidateId", id);
      const res = (await findCandidateEmailAction(fd)) as { ok: boolean; email?: string | null; phone?: string | null; emailDecision?: ChannelDecision | null; phoneDecision?: ChannelDecision | null; partial?: boolean; error?: string };
      if (res.ok && (res.email || res.phone)) setEmailFound({ id, email: res.email ?? null, phone: res.phone ?? null, emailDecision: res.emailDecision ?? null, phoneDecision: res.phoneDecision ?? null, partial: Boolean(res.partial) });
      else setErrState({ id, msg: res.error ?? "Could not find contact channels." });
    });
  }

  const kindLabel = candidate?.kind === "CONTACT" ? "Contact detail" : "Company detail";

  return (
    <V2DetailDrawer open={open} onClose={onClose} widthClass="lg:w-[540px]" labelledBy="research-candidate-drawer-title">
        <EntityHeader
          eyebrow={kindLabel}
          title={translation?.name ?? candidate?.name ?? "Loading candidate"}
          subtitle={candidate ? [companyIdentity?.displayName, companyIdentity?.domain].filter(Boolean).join(" - ") || "Candidate evidence and pipeline state" : "Candidate evidence and pipeline state"}
          titleId="research-candidate-drawer-title"
          onClose={onClose}
          actions={candidate ? (
            <div className="flex items-center gap-2">
              <DrawerExternalLinks
                website={toExternalHref(companyIdentity?.websiteUrl ?? companyIdentity?.domain)}
                google={candidate.kind === "CONTACT"
                  ? toGoogleSearchHref([candidate.name, candidate.title, companyIdentity?.displayName])
                  : toGoogleSearchHref([candidate.name, companyIdentity?.domain])}
              />
              <button type="button" onClick={translate} disabled={translating} className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-md border border-border px-2.5 text-xs font-semibold text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50" title="Translate evidence to English">
                {translating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Languages className="h-3.5 w-3.5" />}
                {translation ? "EN" : "Translate"}
              </button>
            </div>
          ) : null}
        />

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading live state</div>
          ) : error ? (
            <div className="rounded-md border border-red-100 bg-red-50 p-3 text-sm text-red-700">{error}</div>
          ) : detail && candidate ? (
            <div className="space-y-4">
              {/* Insight-first: what they do + why they fit, before any raw evidence. */}
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-primary"><Lightbulb className="h-4 w-4" /> Why this prospect</div>
                <p className="mt-2 text-sm leading-6 text-foreground">
                  {candidate.insight?.summary
                    ?? detail.research.companySummary
                    ?? (candidate.kind === "CONTACT"
                      ? `${candidate.title ?? "Contact"}${companyIdentity?.displayName && companyIdentity.displayName !== "Company unresolved" ? ` at ${companyIdentity.displayName}` : ""}${distill(candidate.sourceSnippet, 140) ? ` - ${distill(candidate.sourceSnippet, 140)}` : "."}`
                      : "Not enriched yet - run enrichment for a business summary.")}
                </p>
                {candidate.fitReason ? <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground"><Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />{candidate.fitReason}{candidate.fitScore != null ? ` (fit ${candidate.fitScore})` : ""}</p> : null}
                {candidate.insight ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {candidate.insight.whatTheySell.map((w) => <Badge key={`s-${w}`}>{w}</Badge>)}
                    {candidate.insight.industry.map((w) => <span key={`i-${w}`} className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-foreground">{w}</span>)}
                    {candidate.insight.size ? <MutedBadge>{candidate.insight.size} employees</MutedBadge> : null}
                    {candidate.insight.hq ? <span className="inline-flex items-center gap-0.5 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground"><MapPin className="h-3 w-3" />{candidate.insight.hq}</span> : null}
                  </div>
                ) : null}
                {candidate.insight?.signals?.length ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground"><TrendingUp className="h-3.5 w-3.5 text-emerald-600" />{candidate.insight.signals.slice(0, 4).map((s) => <span key={s} className="rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700">{s}</span>)}</div>
                ) : null}
              </div>

              {/* Snapshot - the identity + the three numbers that decide the next move. */}
              <Section title="Snapshot">
                <div className="grid gap-2 sm:grid-cols-2">
                  <Fact icon={<Building2 className="h-4 w-4" />} label="Company" value={companyIdentity?.displayName ?? company?.name ?? "Company unresolved"} />
                  <Fact icon={<User className="h-4 w-4" />} label={candidate.kind === "CONTACT" ? "Person" : "Contact"} value={contact?.fullName ?? (candidate.kind === "CONTACT" ? candidate.name : "Company candidate")} />
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {toExternalHref(companyIdentity?.websiteUrl ?? companyIdentity?.domain) ? <EvidenceLink href={toExternalHref(companyIdentity?.websiteUrl ?? companyIdentity?.domain)!} label={companyIdentity?.domain ?? "Website"} icon={<Globe className="h-3 w-3" />} /> : null}
                  {toExternalHref(candidate.linkedinUrl) ? <EvidenceLink href={toExternalHref(candidate.linkedinUrl)!} label="LinkedIn" /> : null}
                  {toExternalHref(candidate.sourceUrl) ? <EvidenceLink href={toExternalHref(candidate.sourceUrl)!} label="Source" /> : null}
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <MiniStatus label="ICP fit" value={percentLabel(candidate.fitScore)} tone={(candidate.fitScore ?? 0) >= 70 ? "good" : candidate.fitScore != null ? "warn" : "muted"} />
                  <MiniStatus label="Contactability" value={contactability.label} tone={contactability.tone} />
                  <MiniStatus label="In pipeline" value={candidate.hasLeadAssignment ? "Yes" : "Not yet"} tone={candidate.hasLeadAssignment ? "good" : "muted"} />
                </div>
              </Section>

              {/* Why it surfaced - the human-readable reason, translated if needed. */}
              <Section title="Why it surfaced">
                <p className="rounded-md bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">{distill(candidate.sourceSnippet, 260) ?? "No source snippet captured for this candidate."}</p>
                {translation?.snippet ? (
                  <p className="mt-2 rounded-md border border-primary/20 bg-accent/50 p-3 text-xs leading-5 text-foreground"><span className="mr-1 font-semibold text-primary">In English:</span>{translation.snippet}</p>
                ) : null}
                {translateError ? <p className="mt-2 text-xs text-amber-700">{translateError}</p> : null}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {candidate.sourceProvider ? <MutedBadge>Found via {candidate.sourceProvider}</MutedBadge> : null}
                  {candidate.matchHints.length ? candidate.matchHints.map((hint) => <Badge key={hint}>{hint}</Badge>) : <MutedBadge>No ICP match hints</MutedBadge>}
                </div>
              </Section>

              {candidate.kind === "CONTACT" || candidate.emailGuess || candidate.phone ? (
                <Section title="Contactability">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <ContactField icon={<Mail className="h-4 w-4" />} label="Email" value={emailValue} status={emailValue ? candidate.emailStatus ?? "GUESSED" : null} href={emailValue ? `mailto:${emailValue}` : null} decision={emailDecision} />
                    <ContactField icon={<Phone className="h-4 w-4" />} label="Phone" value={phoneValue} status={null} href={phoneValue ? `tel:${phoneValue}` : null} decision={phoneDecision} />
                  </div>
                  {candidate.kind === "CONTACT" && (!emailValue || !phoneValue) ? (
                    <button type="button" onClick={findEmail} disabled={discovering} className="mt-2 inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-border px-2.5 text-xs font-semibold text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50">
                      {discovering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />} Find contact channels
                    </button>
                  ) : null}
                </Section>
              ) : null}

              {detail.research.companySummary ? (
                <Section title="Business summary">
                  <p className="text-sm leading-6 text-foreground">{detail.research.companySummary}</p>
                </Section>
              ) : null}

              {/* Everything below is engineer-grade evidence - one click away, not in the way. */}
              <details className="group rounded-lg border border-border bg-card">
                <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2.5 text-sm font-semibold text-foreground [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center gap-2"><FileSearch className="h-4 w-4 text-primary" /> Research details</span>
                  <span className="text-[11px] font-medium text-muted-foreground">evidence - crawl - email lookup - run history</span>
                </summary>
                <div className="space-y-4 border-t border-border p-3">
                  <Section title="Coverage">
                    <div className="grid gap-2 sm:grid-cols-3">
                      <MiniStatus label="Evidence" value={String(detail.evidence.coverage.evidenceCount) + " rows"} tone={detail.evidence.coverage.evidenceCount ? "good" : "muted"} />
                      <MiniStatus label="Observations" value={String(detail.evidence.coverage.observationCount) + " fields"} tone={detail.evidence.coverage.observationCount ? "info" : "muted"} />
                      <MiniStatus label="Runtime" value={String(detail.evidence.coverage.attemptCount) + " attempts"} tone={detail.evidence.coverage.attemptCount ? "info" : "muted"} />
                    </div>
                  </Section>

                  <Section title="Pages we read">
                    {detail.evidence.sourceEvidence.length ? (
                      <div className="space-y-2">
                        {detail.evidence.sourceEvidence.slice(0, 5).map((item, index) => <SourceEvidenceCard key={item.sourceKind + "-" + (item.url ?? String(index))} item={item} />)}
                      </div>
                    ) : <EmptyEvidence text={companyIdentity?.domain ? "No pages captured yet." : "No website captured for this candidate."} />}
                  </Section>

                  <Section title="People found">
                    {detail.evidence.people.length ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {detail.evidence.people.slice(0, 8).map((person, index) => <ObservationCard key={person.value + "-" + String(index)} label={person.value} value={percentLabel(person.confidence)} />)}
                      </div>
                    ) : <EmptyEvidence text="No people found yet." />}
                  </Section>

                  <Section title="Email lookup steps">
                    {detail.evidence.emailWaterfall.length ? (
                      <div className="space-y-2">
                        {detail.evidence.emailWaterfall.map((step, index) => <WaterfallStep key={step.stage + "-" + String(index)} step={step} />)}
                      </div>
                    ) : <EmptyEvidence text={candidate.kind === "CONTACT" ? "The email lookup has not run yet." : "The email lookup runs after people are discovered."} />}
                  </Section>

                  <Section title="Email pattern">
                    {detail.evidence.learnedPatterns.length ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {detail.evidence.learnedPatterns.map((pattern) => <ObservationCard key={pattern.pattern} label={pattern.pattern} value={`${pattern.sampleCount} samples - ${percentLabel(pattern.confidence)}`} />)}
                      </div>
                    ) : <EmptyEvidence text="No learned email pattern for this domain." />}
                  </Section>

                  <Section title="Research status">
                    <div className="grid gap-2 sm:grid-cols-3">
                      <MiniStatusLink label="Website" value={companyIdentity?.websiteUrl ?? null} display={companyIdentity?.domain ?? "No website"} />
                      <MiniStatus label="Research" value={detail.research.snapshotStatus ?? "Not researched yet"} tone={detail.research.snapshotStatus ? "good" : "warn"} />
                      <MiniStatus label="Last pulled" value={formatIso(detail.research.researchedAt) ?? "No pull yet"} tone="muted" />
                    </div>
                  </Section>

                  <Section title="Run history">
                    {detail.evidence.timeline.length ? (
                      <div className="space-y-2">
                        {detail.evidence.timeline.map((item, index) => <TimelineLine key={item.label + "-" + String(index)} item={item} />)}
                      </div>
                    ) : <EmptyEvidence text="No runtime attempts recorded yet." />}
                  </Section>
                </div>
              </details>
            </div>
          ) : null}
        </div>

        {candidate ? (
          <NextActionRail>
            <div className="flex flex-wrap items-center gap-2">
              {detail?.availableActions.includes("research_company") ? <ActionButton label="Research company" onClick={() => onAction("research_company", candidate.id)} /> : null}
              {detail?.availableActions.includes("find_company_website") ? <ActionButton label="Find company website" onClick={() => launchSeeded(launchCompanyWebsiteRunAction)} primary /> : null}
              {detail?.availableActions.includes("add_to_pipeline") ? (candidate.kind === "CONTACT" && !companyIdentity?.domain ? <button type="button" disabled className="inline-flex h-9 cursor-not-allowed items-center rounded-md border border-border bg-muted/40 px-3 text-xs font-semibold text-muted-foreground" title="Add or scope a company website before promoting this contact">Add company domain first</button> : <ActionButton label="Add to pipeline" onClick={() => onAction("add_to_pipeline", candidate.id)} primary />) : null}
              {detail?.availableActions.includes("dismiss") ? <ActionButton label="Dismiss" onClick={() => onAction("dismiss", candidate.id)} /> : null}
              {candidate.leadAssignmentId ? <a href={`/v2/workspace/leads?leadAssignmentId=${candidate.leadAssignmentId}`} className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2">Open lead</a> : null}
            </div>
            {candidate.kind === "COMPANY" ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
                <span className="text-[11px] font-semibold text-muted-foreground">Discover more</span>
                <button type="button" onClick={() => launchSeeded(launchPeopleRunAction)} disabled={discovering} className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-border px-2.5 text-xs font-semibold text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50">
                  {discovering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />} Find people
                </button>
                <button type="button" onClick={() => launchSeeded(launchLookalikeRunAction)} disabled={discovering} className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-border px-2.5 text-xs font-semibold text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50">
                  {discovering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radar className="h-3.5 w-3.5" />} Find lookalikes
                </button>
              </div>
            ) : null}
          </NextActionRail>
        ) : null}
    </V2DetailDrawer>
  );
}

type ChannelDecision = {
  scope?: "PERSON" | "COMPANY" | "UNKNOWN";
  verification?: "VERIFIED" | "CORROBORATED" | "UNVERIFIED" | "INVALID";
  usageDecision?: "AUTO_USABLE" | "MANUAL_APPROVED" | "REVIEW_REQUIRED" | "BLOCKED";
  confidence?: number;
  reasons?: string[];
};

type SourceEvidenceItem = DrawerData["evidence"]["sourceEvidence"][number];
type EmailWaterfallItem = DrawerData["evidence"]["emailWaterfall"][number];
type TimelineItem = DrawerData["evidence"]["timeline"][number];

function SourceEvidenceCard({ item }: { item: SourceEvidenceItem }) {
  const label = item.title ?? item.url ?? item.sourceKind;
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-muted-foreground">
          <FileSearch className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate">{label}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <MutedBadge>{item.provider ?? item.sourceKind}</MutedBadge>
          {item.confidence != null ? <Badge>{percentLabel(item.confidence)}</Badge> : null}
        </div>
      </div>
      {item.snippet ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{distill(item.snippet, 180)}</p> : <p className="mt-2 text-xs text-muted-foreground">No source snippet captured.</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>{formatIso(item.observedAt) ?? "No timestamp"}</span>
        {item.url ? <EvidenceLink href={item.url} label="Open source" /> : null}
      </div>
    </div>
  );
}

function ObservationCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 p-3">
      <div className="break-words text-sm font-semibold text-foreground">{label}</div>
      <div className="mt-1 text-xs text-muted-foreground">{value}</div>
    </div>
  );
}

function WaterfallStep({ step }: { step: EmailWaterfallItem }) {
  const good = step.status === "hit" || step.status === "configured" || step.status === "valid";
  const warn = step.status === "miss" || step.status === "disabled" || step.status === "unconfigured";
  return (
    <div className={`rounded-md border p-3 ${good ? "border-emerald-100 bg-emerald-50" : warn ? "border-amber-100 bg-amber-50" : "border-border bg-muted/40"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
          {good ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />}
          {step.stage}
        </div>
        <Badge>{step.status}</Badge>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{step.detail}</p>
      {step.email ? <p className="mt-1 break-words text-xs font-semibold text-primary">{step.email}</p> : null}
    </div>
  );
}

function TimelineLine({ item }: { item: TimelineItem }) {
  return (
    <div className="flex gap-2 rounded-md border border-border bg-card p-3 text-xs">
      <ListChecks className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold text-foreground">{item.label}</span>
          <Badge>{item.status}</Badge>
        </div>
        <p className="mt-1 text-muted-foreground">{item.detail ?? "Runtime attempt recorded."}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">{formatIso(item.at) ?? "No timestamp"}</p>
      </div>
    </div>
  );
}

function EmptyEvidence({ text }: { text: string }) {
  return <div className="rounded-md border border-dashed border-border bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">{text}</div>;
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="rounded-md border border-border p-3"><div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">{icon}{label}</div><div className="mt-1 truncate text-sm font-semibold text-foreground">{value}</div></div>;
}

function MiniStatus({ label, value, tone }: { label: string; value: string; tone: "good" | "warn" | "info" | "muted" }) {
  const toneClass = tone === "good" ? "border-emerald-100 bg-emerald-50 text-emerald-800" : tone === "warn" ? "border-amber-100 bg-amber-50 text-amber-800" : tone === "info" ? "border-primary/20 bg-accent text-accent-foreground" : "border-border bg-muted/40 text-foreground";
  return <div className={`rounded-md border p-3 ${toneClass}`}><div className="text-[11px] font-semibold opacity-70">{label}</div><div className="mt-1 break-words text-sm font-semibold">{value}</div></div>;
}

function MiniStatusLink({ label, value, display }: { label: string; value: string | null; display: string }) {
  return (
    <div className={`rounded-md border p-3 ${value ? "border-primary/20 bg-accent text-accent-foreground" : "border-amber-100 bg-amber-50 text-amber-800"}`}>
      <div className="text-[11px] font-semibold opacity-70">{label}</div>
      {toExternalHref(value) ? <a href={toExternalHref(value)!} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-1 break-words text-sm font-semibold hover:underline"><Globe className="h-3.5 w-3.5 shrink-0" />{display}<ExternalLink className="h-3 w-3 shrink-0" /></a> : <div className="mt-1 break-words text-sm font-semibold">{display}</div>}
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{children}</span>;
}

function MutedBadge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-muted/40 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground ring-1 ring-border">{children}</span>;
}

function EvidenceLink({ href, label, icon }: { href: string; label: string; icon?: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-primary outline-none hover:bg-accent/70 focus-visible:ring-2 focus-visible:ring-ring/50">{icon}{label}<ExternalLink className="h-3 w-3" /></a>;
}

function ContactField({ icon, label, value, status, href, decision }: { icon: React.ReactNode; label: string; value: string | null; status: string | null; href: string | null; decision: ChannelDecision | null }) {
  const meta = channelMeta(label, value, status, decision);
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2 text-xs font-semibold text-muted-foreground">
        <span className="flex items-center gap-1.5">{icon}{label}</span>
        <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${meta.badgeClass}`}>{meta.icon}{meta.label}</span>
      </div>
      {value ? <a href={href ?? "#"} className="mt-1 block truncate text-sm font-semibold text-primary hover:text-primary/80">{value}</a> : <div className="mt-1 text-sm text-muted-foreground">Not found yet</div>}
      <div className="mt-1 text-xs leading-5 text-muted-foreground">{meta.detail}</div>
    </div>
  );
}

function channelMeta(label: string, value: string | null, status: string | null, decision: ChannelDecision | null) {
  if (!value) {
    return { label: "Missing", detail: "No channel found yet", badgeClass: "bg-muted text-muted-foreground", icon: null };
  }
  if (decision?.usageDecision === "AUTO_USABLE" || decision?.usageDecision === "MANUAL_APPROVED") {
    return { label: "Ready", detail: decision.scope === "PERSON" ? "Person-scoped and usable" : "Approved for use", badgeClass: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300", icon: <CheckCircle2 className="h-3 w-3" /> };
  }
  if (decision?.usageDecision === "BLOCKED") {
    return { label: "Blocked", detail: "Not usable for person outreach", badgeClass: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300", icon: <AlertTriangle className="h-3 w-3" /> };
  }
  if (label === "Phone" || decision?.scope === "COMPANY") {
    return { label: "Review", detail: "Company-scope channel; do not treat as a direct person contact", badgeClass: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300", icon: <AlertTriangle className="h-3 w-3" /> };
  }
  return { label: status === "LIKELY" ? "Review" : "Verify", detail: status === "LIKELY" ? "Corroborated email; approve before outreach" : "Unverified email; verify before outreach", badgeClass: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300", icon: <AlertTriangle className="h-3 w-3" /> };
}

function inferEmailDecision(email: string | null, status: string | null): ChannelDecision | null {
  if (!email) return null;
  if (status === "VERIFIED") return { scope: "PERSON", verification: "VERIFIED", usageDecision: "AUTO_USABLE" };
  if (status === "INVALID") return { scope: "UNKNOWN", verification: "INVALID", usageDecision: "BLOCKED" };
  return { scope: "UNKNOWN", verification: status === "LIKELY" ? "CORROBORATED" : "UNVERIFIED", usageDecision: "REVIEW_REQUIRED" };
}

function inferPhoneDecision(phone: string | null): ChannelDecision | null {
  if (!phone) return null;
  return { scope: "COMPANY", verification: "UNVERIFIED", usageDecision: "REVIEW_REQUIRED" };
}

function contactabilityMeta(email: string | null, status: string | null, phone: string | null, emailDecision: ChannelDecision | null, phoneDecision: ChannelDecision | null): { label: string; tone: "good" | "warn" | "info" | "muted" } {
  if (emailDecision?.usageDecision === "AUTO_USABLE" || emailDecision?.usageDecision === "MANUAL_APPROVED") return { label: "Ready", tone: "good" };
  if (email || phone) {
    if (phoneDecision?.scope === "COMPANY" && !email) return { label: "Company phone", tone: "warn" };
    return { label: status === "INVALID" ? "Blocked" : "Needs review", tone: status === "INVALID" ? "warn" : "warn" };
  }
  return { label: "Missing", tone: "muted" };
}
function ActionButton({ label, onClick, primary = false }: { label: string; onClick: () => void; primary?: boolean }) {
  return <button type="button" onClick={onClick} className={`inline-flex h-9 cursor-pointer items-center rounded-md px-3 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 ${primary ? "bg-primary text-primary-foreground hover:bg-primary/90" : "border border-border text-foreground hover:bg-muted/50"}`}>{label}</button>;
}


function percentLabel(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "No confidence";
  const normalized = value <= 1 ? value * 100 : value;
  return `${Math.round(normalized)}%`;
}
function formatIso(value: string | null) {
  if (!value) return null;
  return value.slice(0, 16).replace("T", " ") + " UTC";
}
