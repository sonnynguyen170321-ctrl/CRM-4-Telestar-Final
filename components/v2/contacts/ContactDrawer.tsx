"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  Mail, X, Phone, MapPin, Link as LinkIcon, Building2, ArrowRight,
  Folder, Target, ArrowUpRight, Briefcase, Loader2, Sparkles, ShieldCheck, Globe
} from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/shared/Tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScoreRing } from "@/components/shared/ScoreRing";
import {
  AccountPreRankBadge,
  formatDateTime,
  QualificationBadge,
  WorkflowBadge,
} from "@/components/v2/leads/AssessmentSummaryCard";
import { QualifyOverride } from "@/components/v2/leads/QualifyOverride";
import { AssignOwnerDialog, type AssignableMember } from "./AssignOwnerDialog";
import { assignOwnerAction } from "@/app/v2/crm/contacts/assignOwnerAction";
import { enrichContactChannelsAction } from "@/app/v2/crm/contacts/enrichContactAction";
import { notifyV2 } from "@/components/v2/notifications/notificationClient";
import {
  companyDrawerHref,
  leadDrawerHref,
} from "@/lib/v2/crm/leadRoutes";
import { toExternalHref, toGoogleSearchHref } from "@/lib/v2/format/url";
import { describeIdentifierValidity } from "@/lib/v2/crm/identifierDisplay";
import { DrawerExternalLinks } from "@/components/v2/shared/DrawerExternalLinks";
import type {
  ContactDetail,
  ContactEmploymentEntry,
} from "@/lib/v2/crm/queryContacts";

type ContactDrawerProps = {
  detail: ContactDetail | null;
  query: Record<string, string | string[]>;
  canOverride?: boolean;
  canAssign?: boolean;
  assignableMembers?: AssignableMember[];
};

function buildHref(query: Record<string, string | string[]>, updates: Record<string, string>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      value.forEach(v => params.append(key, v));
    } else {
      params.set(key, value);
    }
  }
  for (const [key, value] of Object.entries(updates)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  return `/v2/crm/contacts?${params.toString()}`;
}

