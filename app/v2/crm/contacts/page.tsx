import { Users } from "lucide-react";

import { PageHeader } from "@/components/shared/PageHeader";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { CrmNav } from "@/components/v2/shell/WorkspaceClusterNav";
import { ContactDrawer } from "@/components/v2/contacts/ContactDrawer";
import { ContactWorkspaceTable } from "@/components/v2/contacts/ContactWorkspaceTable";
import { ContactBulkActionBar } from "@/components/v2/contacts/ContactBulkActionBar";
import { ContactFilterPanel } from "@/components/v2/contacts/ContactFilterPanel";
import { LeadSelectionProvider } from "@/components/v2/leads/LeadSelection";
import {
  getContactDetail,
  queryContacts,
  type TriState,
} from "@/lib/v2/crm/queryContacts";
import { getLeadContextOptions } from "@/lib/v2/crm";
import { queryContactFilterSuggestions } from "@/lib/v2/crm/contactFilterSuggestions";
import { queryCampaigns } from "@/lib/v2/outreach/campaigns/queryCampaigns";
import {
  getTenantErrorMessage,
  hasPermission,
  requirePermission,
  V2TenantError,
} from "@/lib/v2/tenant";

type ContactsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function V2ContactsPage({ searchParams }: ContactsPageProps) {
  const rawParams = await searchParams;
  const context = await getContactsContext();

  if (context instanceof V2TenantError) {
    return <TenantDeniedState error={context} />;
  }

  const query = toQueryRecord(rawParams);
  const canOverride = hasPermission(context.role, "workflow.update");
  const canAssign = hasPermission(context.role, "lead.assign");
  const selectedContactId = getParam(rawParams, "contactId");
  const page = parsePositiveInt(getParam(rawParams, "page"), 1);
  const triOf = (key: string): TriState | undefined => {
    const value = getParam(rawParams, key);
    return value === "yes" || value === "no" ? value : undefined;
  };

  const [workspace, detail, campaigns, contextOptions, suggestions] = await Promise.all([
    queryContacts(context.organizationId, {
      search: getParam(rawParams, "search"),
      title: getArrayParam(rawParams, "title"),
      notTitle: getArrayParam(rawParams, "notTitle"),
      country: getArrayParam(rawParams, "country"),
      notCountry: getArrayParam(rawParams, "notCountry"),
      company: getArrayParam(rawParams, "company"),
      notCompany: getArrayParam(rawParams, "notCompany"),
      industry: getArrayParam(rawParams, "industry"),
      notIndustry: getArrayParam(rawParams, "notIndustry"),
      department: getArrayParam(rawParams, "department"),
      notDepartment: getArrayParam(rawParams, "notDepartment"),
      seniority: getArrayParam(rawParams, "seniority"),
      notSeniority: getArrayParam(rawParams, "notSeniority"),
      icpVersionId: getArrayParam(rawParams, "icpVersionId"),
      notIcpVersionId: getArrayParam(rawParams, "notIcpVersionId"),
      qualification: getArrayParam(rawParams, "qualification"),
      notQualification: getArrayParam(rawParams, "notQualification"),
      hasEmail: triOf("hasEmail"),
      hasPhone: triOf("hasPhone"),
      hasLinkedin: triOf("hasLinkedin"),
      page,
      pageSize: 50,
    }),
    selectedContactId
      ? getContactDetail(context.organizationId, selectedContactId)
      : Promise.resolve(null),
    queryCampaigns(context.organizationId),
    getLeadContextOptions({ organizationId: context.organizationId }),
    queryContactFilterSuggestions(context.organizationId),
  ]);
  // Flat published-ICP options (account · project · profile vN) for the context filter.
  const icpVersionOptions = contextOptions.accounts.flatMap((account) =>
    account.projects.flatMap((project) =>
      project.icpVersions
        .filter((version) => version.status === "PUBLISHED")
        .map((version) => ({
          id: version.id,
          label: `${account.name} · ${project.name} · ${version.icpProfileName} v${version.versionNumber}`,
        }))
    )
  );

  return (
    <WorkspaceFrame className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden bg-background p-0">
      <PageHeader
        title="Contacts"
        description="The people layer. A contact is the person; actions target their primary ICP assignment (Project + ICP + owner)."
        actions={
          <span className="inline-flex items-center gap-2 rounded-md bg-surface border border-hairline px-3 py-1.5 text-sm font-semibold text-muted-foreground shadow-sm">
            <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {workspace.pagination?.total.toLocaleString() ?? workspace.facets.total} contacts
          </span>
        }
      />
      <div className="shrink-0 border-b border-hairline px-4 py-2.5"><CrmNav /></div>

      <LeadSelectionProvider>
        <div className="relative flex min-h-0 flex-1 overflow-hidden border-t border-hairline bg-background/20">
          <ContactFilterPanel 
            icpVersions={icpVersionOptions} 
            query={query} 
            suggestions={suggestions}
            facets={workspace.facets}
            canAssign={canAssign}
          />

          <div className="min-w-0 flex-1 overflow-auto bg-surface">
            <ContactWorkspaceTable
              workspace={workspace}
              query={query}
              selectedContactId={selectedContactId}
              campaigns={campaigns.map((c) => ({ id: c.id, name: c.name, status: c.status }))}
              assignableMembers={suggestions.owners}
              canAssign={canAssign}
            />
          </div>
        </div>
        <ContactBulkActionBar accounts={contextOptions.accounts} assignableMembers={suggestions.owners} canAssign={canAssign} />
      </LeadSelectionProvider>

      <ContactDrawer 
        detail={detail} 
        query={query} 
        canOverride={canOverride}
        canAssign={canAssign}
        assignableMembers={suggestions.owners} 
      />
    </WorkspaceFrame>
  );
}

async function getContactsContext() {
  try {
    return await requirePermission("crm.read");
  } catch (error) {
    if (error instanceof V2TenantError) {
      return error;
    }
    throw error;
  }
}

function TenantDeniedState({ error }: { error: V2TenantError }) {
  const msg = getTenantErrorMessage(error);
  return (
    <WorkspaceFrame>
      <div className="max-w-xl rounded-xl border border-hairline bg-surface p-6 shadow-premium">
        <div className="text-sm font-bold text-foreground">{msg.title}</div>
        <p className="mt-2 text-sm text-muted-foreground">{msg.message}</p>
      </div>
    </WorkspaceFrame>
  );
}

function getParam(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  const first = Array.isArray(value) ? value[0] : value;
  return first && first.trim() ? first.trim() : undefined;
}

function getArrayParam(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  if (!value) return undefined;
  if (Array.isArray(value)) return value;
  return [value];
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function toQueryRecord(params: Record<string, string | string[] | undefined>) {
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key === "organizationId") continue;
    if (Array.isArray(value)) {
      const valid = value.map((v) => v.trim()).filter(Boolean);
      if (valid.length > 0) query[key] = valid;
    } else if (value && value.trim()) {
      query[key] = value.trim();
    }
  }
  return query;
}
