"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  ExternalLink, X, Globe, MapPin, Users,
  Eye, Search, Send, ShieldX, ArrowUpRight, CheckCircle2, AlertTriangle, Loader2
} from "lucide-react";

import { extractCompanyIntelligenceAction } from "@/app/v2/crm/companies/actions";
import { toExternalHref, toGoogleSearchHref } from "@/lib/v2/format/url";

import { ScoreRing } from "@/components/shared/ScoreRing";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/shared/Tabs";
import {
  AccountPreRankBadge,
  formatDateTime,
  QualificationBadge,
  WorkflowBadge,
} from "@/components/v2/leads/AssessmentSummaryCard";
import type { CompanyDetailResult } from "@/lib/v2/company-intelligence/readModel";
import { presentCompanyIntelligence, type IntelligenceView } from "@telestar/core-intel/presentIntelligence";
import { deriveCompanySignals, type CompanySignals, type CompanyStatusTone } from "@telestar/core-intel/companySignals";
import { CompanyIntelligencePanel, EXTRACT_TRIGGER_CLASS, ExtractIcon } from "@/components/v2/company-intelligence/CompanyIntelligencePanel";
import type { IcpBestMatchResult } from "@/lib/v2/crm";
import { companyLeadsHref, composeHref, leadDrawerHref } from "@/lib/v2/crm/leadRoutes";
import { QualifyOverride } from "@/components/v2/leads/QualifyOverride";
import { CompanyIcpBestMatch } from "./CompanyIcpBestMatch";
import { LazyCompanyActivity, LazyCompanyContacts, LazyCompanyResearchHistory } from "./CompanyDrawerLazyTabs";

type CompanyDrawerProps = {
  detail: CompanyDetailResult | null;
  onClose: () => void;
  bestMatch?: IcpBestMatchResult | null;
  canOverride?: boolean;
};

const TONE_PILL: Record<CompanyStatusTone, string> = {
  green: "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20",
  amber: "bg-amber-500/10 text-amber-600 border border-amber-500/20",
  red: "bg-red-500/10 text-red-600 border border-red-500/20",
  slate: "bg-secondary text-foreground border border-hairline",
};

