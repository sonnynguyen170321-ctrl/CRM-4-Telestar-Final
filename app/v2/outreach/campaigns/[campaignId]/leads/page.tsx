import Link from "next/link";
import { ChevronLeft, Users } from "lucide-react";

import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { CampaignNav } from "@/components/v2/outreach/CampaignNav";
import { CampaignStatusBadge } from "@/components/v2/outreach/CampaignStatusBadge";
import { CampaignLeadsManager } from "@/components/v2/outreach/CampaignLeadsManager";
import { queryCampaignDetail } from "@/lib/v2/outreach/campaigns/queryCampaigns";
import { queryCampaignEnrollments } from "@/lib/v2/outreach/campaigns/queryCampaignEnrollments";
import {
  getTenantErrorMessage,
  hasPermission,
  requirePermission,
  V2TenantError,
} from "@/lib/v2/tenant";

type PageProps = {
  params: Promise<{ campaignId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CampaignLeadsPage({ params, searchParams }: PageProps) {
  const { campaignId } = await params;
  const raw = await searchParams;
  const tenantContext = await getContext();

  if (tenantContext instanceof V2TenantError) {
    return <Denied error={tenantContext} />;
  }

  const search = getParam(raw, "search") ?? "";
  const status = getParam(raw, "status") ?? "";
  const page = parsePositiveInt(getParam(raw, "page"), 1);

  const [campaign, enrollments] = await Promise.all([
    queryCampaignDetail(tenantContext.organizationId, campaignId),
    queryCampaignEnrollments(tenantContext.organizationId, campaignId, { search, status, page, pageSize: 50 }),
  ]);

  if (!campaign) {
    return (
      <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0">
        <main className="space-y-5 px-6 py-5">
          <CampaignNav active="campaigns" />
          <div className="rounded-lg border border-dashed border-border bg-white p-8 text-center text-sm text-muted-foreground">
            Campaign not found.
            <div className="mt-3">
              <Link href="/v2/outreach/campaigns" className="font-medium text-primary hover:underline">Back to campaigns</Link>
            </div>
          </div>
        </main>
      </WorkspaceFrame>
    );
  }

  const isAdmin = hasPermission(tenantContext.role, "outreach.admin");

  return (
    <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0">
      <main className="space-y-5 px-6 py-5">
        <CampaignNav active="campaigns" />

        <Link href={`/v2/outreach/campaigns/${campaignId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Back to campaign
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              <h1 className="truncate text-xl font-semibold text-foreground">{campaign.name}</h1>
              <CampaignStatusBadge status={campaign.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage the leads enrolled in this campaign — pause, resume, or remove individual leads.
            </p>
          </div>
        </div>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="Enrolled" value={campaign.enrolledCount} tone="slate" />
          <Metric label="Active" value={enrollments.facets.ACTIVE} tone="emerald" />
          <Metric label="Paused" value={enrollments.facets.PAUSED} tone="amber" />
          <Metric label="Replied" value={campaign.repliedCount} tone="blue" />
        </section>

        <CampaignLeadsManager
          campaignId={campaignId}
          result={enrollments}
          status={status}
          search={search}
          isAdmin={isAdmin}
        />
      </main>
    </WorkspaceFrame>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: "slate" | "emerald" | "amber" | "blue" }) {
  const color = { slate: "text-foreground", emerald: "text-emerald-700", amber: "text-amber-700", blue: "text-primary" }[tone];
  return (
    <div className="rounded-xl border border-border bg-white p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-bold tracking-tight ${color}`}>{value.toLocaleString()}</div>
    </div>
  );
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
    <WorkspaceFrame className="flex items-center justify-center">
      <div className="max-w-xl rounded-lg border border-border bg-white p-6 text-center">
        <div className="text-sm font-semibold text-foreground">{message.title}</div>
        <p className="mt-2 text-sm text-muted-foreground">{message.message}</p>
      </div>
    </WorkspaceFrame>
  );
}

function getParam(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  const first = Array.isArray(value) ? value[0] : value;
  return first && first.trim() ? first.trim() : undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