export function ContactDrawer({ detail, query, canOverride = false, canAssign = false, assignableMembers = [] }: ContactDrawerProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "intelligence" | "activity">("overview");

  if (!detail) return null;

  const { contact, linkedLeadAssignments: leads, recentActivities, identifiers, employmentHistory } = detail;
  const primary = leads[0] ?? null;
  const primaryDeskHref = primary ? leadDrawerHref(primary.leadAssignmentId) : null;
  const projects = Array.from(new Set(leads.map((a) => a.projectName)));
  const icps = Array.from(new Set(leads.map((a) => `${a.icpProfileName} v${a.icpVersionNumber}`)));

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-[900px] max-w-full flex-col border-l border-hairline bg-surface shadow-xl overflow-hidden animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="shrink-0 border-b border-hairline bg-surface px-6 py-5 relative z-10 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-hairline bg-secondary text-2xl font-bold text-foreground shadow-sm">
              {contact.fullName.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[22px] font-bold leading-tight text-foreground">{contact.fullName}</h2>
                {primary ? (
                  <>
                    <QualificationBadge qualification={primary.qualification} />
                    <WorkflowBadge workflowStatus={primary.workflowStatus} />
                  </>
                ) : (
                  <span className="rounded-md border border-hairline bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">No ICP assignment</span>
                )}
              </div>
              <div className="mt-1 text-sm font-medium text-muted-foreground flex items-center gap-2">
                {contact.title || "No title"}
                {primary ? (
                  <>at <span className="font-semibold text-foreground">{primary.companyName}</span></>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] font-medium text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><Mail className="h-4 w-4 text-muted-foreground/85" aria-hidden="true" />{contact.email || "No email"}</span>
                <span className="inline-flex items-center gap-1.5"><Phone className="h-4 w-4 text-muted-foreground/85" aria-hidden="true" />{contact.phone || "No phone"}</span>
                <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4 text-muted-foreground/85" aria-hidden="true" />{contact.country || "Unknown location"}</span>
              </div>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-surface-raised transition-colors" asChild>
            <Link href={buildHref(query, { contactId: "" })}>
              <X className="h-5 w-5" aria-hidden="true" />
            </Link>
          </Button>
        </div>

        {/* Primary action zone */}
        <div className="mt-6 flex flex-wrap items-center gap-2.5">
          {leads.length > 1 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="h-9 bg-primary font-semibold text-primary-foreground shadow-sm hover:bg-primary/80 transition-all">
                  <Target className="mr-2 h-4 w-4" aria-hidden="true" /> Work this lead
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[280px]">
                <DropdownMenuLabel>Select Context (Project / ICP)</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {leads.map((lead) => (
                  <DropdownMenuItem key={lead.leadAssignmentId} asChild>
                    <Link href={leadDrawerHref(lead.leadAssignmentId)} className="flex flex-col items-start gap-1 p-2 cursor-pointer hover:bg-surface-raised transition-colors">
                      <span className="font-semibold text-foreground">{lead.projectName}</span>
                      <span className="text-xs text-muted-foreground">{lead.icpProfileName} v{lead.icpVersionNumber}</span>
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : primaryDeskHref ? (
            <Button className="h-9 bg-primary font-semibold text-primary-foreground shadow-sm hover:bg-primary/80 transition-all" asChild>
              <Link href={primaryDeskHref}>
                <Target className="mr-2 h-4 w-4" aria-hidden="true" /> Work this lead
              </Link>
            </Button>
          ) : null}
          {canAssign && primary && (
            <AssignOwnerDialog
              leadAssignmentId={primary.leadAssignmentId}
              currentOwnerName={contact.ownerName}
              members={assignableMembers}
              onAssign={assignOwnerAction}
            />
          )}
          <ChannelButton kind="email" value={contact.email} />
          <ChannelButton kind="phone" value={contact.phone} />
          <ChannelButton kind="linkedin" value={contact.linkedInUrl} />
          {!contact.email || !contact.phone ? <EnrichChannelsButton contactId={contact.id} /> : null}
          <DrawerExternalLinks
            website={toExternalHref(primary?.companyDomain)}
            google={toGoogleSearchHref([contact.fullName, contact.title, primary?.companyName])}
          />
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview" value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)}>
        <TabsList className="border-b border-hairline bg-secondary/50 px-6">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="intelligence">Intelligence</TabsTrigger>
          <TabsTrigger value="activity">Activity & History</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Content */}
      <div className="flex min-h-0 flex-1 bg-background/30">
        <div className="flex-1 overflow-y-auto p-8">
          {activeTab === "overview" && (() => {
            const emailIdent = identifiers.find((i) => i.type === "EMAIL");
            const phoneIdent = identifiers.find((i) => i.type === "PHONE");
            const linkedinIdent = identifiers.find((i) => i.type === "LINKEDIN");
            const isSGOrMobile = phoneIdent?.normalizedValue.startsWith("+658") || phoneIdent?.normalizedValue.startsWith("+659") || phoneIdent?.normalizedValue.startsWith("(65) 8") || phoneIdent?.normalizedValue.startsWith("(65) 9");
            const isTechRole = /cto|engineer|developer|tech|programmer|architect/i.test(contact.title || "");
            const hasGithubTech = isTechRole;

            return (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px] animate-in fade-in slide-in-from-bottom-2 duration-300">
                {/* Left Main Column */}
                <div className="space-y-6">
                  <section className="rounded-xl border border-hairline bg-surface p-5 shadow-sm">
                    <h3 className="mb-4 text-[13px] font-bold  text-foreground flex items-center gap-2">
                      <Briefcase className="h-4 w-4 text-primary" />
                      Employment History
                    </h3>
                    <EmploymentTimeline contactId={contact.id} history={employmentHistory} />
                  </section>
                  
                  <section className="rounded-xl border border-hairline bg-surface p-5 shadow-sm">
                    <h3 className="mb-4 text-[13px] font-bold  text-foreground flex items-center gap-2">
                      <Target className="h-4 w-4 text-emerald-600" />
                      ICP assignments ({leads.length})
                    </h3>
                    <div className="space-y-3">
                      {leads.length === 0 ? (
                        <div className="text-[13px] italic text-muted-foreground">No ICP assignments.</div>
                      ) : (
                        leads.map((la) => (
                          <div key={la.leadAssignmentId} className="rounded-xl border border-hairline bg-surface p-4 shadow-sm hover:border-primary/50 transition-colors">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-[14px] font-bold text-foreground">{la.projectName}</div>
                                <div className="mt-0.5 flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
                                  <Target className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />{la.icpProfileName} v{la.icpVersionNumber}
                                </div>
                              </div>
                              <Link href={leadDrawerHref(la.leadAssignmentId)} className="inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-primary hover:text-primary/80 bg-primary/10 border border-primary/20 px-2 py-1 rounded-md transition-colors">
                                Open <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                              </Link>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <QualificationBadge qualification={la.qualification} />
                              <WorkflowBadge workflowStatus={la.workflowStatus} />
                              {la.accountPreRank ? <AccountPreRankBadge accountPreRank={la.accountPreRank} /> : null}
                              {la.fitScore !== null && (
                                <span className="ml-auto text-[12px] font-bold text-foreground bg-secondary px-2 py-0.5 rounded-full border border-hairline font-bold">Fit: {la.fitScore}</span>
                              )}
                            </div>
                            {canOverride && la.qualification === "NEEDS_REVIEW" && la.leadAssignmentId !== primary?.leadAssignmentId && (
                              <div className="mt-3 border-t border-hairline pt-3">
                                <QualifyOverride leadAssignmentId={la.leadAssignmentId} />
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                </div>

                {/* Right Sidebar Rail Column */}
                <div className="space-y-6">
                  {/* Primary Company */}
                  <section className="rounded-xl border border-hairline bg-surface p-4 shadow-sm">
                    <h3 className="mb-3 text-[12px] font-bold  text-muted-foreground">Primary Company</h3>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                            <Building2 className="h-4 w-4" aria-hidden="true" />
                          </div>
                          <span className="font-bold text-foreground truncate max-w-[130px]">{primary?.companyName || "Unknown"}</span>
                        </div>
                        {primary && (
                          <Link href={companyDrawerHref(primary.companyId)} className="inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-primary hover:text-primary/80 transition-colors">
                            View <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                          </Link>
                        )}
                      </div>
                      {primary?.companyDomain && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground border-t border-hairline pt-2.5">
                          <Globe className="h-3.5 w-3.5" />
                          {(() => {
                            const site = toExternalHref(primary.companyDomain);
                            return site ? (
                              <a href={site} target="_blank" rel="noreferrer" className="hover:underline font-semibold text-foreground/80 truncate">
                                {primary.companyDomain}
                              </a>
                            ) : (
                              <span className="font-semibold text-foreground/80 truncate">{primary.companyDomain}</span>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  </section>

                  {/* OSINT & Identity Health Card */}
                  <section className="rounded-xl border border-hairline bg-surface p-4 shadow-sm">
                    <h3 className="mb-4 text-[12px] font-bold  text-muted-foreground flex items-center gap-1.5">
                      <ShieldCheck className="h-4 w-4 text-emerald-600" />
                      OSINT & Identity
                    </h3>
                    <div className="space-y-4">
                      {/* Email Verification */}
                      {emailIdent ? (() => {
                        const ev = describeIdentifierValidity(emailIdent.validityStatus);
                        return (
                        <div className="rounded-lg border border-hairline bg-background/40 p-3 text-xs">
                          <div className="flex items-center justify-between font-bold text-foreground">
                            <span className="truncate max-w-[155px]" title={emailIdent.normalizedValue}>{emailIdent.normalizedValue}</span>
                            <span className={`rounded px-1.5 py-0.5 text-[9px]  font-bold ${
                              ev.tone === "good"
                                ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20"
                                : ev.tone === "bad"
                                ? "bg-red-500/10 text-red-600 border border-red-500/20"
                                : "bg-muted text-muted-foreground border border-hairline"
                            }`}>
                              {ev.label}
                            </span>
                          </div>
                          <div className="mt-2.5 pt-2.5 border-t border-hairline flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                            <span className="inline-flex items-center gap-1 bg-surface px-1.5 py-0.5 rounded border border-hairline">
                              <span className={`h-1.5 w-1.5 rounded-full ${ev.tone === "good" ? "bg-emerald-500" : ev.tone === "bad" ? "bg-red-500" : "bg-slate-400"}`}></span>
                              {ev.note}
                            </span>
                            {linkedinIdent && (
                              <span className="inline-flex items-center gap-1 bg-surface px-1.5 py-0.5 rounded border border-hairline">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                                LinkedIn Match
                              </span>
                            )}
                            {hasGithubTech && (
                              <span className="inline-flex items-center gap-1 bg-surface px-1.5 py-0.5 rounded border border-hairline">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                                GitHub User
                              </span>
                            )}
                          </div>
                        </div>
                        );
                      })() : (
                        <div className="text-xs text-muted-foreground italic">No email address listed.</div>
                      )}

                      {/* Phone Verification */}
                      {phoneIdent ? (() => {
                        const isPhoneScientific = phoneIdent.normalizedValue.includes("E+") || phoneIdent.normalizedValue.includes("e+");
                        const isPhoneValid = phoneIdent.isValid && !isPhoneScientific && phoneIdent.normalizedValue.length >= 7;
                        
                        return (
                          <div className="rounded-lg border border-hairline bg-background/40 p-3 text-xs">
                            <div className="flex items-center justify-between font-bold text-foreground">
                              <span className={isPhoneValid ? "" : "text-red-500/90 line-through"}>{phoneIdent.normalizedValue}</span>
                              <span className={`rounded px-1.5 py-0.5 text-[9px]  font-bold ${
                                isPhoneValid
                                  ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20"
                                  : "bg-red-500/10 text-red-600 border border-red-500/20"
                              }`}>
                                {isPhoneValid ? "VALID" : "INVALID"}
                              </span>
                            </div>
                            <div className="mt-2.5 pt-2.5 border-t border-hairline grid grid-cols-2 gap-2 text-[10px] text-muted-foreground">
                              <div>
                                <span className="block text-[9px] font-semibold text-muted-foreground/60">Type</span>
                                <span className={`font-semibold ${isPhoneValid ? "text-foreground" : "text-red-500/70"}`}>
                                  {isPhoneValid ? (isSGOrMobile ? "Mobile" : "Office") : (isPhoneScientific ? "Scientific Notation" : "Unknown")}
                                </span>
                              </div>
                              <div>
                                <span className="block text-[9px] font-semibold text-muted-foreground/60">Registry</span>
                                <span className={`font-semibold ${isPhoneValid ? "text-foreground" : "text-muted-foreground/50"}`}>
                                  {isPhoneValid ? "Active Carrier" : "Unusable / Reject"}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })() : null}

                      {/* Social Footprint */}
                      <div className="pt-2 border-t border-hairline flex items-center justify-between text-xs text-muted-foreground">
                        <span>Profiles found:</span>
                        <div className="flex items-center gap-2">
                          {linkedinIdent && (
                            <span className="font-bold text-primary hover:underline cursor-pointer">LinkedIn</span>
                          )}
                          {hasGithubTech && (
                            <span className="font-bold text-foreground/80 hover:underline cursor-pointer">GitHub</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Linked Assets */}
                  <section className="rounded-xl border border-hairline bg-surface p-4 shadow-sm">
                    <h3 className="mb-3 text-[12px] font-bold  text-muted-foreground">Linked Assets</h3>
                    <div className="space-y-2 text-sm text-muted-foreground font-semibold">
                      <div className="flex items-center gap-2"><Folder className="h-4 w-4 text-primary"/> {projects.length} Projects</div>
                      <div className="flex items-center gap-2"><Target className="h-4 w-4 text-emerald-600"/> {icps.length} ICPs</div>
                    </div>
                  </section>
                </div>
              </div>
            );
          })()}

          {activeTab === "intelligence" && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              {!primary ? (
                <div className="text-sm text-muted-foreground italic text-center py-10">No active ICP assignment to show intelligence for.</div>
              ) : (
                <>
                  <div className="grid grid-cols-[1fr_200px] gap-6">
                    <div className="rounded-xl border border-primary/20 bg-card p-5 shadow-sm">
                      <div className="flex items-center gap-2 text-primary mb-3">
                        <Sparkles className="h-5 w-5"/>
                        <h3 className="font-bold text-sm ">Qualification Reason</h3>
                      </div>
                      {primary.reason ? (
                        <p className="text-sm text-foreground/90 leading-relaxed font-semibold">{primary.reason}</p>
                      ) : (
                        <p className="text-sm text-muted-foreground italic">No automated qualification reason recorded.</p>
                      )}
                      <div className="mt-4 flex items-center gap-2 border-t border-primary/10 pt-4">
                        <QualificationBadge qualification={primary.qualification} />
                        {canOverride && primary.qualification === "NEEDS_REVIEW" && (
                          <QualifyOverride leadAssignmentId={primary.leadAssignmentId} />
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-hairline bg-surface p-5 shadow-sm flex flex-col items-center justify-center text-center">
                      <h3 className="text-[11px] font-bold  text-muted-foreground mb-3">ICP Fit Score</h3>
                      {primary.fitScore !== null ? (
                        <>
                          <ScoreRing score={primary.fitScore} size="lg" label="Fit" />
                          <div className="mt-3 text-[11px] font-semibold text-foreground bg-secondary px-2 py-1 rounded-md border border-hairline">
                            Confidence: {primary.confidenceScore !== null ? Math.round(primary.confidenceScore * 100) + '%' : 'N/A'}
                          </div>
                        </>
                      ) : (
                        <div className="text-sm text-muted-foreground italic py-4">Not scored</div>
                      )}
                    </div>
                  </div>

                  {primary.companySummary && (
                    <section className="rounded-xl border border-hairline bg-surface p-5 shadow-sm">
                      <h3 className="mb-3 text-[12px] font-bold  text-foreground">Company Intelligence</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed mb-6">{primary.companySummary}</p>
                      
                      {Boolean(primary.factsJson) && Array.isArray(primary.factsJson) && (
                        <div>
                          <h4 className="mb-3 text-[11px] font-bold  text-muted-foreground">Key Facts</h4>
                          <div className="flex flex-wrap gap-2">
                            {(primary.factsJson as Array<{ category: string, fact: string }>).map((f, i) => {
                              let bg = "bg-secondary text-foreground border-hairline";
                              if (f.category === "OFFERING") bg = "bg-purple-500/10 text-purple-600 border-purple-500/20";
                              else if (f.category === "BUSINESS_MODEL") bg = "bg-primary/10 text-primary border-primary/20";
                              else if (f.category === "GEOGRAPHY") bg = "bg-emerald-500/10 text-emerald-600 border-emerald-500/20";
                              else if (f.category === "GROWTH") bg = "bg-amber-500/10 text-amber-600 border-amber-500/20";
                              else if (f.category === "RISK") bg = "bg-red-500/10 text-red-600 border-red-500/20";
                              
                              return (
                                <span key={i} className={`inline-flex items-center px-2.5 py-1 rounded-md border text-xs font-semibold shadow-sm ${bg}`}>
                                  {f.fact}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </section>
                  )}
                </>
              )}
            </div>
          )}

          {activeTab === "activity" && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="rounded-xl border border-hairline bg-surface p-6 shadow-sm">
                <h3 className="mb-6 text-[13px] font-bold  text-foreground">Touch History</h3>
                {recentActivities.length > 0 ? (
                  <div className="relative space-y-8 before:absolute before:inset-y-2 before:left-[11px] before:w-px before:bg-hairline">
                    {recentActivities.map((activity) => {
                      const isEmail = activity.channel === "EMAIL";
                      const isMeeting = activity.channel === "MEETING";
                      const icon = isEmail ? <Mail className="h-3 w-3 text-white" /> : isMeeting ? <Briefcase className="h-3 w-3 text-white" /> : <Phone className="h-3 w-3 text-white" />;
                      const color = isEmail ? "bg-primary" : isMeeting ? "bg-purple-500" : "bg-emerald-500";
                      
                      return (
                        <div key={activity.id} className="relative pl-10">
                          <span className={`absolute left-0 top-0.5 flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-surface shadow-sm ${color}`}>
                            {icon}
                          </span>
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] font-bold text-foreground">{activity.eventKind}</span>
                              <span className="text-[11px] font-medium text-muted-foreground">{formatDateTime(activity.occurredAt)}</span>
                            </div>
                            <div className="text-[12px] text-muted-foreground">
                              Logged via <span className="font-semibold capitalize text-foreground">{activity.channel.toLowerCase()}</span>
                            </div>
                            <Link href={leadDrawerHref(activity.leadAssignmentId)} className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:text-primary/80 transition-colors">
                              View in lead desk <ArrowRight className="h-3 w-3" />
                            </Link>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-[13px] italic text-muted-foreground text-center py-8">No recent touch history across any leads.</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}


function EnrichChannelsButton({ contactId }: { contactId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      className="h-9 font-semibold"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await enrichContactChannelsAction(contactId);
          if (res.ok) {
            const found = [res.email ? "email" : null, res.phone ? "phone" : null].filter(Boolean).join(" + ");
            notifyV2({ type: "research.candidate.ready", kind: found ? "success" : "warning", title: found ? `Found ${found}` : "No new contact data", description: res.email ?? "Verified from the company site." });
            router.refresh();
          } else {
            notifyV2({ type: "research.stage.completed", kind: "warning", title: "Enrich failed", description: res.error });
          }
        })
      }
    >
      {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />}
      Find email + phone
    </Button>
  );
}

function EmploymentTimeline({ history }: { contactId: string, history: ContactEmploymentEntry[] }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-[12px] font-bold text-muted-foreground uppercase">Timeline</h4>
      </div>

      {history.length > 0 ? (
        <div className="relative mt-4 space-y-6 before:absolute before:inset-y-2 before:left-[19px] before:w-px before:bg-hairline">
          {history.map((job) => (
            <div key={job.id} className="group relative pl-12">
              <span className={`absolute left-2 top-0.5 flex h-6 w-6 items-center justify-center rounded-md border text-[10px] font-bold shadow-sm ${job.isCurrent ? "border-primary/20 bg-primary/10 text-primary" : "border-hairline bg-secondary text-muted-foreground"}`}>
                {job.companyName.charAt(0).toUpperCase()}
              </span>
              <div className="text-[14px] font-bold text-foreground transition-colors group-hover:text-primary">{job.title || "Unknown title"}</div>
              <div className="text-[13px] font-semibold text-foreground/80">{job.companyName}</div>
              <div className="mt-1 flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
                {job.startDate ? new Date(job.startDate).getFullYear() : "Past"} - {job.isCurrent ? "Present" : (job.endDate ? new Date(job.endDate).getFullYear() : "")}
                {job.isCurrent && <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[9px]  text-emerald-600">Current</span>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-hairline bg-secondary/30 px-3 py-4 text-[13px] italic text-muted-foreground">
          No employment history yet. Link this contact to a company or ICP assignment to populate the timeline.
        </div>
      )}
    </div>
  );
}

function ChannelButton({ kind, value }: { kind: "email" | "phone" | "linkedin"; value: string | null | undefined }) {
  const cfg = {
    email: { label: "Email", icon: <Mail className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />, href: value ? `mailto:${value}` : null, external: false },
    phone: { label: "Call", icon: <Phone className="mr-2 h-4 w-4 text-primary" aria-hidden="true" />, href: value ? `tel:${value}` : null, external: false },
    linkedin: { label: "LinkedIn", icon: <LinkIcon className="mr-2 h-4 w-4 text-primary" aria-hidden="true" />, href: toExternalHref(value), external: true },
  }[kind];

  if (!cfg.href) {
    return (
      <Button disabled className="h-9 cursor-not-allowed border border-hairline bg-secondary font-semibold text-muted-foreground shadow-sm">
        {cfg.icon}{cfg.label}
      </Button>
    );
  }
  return (
    <Button variant="outline" className="h-9 border-hairline bg-surface font-semibold text-foreground shadow-sm hover:bg-surface-raised transition-colors" asChild>
      <a href={cfg.href} {...(cfg.external ? { target: "_blank", rel: "noreferrer" } : {})}>{cfg.icon}{cfg.label}</a>
    </Button>
  );
}
