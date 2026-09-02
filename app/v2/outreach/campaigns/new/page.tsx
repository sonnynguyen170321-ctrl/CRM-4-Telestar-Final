import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Megaphone, ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/shared/PageHeader";
import { PanelCard } from "@/components/shared/PanelCard";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { prisma } from "@/lib/server/prisma";
import { createSequence, type SequenceAuthorDb } from "@/lib/v2/outreach/sequences/authorSequence";
import {
  getTenantErrorMessage,
  requirePermission,
  V2TenantError,
} from "@/lib/v2/tenant";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function createCampaignAction(formData: FormData) {
  "use server";
  const context = await requirePermission("outreach.admin");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const created = await createSequence(prisma as unknown as SequenceAuthorDb, {
    organizationId: context.organizationId,
    createdByUserId: context.userId,
    name,
    description: String(formData.get("description") ?? "").trim() || null,
  });
  const params = new URLSearchParams({ tab: "editor", notice: "campaign-created" });
  for (const key of ["source", "leadIds", "projectId", "icpVersionId", "clientAccountId", "ownerUserId"]) {
    const value = String(formData.get(key) ?? "").trim();
    if (value) params.set(key, value);
  }
  redirect(`/v2/outreach/campaigns/${created.id}?${params.toString()}`);
}

export default async function NewCampaignPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const context = await getContext();
  if (context instanceof V2TenantError) {
    return <Denied error={context} />;
  }

  const seed = {
    source: getParam(raw, "source") ?? "",
    leadIds: getParam(raw, "leadIds") ?? "",
    projectId: getParam(raw, "projectId") ?? "",
    icpVersionId: getParam(raw, "icpVersionId") ?? "",
    clientAccountId: getParam(raw, "clientAccountId") ?? "",
    ownerUserId: getParam(raw, "ownerUserId") ?? "",
  };
  const selectedCount = seed.leadIds ? seed.leadIds.split(",").filter(Boolean).length : 0;

  return (
    <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0">
      <PageHeader
        eyebrow="Outreach operations"
        title="New campaign"
        description="Create a draft campaign, then add steps, sender pool, schedule, and launch-ready contacts."
      />
      <main className="space-y-5 p-5 sm:p-6">
        <Link
          href="/v2/outreach/campaigns"
          className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/20"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          All campaigns
        </Link>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,560px)_minmax(280px,1fr)]">
          <PanelCard
            title="Campaign setup"
            description="The campaign starts as a draft. Nothing sends until launch readiness and live-send gates pass."
          >
            <form action={createCampaignAction} className="space-y-4">
              {Object.entries(seed).map(([key, value]) => (
                value ? <input key={key} type="hidden" name={key} value={value} /> : null
              ))}
              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">Campaign name</span>
                <input
                  name="name"
                  required
                  autoFocus
                  placeholder="Finance Leaders Roundtable"
                  className="h-11 rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">Description</span>
                <textarea
                  name="description"
                  rows={5}
                  placeholder="Audience, offer, and launch notes"
                  className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                />
              </label>
              <button
                type="submit"
                className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white outline-none hover:bg-primary focus-visible:ring-2 focus-visible:ring-primary/20"
              >
                <Megaphone className="h-4 w-4" aria-hidden="true" />
                Create campaign
              </button>
            </form>
          </PanelCard>

          <PanelCard title="Launch gates" contentClassName="space-y-3">
            <Gate label="Source preserved" value={sourceLabel(seed.source, selectedCount)} />
            <Gate label="Live send" value="Requires verified sender, credential key, kill switch off, worker health, and suppression." />
            <Gate label="Unit" value="Enrollments stay LeadAssignment-scoped; no company-global outreach state." />
          </PanelCard>
        </div>
      </main>
    </WorkspaceFrame>
  );
}

function Gate({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 rounded-md border border-border bg-muted/40 p-3">
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
      <div>
        <div className="text-sm font-semibold text-foreground">{label}</div>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{value}</p>
      </div>
    </div>
  );
}

function sourceLabel(source: string, selectedCount: number) {
  if (source === "selected") return `${selectedCount} selected lead${selectedCount === 1 ? "" : "s"}`;
  if (source === "filter") return "Lead workspace filter";
  return "Recent eligible leads";
}

function getParam(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  const first = Array.isArray(value) ? value[0] : value;
  return first && first.trim() ? first.trim() : undefined;
}

async function getContext() {
  try {
    return await requirePermission("crm.read");
  } catch (error) {
    if (error instanceof V2TenantError) return error;
    throw error;
  }
}

function Denied({ error }: { error: V2TenantError }) {
  const message = getTenantErrorMessage(error);
  return (
    <WorkspaceFrame>
      <PanelCard className="max-w-xl">
        <h1 className="text-base font-semibold text-foreground">{message.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message.message}</p>
      </PanelCard>
    </WorkspaceFrame>
  );
}
