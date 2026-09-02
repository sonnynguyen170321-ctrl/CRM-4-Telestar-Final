import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/shared/PageHeader";
import { PanelCard } from "@/components/shared/PanelCard";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import {
  CampaignTabbedWorkspace,
  parseCampaignTab,
} from "@/components/v2/outreach/CampaignTabbedWorkspace";
import { CampaignRowMenu } from "@/components/v2/outreach/CampaignRowMenu";
import { CampaignStatusBadge } from "@/components/v2/outreach/CampaignStatusBadge";
import { queryWorkerHealth } from "@/lib/v2/jobs/queryWorkerHealth";
import { queryCampaignDetail } from "@/lib/v2/outreach/campaigns/queryCampaigns";
import {
  parseCampaignSource,
  queryCampaignWizardLeads,
} from "@/lib/v2/outreach/campaigns/queryCampaignWizardLeads";
import {
  getTenantErrorMessage,
  hasPermission,
  requirePermission,
  V2TenantError,
} from "@/lib/v2/tenant";

export const dynamic = "force-dynamic";

export default async function V2CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ campaignId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await getContext();
  if (context instanceof V2TenantError) {
    return <TenantDeniedState error={context} />;
  }

  const { campaignId } = await params;
  const sp = await searchParams;
  const campaign = await queryCampaignDetail(context.organizationId, campaignId);
  if (!campaign) notFound();

  const workerHealth = await queryWorkerHealth();
  const isAdmin = hasPermission(context.role, "outreach.admin");
  const leadSource = parseCampaignSource(sp);
  const wizardLeads =
    isAdmin && campaign.status === "DRAFT"
      ? await queryCampaignWizardLeads(context.organizationId, campaignId, leadSource)
      : [];
  const tab = parseCampaignTab(typeof sp.tab === "string" ? sp.tab : undefined);
  const status = typeof sp.status === "string" ? sp.status : "";
  const search = typeof sp.search === "string" ? sp.search : "";
  const page = parsePositiveInt(typeof sp.page === "string" ? sp.page : undefined, 1);
  const notice = typeof sp.notice === "string" ? sp.notice : undefined;
  const noticeErrors = Array.isArray(sp.error)
    ? sp.error
    : typeof sp.error === "string"
      ? [sp.error]
      : [];

  return (
    <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0">
      <PageHeader
        eyebrow="Campaign workspace"
        title={campaign.name}
        description={campaign.description || "Tabbed V2 outreach campaign detail and launch workspace."}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <CampaignStatusBadge status={campaign.status} />
            <Link
              href="/v2/outreach/campaigns"
              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-semibold text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary/20"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Campaigns
            </Link>
            {isAdmin ? <CampaignRowMenu campaignId={campaign.id} name={campaign.name} status={campaign.status} /> : null}
          </div>
        }
      />
      <div className="space-y-5 px-4 pb-6 sm:px-6 lg:px-8">
        {notice ? <NoticeBanner notice={notice} errors={noticeErrors} /> : null}
        <CampaignTabbedWorkspace
          organizationId={context.organizationId}
          campaign={campaign}
          workerHealth={workerHealth}
          wizardLeads={wizardLeads}
          isAdmin={isAdmin}
          tab={tab}
          status={status}
          search={search}
          page={page}
          leadSource={leadSource}
        />
      </div>
    </WorkspaceFrame>
  );
}

function NoticeBanner({ notice, errors }: { notice: string; errors: string[] }) {
  const isError = errors.length > 0 || notice.includes("blocked") || notice.includes("invalid") || notice.includes("required");
  return (
    <div
      className={
        isError
          ? "rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
          : "rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
      }
    >
      <div className="font-semibold">{notice.replace(/-/g, " ")}</div>
      {errors.length > 0 ? (
        <ul className="mt-1 list-disc pl-5">
          {errors.slice(0, 8).map((error, i) => (
            <li key={i}>{error}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TenantDeniedState({ error }: { error: V2TenantError }) {
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

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function getContext() {
  try {
    return await requirePermission("crm.read");
  } catch (error) {
    if (error instanceof V2TenantError) return error;
    throw error;
  }
}