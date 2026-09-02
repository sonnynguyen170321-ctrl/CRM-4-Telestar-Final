"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/v2/format/datetime";
import { CopyIcon, RocketIcon, CheckIcon, MoreVerticalIcon, ClockIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

import type { V2IcpLibraryVersion } from "@/lib/v2/icp";
import {
  cloneIcpVersionAsDraftAction,
  publishIcpDraftAction,
  saveIcpDraftRulesAction,
  upgradeIcpToRulesV2Action,
} from "@/app/v2/icp-library/actions";

import { IcpOverviewGrid } from "./IcpOverviewGrid";
import { IcpRulesSummary } from "./IcpRulesSummary";
import { IcpRulesEditor } from "./IcpRulesEditor";
import { deleteIcpDraftAction, archiveIcpProfileAction } from "@/app/v2/icp-library/actions";
import { EditIcon, TrashIcon } from "lucide-react";
import type { IcpVersionRulesV2 } from "@telestar/core-scoring/rules/schema-v2";

export function IcpVersionDetail({ 
  version, 
  historyVersions 
}: { 
  version: V2IcpLibraryVersion,
  historyVersions: V2IcpLibraryVersion[]
}) {
  const router = useRouter();
  const [isAuthoringSubmitting, setIsAuthoringSubmitting] = React.useState(false);
  const [isEditing, setIsEditing] = React.useState(false);

  const projectId = version.projectId || "";
  const clientAccountId = version.clientAccountId || "";
  const isDraft = version.status === "DRAFT";

  async function onClone() {
    setIsAuthoringSubmitting(true);
    const formData = new FormData();
    formData.set("sourceVersionId", version.id);
    const res = await cloneIcpVersionAsDraftAction(formData);
    setIsAuthoringSubmitting(false);
    if (res.versionId) {
      router.push(`/v2/icp-library?icpVersionId=${res.versionId}`);
    }
  }

  async function onDelete() {
    if (!confirm("Are you sure you want to delete this draft?")) return;
    setIsAuthoringSubmitting(true);
    const formData = new FormData();
    formData.set("draftVersionId", version.id);
    const res = await deleteIcpDraftAction(formData);
    setIsAuthoringSubmitting(false);
    if (res.success) {
      alert("Draft deleted");
      router.push(`/v2/icp-library`);
    } else {
      alert(res.error || "Error deleting draft");
    }
  }

  async function onDeleteProfile() {
    if (!confirm("Are you sure you want to delete this entire ICP Profile? This will remove it from the library.")) return;
    setIsAuthoringSubmitting(true);
    const formData = new FormData();
    formData.set("icpProfileId", version.icpProfileId);
    const res = await archiveIcpProfileAction(formData);
    setIsAuthoringSubmitting(false);
    if (res.success) {
      alert("ICP Profile deleted");
      router.push(`/v2/icp-library`);
    } else {
      alert(res.error || "Error deleting ICP Profile");
    }
  }

  async function onPublish() {
    if (!confirm("Are you sure you want to publish this ICP draft?")) return;
    setIsAuthoringSubmitting(true);
    const formData = new FormData();
    formData.set("draftVersionId", version.id);
    formData.set("expectedVersion", version.optimisticVersion.toString());
    const res = await publishIcpDraftAction(formData);
    setIsAuthoringSubmitting(false);
    if (res.success) {
      alert("ICP Draft successfully published!");
      router.push(`/v2/icp-library?icpVersionId=${res.versionId}`);
    } else {
      alert(res.error || "Error publishing ICP draft");
    }
  }

  if (isEditing) {
    return (
      <IcpRulesEditor
        initialRules={version.rulesJson as unknown as IcpVersionRulesV2}
        draftVersionId={version.id}
        expectedVersion={version.optimisticVersion}
        onCancel={() => setIsEditing(false)}
        onSaveSuccess={() => setIsEditing(false)}
      />
    );
  }

  return (
    <div className="flex flex-col xl:flex-row gap-5">
      {/* Main Center Area */}
      <div className="flex-1 min-w-0">
        <div className="bg-surface rounded-xl border border-hairline p-6 shadow-sm">
          <div className="flex justify-between items-start mb-6">
            <div className="flex gap-3 items-center">
              <div className="h-10 w-10 bg-primary/10 text-primary rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold text-foreground">{version.icpProfileName}</h1>
                  <Badge variant="outline" className={isDraft ? "bg-secondary" : "bg-emerald-50 text-emerald-700 border-emerald-200"}>
                    {version.status}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{version.icpProfileDescription || "Define the ideal customers we want to target and win."}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={onClone} disabled={isAuthoringSubmitting}>
                <CopyIcon className="w-4 h-4 mr-2" />
                Duplicate Version
              </Button>
              <Button variant="outline" size="sm" onClick={() => setIsEditing(true)} disabled={isAuthoringSubmitting}>
                <EditIcon className="w-4 h-4 mr-2" />
                Edit Rules
              </Button>
              {isDraft ? (
                <Button size="sm" disabled={isAuthoringSubmitting}>
                  <RocketIcon className="w-4 h-4 mr-2" />
                  Submit for Approval
                </Button>
              ) : (
                <Button size="sm" disabled>
                  Published
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8"><MoreVerticalIcon className="w-4 h-4" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link href={`/v2/ingestion/uploads?clientAccountId=${clientAccountId}&projectId=${projectId}&icpVersionId=${version.id}`}>
                      Upload Data
                    </Link>
                  </DropdownMenuItem>
                  {isDraft && (
                    <DropdownMenuItem onClick={onDelete} className="text-red-600 focus:text-red-700">
                      <TrashIcon className="w-4 h-4 mr-2" /> Delete Draft
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={onDeleteProfile} className="text-red-600 focus:text-red-700">
                    <TrashIcon className="w-4 h-4 mr-2" /> Delete ICP
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href={`/v2/workspace/leads?clientAccountId=${clientAccountId}&projectId=${projectId}&icpVersionId=${version.id}`}>
                      View Leads
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <Tabs defaultValue="overview">
            <TabsList className="w-full justify-start border-b rounded-none h-auto p-0 bg-transparent mb-6">
              <TabsTrigger value="overview" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2">Overview</TabsTrigger>
              <TabsTrigger value="attributes" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2">Attributes</TabsTrigger>
              <TabsTrigger value="signals" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2">Signals</TabsTrigger>
              <TabsTrigger value="notes" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2">Notes (3)</TabsTrigger>
              <TabsTrigger value="activity" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2">Activity Log</TabsTrigger>
            </TabsList>
            
            <TabsContent value="overview" className="m-0 focus-visible:outline-none">
              <IcpOverviewGrid summary={version.rulesSummary} />
              

            </TabsContent>
            
            <TabsContent value="attributes">
              <div className="bg-secondary rounded-lg p-6 text-center text-muted-foreground border border-hairline">
                Attributes Configuration Area
                <div className="mt-4 text-left">
                  <IcpRulesSummary summary={version.rulesSummary} />
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="signals" className="m-0 focus-visible:outline-none">
              {(() => {
                const rules = version.rulesJson as unknown as IcpVersionRulesV2;
                return (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-surface rounded-xl border border-hairline p-5">
                      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                        Positive Signals
                      </h3>
                      <div className="flex flex-wrap gap-1.5">
                        {(rules?.industry?.industryKeywords || []).length > 0 ? (
                          (rules.industry.industryKeywords).map(k => (
                            <span key={k} className="rounded-md bg-emerald-500/10 text-emerald-600 px-2 py-0.5 text-xs font-semibold border border-emerald-500/20">{k}</span>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground italic">No positive keywords defined.</span>
                        )}
                      </div>
                    </div>

                    <div className="bg-surface rounded-xl border border-hairline p-5">
                      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-red-500" />
                        Negative Signals
                      </h3>
                      <div className="flex flex-wrap gap-1.5">
                        {(rules?.negativeSignals || []).length > 0 ? (
                          (rules?.negativeSignals || []).map(k => (
                            <span key={k} className="rounded-md bg-red-500/10 text-red-600 px-2 py-0.5 text-xs font-semibold border border-red-500/20">{k}</span>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground italic">No negative keywords defined.</span>
                        )}
                      </div>
                    </div>

                    <div className="bg-surface rounded-xl border border-hairline p-5">
                      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-primary" />
                        Good Fit Examples
                      </h3>
                      <div className="flex flex-wrap gap-1.5">
                        {(rules?.goodFitExamples || []).length > 0 ? (
                          (rules?.goodFitExamples || []).map(ex => (
                            <span key={ex} className="rounded-md bg-primary/10 text-primary px-2 py-0.5 text-xs font-semibold border border-primary/20">{ex}</span>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground italic">No good fit examples defined.</span>
                        )}
                      </div>
                    </div>

                    <div className="bg-surface rounded-xl border border-hairline p-5">
                      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-amber-500" />
                        Bad Fit Examples
                      </h3>
                      <div className="flex flex-wrap gap-1.5">
                        {(rules?.badFitExamples || []).length > 0 ? (
                          (rules?.badFitExamples || []).map(ex => (
                            <span key={ex} className="rounded-md bg-amber-500/10 text-amber-600 px-2 py-0.5 text-xs font-semibold border border-amber-500/20">{ex}</span>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground italic">No bad fit examples defined.</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </TabsContent>
            
            <TabsContent value="notes">
              <div className="bg-secondary rounded-lg p-6 text-center text-muted-foreground border border-hairline">Notes Area</div>
            </TabsContent>
            
            <TabsContent value="activity">
              <div className="bg-secondary rounded-lg p-6 text-center text-muted-foreground border border-hairline">Activity Log Area</div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Right Sidebar */}
      <div className="w-full xl:w-[280px] shrink-0 space-y-6">
        <div className="bg-surface rounded-xl border border-hairline p-5 shadow-sm">
          <h3 className="font-semibold text-foreground mb-4">Version History</h3>
          <div className="space-y-0 relative before:absolute before:inset-0 before:ml-2 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-hairline before:to-transparent">
            {historyVersions.map((v, i) => (
              <div key={v.id} className="relative flex items-start gap-4 mb-4">
                <div className={`mt-1 w-2 h-2 rounded-full ring-4 ring-surface ${v.id === version.id ? 'bg-primary' : (v.status === 'PUBLISHED' ? 'bg-emerald-500' : 'bg-secondary')} z-10`}></div>
                <div className="flex-1 text-sm">
                  <Link href={`/v2/icp-library?icpVersionId=${v.id}`} className="font-medium text-foreground hover:text-primary transition-colors">
                    {v.status === 'DRAFT' ? 'Draft' : v.status === 'PUBLISHED' ? 'Published' : 'Archived'} v{v.versionNumber}
                    {v.id === version.id && <Badge variant="secondary" className="ml-2 text-[10px] py-0 h-4 bg-secondary">Current</Badge>}
                  </Link>
                  <div className="text-muted-foreground text-xs mt-1">
                    {v.publishedAt ? formatDate(v.publishedAt) : formatDate(v.createdAt)}
                  </div>
                  <div className="text-muted-foreground text-xs mt-0.5">
                    By {v.publishedByName || "User"}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <Button variant="link" className="text-primary text-xs p-0 h-auto mt-2">View all versions &gt;</Button>
        </div>

        <div className="bg-surface rounded-xl border border-hairline p-5 shadow-sm">
          <h3 className="font-semibold text-foreground mb-4">Approval Flow</h3>
          <div className="space-y-4 text-sm">
            <div className="flex items-center gap-3">
              <Avatar className="w-8 h-8"><AvatarFallback>{getInitials(version.publishedByName || "Creator")}</AvatarFallback></Avatar>
              <div className="flex-1">
                <div className="font-medium text-foreground">Created by</div>
                <div className="text-xs text-muted-foreground">{version.publishedByName || "Creator"}</div>
              </div>
              <CheckIcon className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="flex items-center gap-3">
              <Avatar className="w-8 h-8"><AvatarFallback>{getInitials(version.projectOwnerName || "Project Lead")}</AvatarFallback></Avatar>
              <div className="flex-1">
                <div className="font-medium text-foreground">Reviewed by</div>
                <div className="text-xs text-muted-foreground">{version.projectOwnerName || "Project Lead"}</div>
              </div>
              <CheckIcon className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="flex items-center gap-3 opacity-50">
              <Avatar className="w-8 h-8"><AvatarFallback>{getInitials(version.accountOwnerName || "Account Owner")}</AvatarFallback></Avatar>
              <div className="flex-1">
                <div className="font-medium text-foreground">Approved by</div>
                <div className="text-xs text-muted-foreground">{version.accountOwnerName || "Account Owner"}</div>
              </div>
              {isDraft ? (
                <ClockIcon className="w-4 h-4 text-muted-foreground" />
              ) : (
                <CheckIcon className="w-4 h-4 text-emerald-500" />
              )}
            </div>
          </div>
          <div className="mt-6 pt-4 border-t border-hairline">
            {isDraft ? (
              <Button className="w-full" onClick={onPublish} disabled={isAuthoringSubmitting} variant="default">
                <RocketIcon className="w-4 h-4 mr-2" /> Publish
              </Button>
            ) : (
              <Button className="w-full" disabled variant="outline">
                <LockIcon className="w-4 h-4 mr-2" /> Published
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function valueToJson(value: unknown) {
  return value ? JSON.stringify(value, null, 2) : "";
}

function getInitials(name: string) {
  if (!name) return "U";
  return name.split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase();
}

function LockIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
  );
}
