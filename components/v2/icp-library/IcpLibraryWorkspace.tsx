"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDownIcon, PlusIcon } from "lucide-react";

import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import type { V2IcpLibraryResult, V2IcpLibraryVersion } from "@/lib/v2/icp";
import { OfferListRow } from "@/lib/v2/product-tree/types";
import { createEmptyIcpAction } from "@/app/v2/icp-library/actions";
import { ICP_TEMPLATES_V2 } from "@/lib/v2/scoring/rules/icpTemplatesV2";

import { IcpVersionDetail } from "./IcpVersionDetail";

type IcpLibraryWorkspaceProps = {
  result: V2IcpLibraryResult;
  selectedIcpVersionId?: string;
  offers?: OfferListRow[];
  defaultOfferId?: string;
  defaultCreateOpen?: boolean;
};

export function IcpLibraryWorkspace({
  result,
  selectedIcpVersionId,
  offers = [],
  defaultOfferId,
  defaultCreateOpen = false,
}: IcpLibraryWorkspaceProps) {
  const router = useRouter();
  const [isCreateOpen, setIsCreateOpen] = React.useState(defaultCreateOpen);
  const [error, setError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const res = await createEmptyIcpAction(formData);

    setIsSubmitting(false);

    if (res.error) {
      setError(res.error);
    } else {
      setIsCreateOpen(false);
      if (res.versionId) {
        const selectedOfferId = formData.get("offerId")?.toString();
        const offer = offers.find(o => o.id === selectedOfferId);
        if (offer) {
          router.push(`/v2/icp-library?icpVersionId=${res.versionId}&projectId=${offer.projectId}&clientAccountId=${offer.accountId}`);
        } else {
          router.push(`/v2/icp-library?icpVersionId=${res.versionId}`);
        }
      }
    }
  }

  // Group versions by account and find the latest version for each profile for the sidebar
  const groupedAccounts = React.useMemo(() => {
    const latestProfiles = new Map<string, V2IcpLibraryVersion>();
    for (const v of result.versions) {
      if (!latestProfiles.has(v.icpProfileId)) {
        latestProfiles.set(v.icpProfileId, v);
      }
    }

    const accounts = new Map<string, { accountName: string; profiles: V2IcpLibraryVersion[] }>();
    for (const v of latestProfiles.values()) {
      if (!accounts.has(v.clientAccountId)) {
        accounts.set(v.clientAccountId, { accountName: v.clientAccountName, profiles: [] });
      }
      accounts.get(v.clientAccountId)!.profiles.push(v);
    }
    return Array.from(accounts.values());
  }, [result.versions]);

  const selectedVersion = result.selectedVersion;
  
  // Get history versions for the selected profile
  const historyVersions = React.useMemo(() => {
    if (!selectedVersion) return [];
    return result.versions.filter(v => v.icpProfileId === selectedVersion.icpProfileId);
  }, [result.versions, selectedVersion]);

  return (
    <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0 bg-transparent">
      <div className="flex h-full">
        {/* Left Sidebar */}
        <aside className="w-[280px] shrink-0 border-r border-hairline bg-surface/50 backdrop-blur-2xl flex flex-col h-[calc(100vh-60px)]">
          <div className="p-4">
            <h2 className="text-lg font-semibold text-foreground mb-4">ICP Library</h2>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input placeholder="Search ICPs..." className="h-8 pl-8 text-xs bg-surface" />
                <svg className="w-4 h-4 absolute left-2.5 top-2 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 px-2 text-primary border-primary/20 bg-primary/5 hover:bg-primary/10">
                    <PlusIcon className="w-4 h-4" /> New ICP
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[425px]">
                  <form onSubmit={onSubmit}>
                    <DialogHeader>
                      <DialogTitle>Create New ICP</DialogTitle>
                      <DialogDescription>
                        Create a new ICP profile to define your target customers.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      {error && (
                        <div className="text-sm font-medium text-destructive">
                          {error}
                        </div>
                      )}
                      <div className="grid gap-2">
                        <label htmlFor="offerId" className="text-sm font-medium">Offer</label>
                        <Select name="offerId" defaultValue={defaultOfferId || (offers.length === 1 ? offers[0].id : undefined)} required>
                          <SelectTrigger><SelectValue placeholder="Select an offer" /></SelectTrigger>
                          <SelectContent>
                            {offers.map(offer => (
                              <SelectItem key={offer.id} value={offer.id}>
                                {offer.name} ({offer.accountName} / {offer.projectName})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <label htmlFor="templateId" className="text-sm font-medium">Start from template (optional)</label>
                        <Select name="templateId" defaultValue="">
                          <SelectTrigger><SelectValue placeholder="Empty ICP" /></SelectTrigger>
                          <SelectContent>
                            {ICP_TEMPLATES_V2.map((t) => (
                              <SelectItem key={t.id} value={t.id}>{t.name} — {t.description}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <label htmlFor="name" className="text-sm font-medium">ICP Name</label>
                        <Input id="name" name="name" placeholder="e.g. Enterprise Retailers" required />
                      </div>
                      <div className="grid gap-2">
                        <label htmlFor="description" className="text-sm font-medium">Description (Optional)</label>
                        <Input id="description" name="description" placeholder="Briefly describe this ICP" />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                      <Button type="submit" disabled={isSubmitting || offers.length === 0}>
                        {isSubmitting ? "Creating..." : "Create ICP"}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-4">
            {groupedAccounts.map((account) => (
              <div key={account.accountName}>
                <div className="flex items-center gap-2 px-2 py-1.5 font-medium text-xs text-foreground cursor-pointer hover:bg-surface-raised rounded-md">
                  <ChevronDownIcon className="w-4 h-4" />
                  {account.accountName} <span className="text-muted-foreground font-normal">({account.profiles.length})</span>
                </div>
                <div className="space-y-0.5 mt-1">
                  {account.profiles.map(profile => {
                    const isSelected = selectedVersion?.icpProfileId === profile.icpProfileId;
                    return (
                      <Link
                        key={profile.id}
                        href={`/v2/icp-library?icpVersionId=${profile.id}`}
                        className={`flex items-center justify-between gap-2 px-6 py-2 rounded-md text-xs transition-colors ${
                          isSelected ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground hover:bg-surface-raised hover:text-foreground"
                        }`}
                      >
                        <span className="truncate">{profile.icpProfileName}</span>
                        <Badge variant="outline" className={`text-[9px] py-0 h-4 ${profile.status === 'PUBLISHED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : profile.status === 'ARCHIVED' ? 'bg-muted text-muted-foreground' : 'bg-muted text-foreground'}`}>
                          {profile.status}
                        </Badge>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
            
            <div className="mt-8 px-4">
              <div className="rounded-lg bg-primary/5 border border-primary/10 p-3 flex gap-2 text-xs text-primary">
                <svg className="w-4 h-4 shrink-0 mt-0.5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <p>SDRs can use published ICPs only.</p>
                  <p>Team Lead/Manager can draft and publish ICPs.</p>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 min-w-0 overflow-y-auto p-6">
          {selectedVersion ? (
            <IcpVersionDetail
              key={selectedVersion.id}
              version={selectedVersion}
              historyVersions={historyVersions}
            />
          ) : (
            <div className="rounded-lg border border-dashed border-hairline bg-surface p-8 text-center mt-10 max-w-lg mx-auto shadow-sm">
              <div className="text-sm font-medium text-foreground">
                No ICP version selected
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Select an ICP version from the list or create a new one.
              </p>
            </div>
          )}
        </main>
      </div>
    </WorkspaceFrame>
  );
}