export function CompanyDrawer({ detail, onClose, bestMatch, canOverride }: CompanyDrawerProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (!detail) {
    return null;
  }

  const company = detail.company;
  const intelligence = presentCompanyIntelligence(detail.latestIntelligenceProfile);
  const signals = deriveCompanySignals({
    view: intelligence,
    researchStatus: company.latestResearchStatus,
    profileStatus: company.latestProfileStatus,
    leadAssignmentCount: company.leadAssignmentCount,
  });
  const techTags = pickTechTags(detail.latestIntelligenceProfile?.facts ?? []);
  const techStack = pickTechStack(detail.latestIntelligenceProfile?.facts ?? []);
  const leadCount = detail.crossIcp.pagination.total;

  const handleExtract = () => {
    startTransition(async () => {
      const fd = new FormData();
      fd.append("companyId", company.id);
      await extractCompanyIntelligenceAction(fd);
      router.refresh();
    });
  };

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-4xl flex-col border-l border-hairline bg-surface/95 shadow-2xl backdrop-blur-xl transition-all">
      {/* Header */}
      <div className="shrink-0 border-b border-hairline px-6 py-4 bg-background/30">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-sm font-bold text-primary-foreground shadow-premium">
              {initials(company.name)}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-lg font-bold text-foreground">{company.name}</h2>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${TONE_PILL[signals.statusPill.tone]}`}>
                  {signals.statusPill.label}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {company.canonicalDomain ? (() => {
                  const site = toExternalHref(company.websiteUrl ?? company.canonicalDomain);
                  return site ? (
                    <a href={site} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:text-primary/80 hover:underline transition-colors font-semibold"><Globe className="h-3.5 w-3.5" aria-hidden="true" />{company.canonicalDomain}</a>
                  ) : (
                    <span className="inline-flex items-center gap-1 font-semibold"><Globe className="h-3.5 w-3.5" aria-hidden="true" />{company.canonicalDomain}</span>
                  );
                })() : null}
                {company.country ? (
                  <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden="true" />{company.country}</span>
                ) : null}
                <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" aria-hidden="true" />In {company.leadAssignmentCount} pipeline{company.leadAssignmentCount === 1 ? "" : "s"}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {company.websiteUrl ? <SocialLink href={company.websiteUrl} icon={<Globe className="h-3 w-3" aria-hidden="true" />}>Website</SocialLink> : null}
                {company.linkedinUrl ? <SocialLink href={company.linkedinUrl} icon={<ExternalLink className="h-3 w-3" aria-hidden="true" />}>LinkedIn</SocialLink> : null}
                {(() => { const g = toGoogleSearchHref([company.name, company.canonicalDomain]); return g ? <SocialLink href={g} icon={<Search className="h-3 w-3" aria-hidden="true" />}>Google</SocialLink> : null; })()}
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 px-6">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="leads">Pipelines ({leadCount})</TabsTrigger>
            <TabsTrigger value="contacts">Contacts</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="history">Data &amp; History</TabsTrigger>
          </TabsList>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-background/30 px-6 py-5">
          {/* OVERVIEW */}
          <TabsContent value="overview">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
              {/* Main column — intelligence leads (summary + facts once); record meta is secondary. */}
              <div className="space-y-4">
                <CompanyIntelligencePanel
                  view={intelligence}
                  isPending={pending}
                  extractSlot={
                    <button onClick={handleExtract} disabled={pending} className={EXTRACT_TRIGGER_CLASS} title="Re-run company intelligence extraction">
                      {pending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ExtractIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      {intelligence.companySummary ? "Re-run research" : "Research this company"}
                    </button>
                  }
                />

                <KeySignalsCard signals={signals} />

                {techStack.length > 0 ? (
                  <Card title="Tech stack">
                    <div className="flex flex-wrap gap-1.5">
                      {techStack.map((tech) => (
                        <span key={tech} className="rounded-md bg-blue-500/10 text-blue-600 px-2 py-0.5 text-[11px] font-semibold border border-blue-500/20 shadow-premium">
                          {tech}
                        </span>
                      ))}
                    </div>
                  </Card>
                ) : null}

                {techTags.length > 0 ? (
                  <Card title="Market Focus & Tags">
                    <div className="flex flex-wrap gap-1.5">
                      {techTags.map((t) => (
                        <span key={t} className="rounded-md bg-secondary px-2 py-0.5 text-[11px] font-semibold text-foreground border border-hairline">{t}</span>
                      ))}
                    </div>
                  </Card>
                ) : null}

                <Card title="Record">
                  <dl className="grid grid-cols-2 gap-3 text-xs">
                    <Meta label="Added" value={formatDateTime(company.createdAt)} />
                    <Meta label="Last researched" value={company.lastEnrichedAt ? formatDateTime(company.lastEnrichedAt) : "Not yet"} />
                    <Meta label="Sourced from" value={sourceLabel(intelligence)} />
                    <Meta label="Research" value={company.latestResearchStatus ? fmt(company.latestResearchStatus) : "Not researched"} />
                  </dl>
                </Card>
              </div>

              {/* Rail */}
              <div className="space-y-4">
                {bestMatch?.best ? <BestIcpRail result={bestMatch} /> : null}
                <CompanyHealthCard signals={signals} />
                <CompanyQualificationSummaryCard company={company} />
                <QuickActionsCard
                  companyId={company.id}
                  domain={company.canonicalDomain}
                  websiteUrl={company.websiteUrl}
                  leadAssignments={detail.crossIcp.rows}
                />
              </div>
            </div>
          </TabsContent>

          {/* LEAD ASSIGNMENTS */}
          <TabsContent value="leads">
            <div className="space-y-4">
              {bestMatch && bestMatch.totalIcps > 1 ? (
                <div className="rounded-xl border border-hairline bg-surface p-4 shadow-premium">
                  <CompanyIcpBestMatch result={bestMatch} />
                </div>
              ) : null}

              <Card
                title="Pipelines"
                subtitle={`This company is being worked in ${leadCount} ICP pipeline${leadCount === 1 ? "" : "s"} — one row each.`}
                contentClassName="p-0"
              >
                {detail.crossIcp.rows.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">Not in any pipeline yet. Add this company to an ICP to start working it.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-left text-sm">
                      <thead className="border-b border-hairline bg-background/50 text-xs uppercase tracking-wide text-muted-foreground font-bold">
                        <tr>
                          <th className="px-4 py-2.5 font-bold">ICP / Project</th>
                          <th className="px-4 py-2.5 font-bold">Qualification</th>
                          <th className="px-4 py-2.5 font-bold">Workflow</th>
                          <th className="px-4 py-2.5 text-right font-bold">Fit</th>
                          <th className="px-4 py-2.5 font-bold">Last scored</th>
                          <th className="px-4 py-2.5 text-right font-bold"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-hairline">
                        {detail.crossIcp.rows.map((row) => (
                          <tr key={row.leadAssignmentId} className="transition-colors hover:bg-surface-raised">
                            <td className="px-4 py-3">
                              <div className="font-bold text-foreground">{row.icpProfileName} v{row.icpVersionNumber}</div>
                              <div className="text-xs text-muted-foreground">{row.projectName}</div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap items-center gap-1">
                                <QualificationBadge qualification={row.qualification} />
                                {row.accountPreRank ? <AccountPreRankBadge accountPreRank={row.accountPreRank} /> : null}
                              </div>
                            </td>
                            <td className="px-4 py-3"><WorkflowBadge workflowStatus={row.workflowStatus} /></td>
                            <td className="px-4 py-3 text-right">
                              {row.fitScore !== null ? (
                                <span className="tabular-nums font-bold text-foreground">{row.fitScore}</span>
                              ) : (
                                <span className="text-xs uppercase text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">{row.lastScoredAt ? formatDateTime(row.lastScoredAt) : "Not scored"}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-end gap-2">
                                {canOverride && row.qualification === "NEEDS_REVIEW" ? (
                                  <QualifyOverride leadAssignmentId={row.leadAssignmentId} />
                                ) : null}
                                <Link href={leadDrawerHref(row.leadAssignmentId)} className="text-xs font-semibold text-primary hover:text-primary/80 transition-colors">View</Link>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>
          </TabsContent>
          {/* CONTACTS */}
          <TabsContent value="contacts">
            <Card title="Contacts" subtitle="Loaded only when this tab opens" contentClassName="p-0">
              <LazyCompanyContacts companyId={company.id} />
            </Card>
          </TabsContent>

          {/* ACTIVITY */}
          <TabsContent value="activity">
            <Card title="Activity" subtitle="Loaded only when this tab opens" contentClassName="p-0">
              <LazyCompanyActivity companyId={company.id} />
            </Card>
          </TabsContent>

          {/* DATA & HISTORY */}
          <TabsContent value="history">
            <div className="space-y-4">
              <Card title="Research timeline" subtitle="Loaded only when this tab opens" contentClassName="p-0">
                <LazyCompanyResearchHistory companyId={company.id} />
              </Card>

              <Card title="Latest research snapshot">
                {detail.latestResearchSnapshot ? (
                  <dl className="grid grid-cols-2 gap-3 text-xs">
                    <Meta label="Status" value={fmt(detail.latestResearchSnapshot.status)} />
                    <Meta label="HTTP" value={detail.latestResearchSnapshot.httpStatus != null ? String(detail.latestResearchSnapshot.httpStatus) : "—"} />
                    <Meta label="Research version" value={`v${detail.latestResearchSnapshot.researchVersion}`} />
                    <Meta label="Ran at" value={formatDateTime(detail.latestResearchSnapshot.createdAt)} />
                    {detail.latestResearchSnapshot.finalUrl ? <Meta label="Final URL" value={detail.latestResearchSnapshot.finalUrl} wide /> : null}
                    {detail.latestResearchSnapshot.errorCode ? <Meta label="Error" value={`${detail.latestResearchSnapshot.errorCode}${detail.latestResearchSnapshot.errorMessage ? ` — ${detail.latestResearchSnapshot.errorMessage}` : ""}`} wide tone="red" /> : null}
                  </dl>
                ) : (
                  <p className="text-sm text-muted-foreground">No research has been run for this company yet.</p>
                )}
              </Card>

              <Card title="Intelligence profile">
                {detail.latestIntelligenceProfile ? (
                  <dl className="grid grid-cols-2 gap-3 text-xs">
                    <Meta label="Profile status" value={fmt(detail.latestIntelligenceProfile.profileStatus)} />
                    <Meta label="Research version" value={`v${detail.latestIntelligenceProfile.researchVersion}`} />
                    <Meta label="Fact tokens" value={String(detail.latestIntelligenceProfile.facts.length)} />
                    <Meta label="Evidence items" value={String(detail.latestIntelligenceProfile.evidenceItems.length)} />
                    <Meta label="Built at" value={formatDateTime(detail.latestIntelligenceProfile.createdAt)} />
                    <Meta label="Stale at" value={detail.latestIntelligenceProfile.staleAt ? formatDateTime(detail.latestIntelligenceProfile.staleAt) : "—"} />
                  </dl>
                ) : (
                  <p className="text-sm text-muted-foreground">No intelligence profile persisted yet.</p>
                )}
              </Card>
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Rail cards
// ---------------------------------------------------------------------------

function BestIcpRail({ result }: { result: IcpBestMatchResult }) {
  const best = result.best!;
  return (
    <Card title="Best ICP fit" subtitle={`Across ${result.totalIcps} ICP${result.totalIcps === 1 ? "" : "s"}`}>
      <div className="flex items-center gap-3">
        {best.fitScore !== null ? (
          <ScoreRing score={best.fitScore} size="lg" label="Fit" />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-border text-[10px] font-medium uppercase text-muted-foreground">Not scored</div>
        )}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">{best.icpProfileName} v{best.icpVersionNumber}</div>
          <div className="truncate text-xs text-muted-foreground">{best.projectName}</div>
          <div className="mt-1"><QualificationBadge qualification={best.qualification} /></div>
        </div>
      </div>
      <Link href={leadDrawerHref(best.leadAssignmentId)} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary">
        View ICP match <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
      </Link>
    </Card>
  );
}

function CompanyHealthCard({ signals }: { signals: CompanySignals }) {
  return (
    <Card title="Company health">
      <ul className="space-y-2">
        {signals.health.map((row) => (
          <li key={row.label} className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">{row.label}</span>
            <span className={`font-medium ${row.tone === "green" ? "text-emerald-700" : "text-muted-foreground"}`}>{row.value}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted-foreground">Based on their public website.</p>
    </Card>
  );
}


function CompanyQualificationSummaryCard({ company }: { company: CompanyDetailResult["company"] }) {
  const summary = company.qualificationSummary;
  const buckets = [
    { key: "qualified", label: "Qualified", value: summary.qualified, className: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20" },
    { key: "needsReview", label: "Needs review", value: summary.needsReview, className: "bg-amber-500/10 text-amber-700 border-amber-500/20" },
    { key: "needsContact", label: "Needs contact", value: summary.needsContact, className: "bg-blue-500/10 text-blue-700 border-blue-500/20" },
    { key: "unqualified", label: "Unqualified", value: summary.unqualified, className: "bg-red-500/10 text-red-700 border-red-500/20" },
    { key: "notScored", label: "Not scored", value: summary.notScored, className: "bg-secondary text-muted-foreground border-hairline" },
  ];

  return (
    <Card title="ICP qualification" subtitle="ICP-assignment scoped, not a company score.">
      {company.leadAssignmentCount === 0 ? (
        <div className="text-sm text-muted-foreground">No active ICP assignments yet.</div>
      ) : (
        <div className="space-y-2">
          <div className="text-sm font-semibold text-foreground">{company.leadAssignmentCount.toLocaleString()} active ICP assignment{company.leadAssignmentCount === 1 ? "" : "s"}</div>
          <div className="grid grid-cols-2 gap-1.5">
            {buckets.filter((bucket) => bucket.value > 0).map((bucket) => (
              <div key={bucket.key} className={`rounded-md border px-2 py-1 ${bucket.className}`}>
                <div className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{bucket.label}</div>
                <div className="text-sm font-bold tabular-nums">{bucket.value.toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
function QuickActionsCard({
  companyId, domain, websiteUrl, leadAssignments,
}: {
  companyId: string;
  domain: string | null;
  websiteUrl: string | null;
  leadAssignments: Array<{ leadAssignmentId: string; icpProfileName: string; icpVersionNumber: number }>;
}) {
  const [showOutreachOptions, setShowOutreachOptions] = useState(false);

  return (
    <Card title="Quick actions">
      <div className="space-y-1">
        <ActionLink href={companyLeadsHref(companyId)} icon={<Eye className="h-3.5 w-3.5" aria-hidden="true" />}>View ICP assignments</ActionLink>
        {domain ? <ActionLink href={`/v2/crm/contacts?search=${encodeURIComponent(domain)}`} icon={<Search className="h-3.5 w-3.5" aria-hidden="true" />}>Search contacts</ActionLink> : null}

        {leadAssignments.length === 0 ? (
          <button
            disabled
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/20 cursor-not-allowed"
            title="Add this company to a project ICP first."
          >
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
            Start outreach (No ICP)
          </button>
        ) : leadAssignments.length === 1 ? (
          <ActionLink
            href={composeHref(leadAssignments[0].leadAssignmentId)}
            icon={<Send className="h-3.5 w-3.5" aria-hidden="true" />}
          >
            Start outreach ({leadAssignments[0].icpProfileName})
          </ActionLink>
        ) : (
          <div className="space-y-1">
            <button
              onClick={() => setShowOutreachOptions(!showOutreachOptions)}
              className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-surface-raised hover:text-primary"
            >
              <span className="flex items-center gap-2">
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                Start outreach ({leadAssignments.length} ICPs)
              </span>
              <span className="text-[10px] text-muted-foreground">{showOutreachOptions ? "▼" : "▶"}</span>
            </button>
            {showOutreachOptions && (
              <div className="ml-4 border-l border-hairline pl-2 space-y-1 py-1 animate-in slide-in-from-top-1 duration-150">
                {leadAssignments.map((la) => (
                  <Link
                    key={la.leadAssignmentId}
                    href={composeHref(la.leadAssignmentId)}
                    className="block rounded px-1.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted/40 hover:text-primary transition-colors"
                  >
                    {la.icpProfileName} v{la.icpVersionNumber}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        <ActionLink href="/v2/outreach/suppression" icon={<ShieldX className="h-3.5 w-3.5" aria-hidden="true" />}>Suppression</ActionLink>
        {websiteUrl ? <ActionLink href={websiteUrl} external icon={<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />}>Open website</ActionLink> : null}
      </div>
    </Card>
  );
}

function KeySignalsCard({ signals }: { signals: CompanySignals }) {
  if (signals.positive.length === 0 && signals.watchOuts.length === 0) return null;
  return (
    <Card title="Key signals">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-600">Positive signals</div>
          {signals.positive.length > 0 ? (
            <ul className="space-y-1.5 text-xs text-muted-foreground font-semibold">
              {signals.positive.map((s, i) => (
                <li key={i} className="flex items-start gap-1.5"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />{s}</li>
              ))}
            </ul>
          ) : <p className="text-xs text-muted-foreground italic">None detected.</p>}
        </div>
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-600">Watch outs</div>
          {signals.watchOuts.length > 0 ? (
            <ul className="space-y-1.5 text-xs text-muted-foreground font-semibold">
              {signals.watchOuts.map((s, i) => (
                <li key={i} className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />{s}</li>
              ))}
            </ul>
          ) : <p className="text-xs text-muted-foreground italic">None.</p>}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function Card({
  title, subtitle, action, children, contentClassName = "p-4",
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-hairline bg-surface shadow-premium">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-hairline px-4 py-2.5 bg-background/30">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-foreground">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div className={contentClassName}>{children}</div>
    </section>
  );
}

function Meta({ label, value, wide, tone }: { label: string; value: string; wide?: boolean; tone?: "red" }) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 break-words font-semibold ${tone === "red" ? "text-red-500 font-bold" : "text-foreground"}`}>{value}</dd>
    </div>
  );
}

function SocialLink({ href, icon, children }: { href: string; icon: ReactNode; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-hairline bg-surface px-2 py-0.5 text-xs font-semibold text-foreground transition-colors hover:bg-surface-raised hover:text-primary">
      {icon}{children}
    </a>
  );
}

function ActionLink({ href, icon, children, external }: { href: string; icon: ReactNode; children: ReactNode; external?: boolean }) {
  const cls = "flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-surface-raised hover:text-primary";
  if (external) {
    return <a href={href} target="_blank" rel="noreferrer" className={cls}>{icon}{children}</a>;
  }
  return <Link href={href} className={cls}>{icon}{children}</Link>;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join("") || "?";
}


function sourceLabel(view: IntelligenceView): string {
  if (view.debug.providerUsed) return `${fmt(view.debug.providerUsed)} + website`;
  return "Website crawl";
}

function pickTechTags(facts: string[]): string[] {
  const priority = ["category.", "industry.", "offering.", "business_model."];
  const picked: string[] = [];
  for (const prefix of priority) {
    for (const token of facts) {
      if (token.startsWith(prefix) && !picked.includes(token)) picked.push(token);
      if (picked.length >= 5) break;
    }
    if (picked.length >= 5) break;
  }
  return picked.slice(0, 5).map((t) => fmt(t.slice(t.indexOf(".") + 1)));
}

function pickTechStack(facts: string[]): string[] {
  const tech = ["HubSpot", "Salesforce", "Google Analytics", "Facebook Pixel", "Stripe", "Shopify", "WordPress", "Webflow", "React"];
  const matched: string[] = [];
  for (const token of facts) {
    const clean = token.toLowerCase();
    for (const t of tech) {
      if (clean.includes(t.toLowerCase())) {
        matched.push(t);
      }
    }
  }
  return Array.from(new Set(matched));
}

function fmt(value: string) {
  return value.split(/[_\s]+/).map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : p)).join(" ");
}
