import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, Building2, ExternalLink, Users, UserPlus, Search } from "lucide-react";

import { PageHeader } from "@/components/shared/PageHeader";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { Button } from "@/components/ui/button";
import { getCompanyDetail } from "@/lib/v2/company-intelligence/readModel";
import { requirePermission } from "@/lib/v2/tenant";

type NewContactPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NewContactPage({ searchParams }: NewContactPageProps) {
  const rawParams = await searchParams;
  const companyId = getParam(rawParams, "companyId");
  const context = await requirePermission("crm.read");

  if (!companyId) {
    return (
      <WorkspaceFrame>
        <PageHeader
          eyebrow="Contacts"
          title="Find or Add Contact"
          description="Select a company to find or add a contact."
        />
        <div className="flex flex-1 items-center justify-center p-12">
          <div className="max-w-md text-center">
            <UserPlus className="mx-auto h-12 w-12 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold text-foreground">No company selected</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              To find or add a contact, first select a company from the company directory.
            </p>
            <Button asChild className="mt-6">
              <Link href="/v2/crm/companies">
                <Building2 className="mr-2 h-4 w-4" />
                Browse companies
              </Link>
            </Button>
          </div>
        </div>
      </WorkspaceFrame>
    );
  }

  return (
    <WorkspaceFrame>
      <PageHeader
        eyebrow="Contacts"
        title="Find or Add Contact"
        description="View existing contacts for this company or add a new one."
        actions={
          <Button asChild variant="outline" className="shadow-sm">
            <Link href={`/v2/crm/companies?companyId=${encodeURIComponent(companyId)}`}>
              <Building2 className="mr-2 h-4 w-4" />
              Company details
            </Link>
          </Button>
        }
      />
      <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading company info...</div>}>
        <CompanyContactsPage companyId={companyId} organizationId={context.organizationId} />
      </Suspense>
    </WorkspaceFrame>
  );
}

async function CompanyContactsPage({ companyId, organizationId }: { companyId: string; organizationId: string }) {
  const company = await getCompanyDetail({ organizationId, companyId });

  if (!company) {
    return (
      <div className="flex flex-1 items-center justify-center p-12">
        <div className="max-w-md text-center">
          <h2 className="text-lg font-semibold text-foreground">Company not found</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            The company you are looking for could not be found or may have been deleted.
          </p>
          <Button asChild className="mt-6" variant="outline">
            <Link href="/v2/crm/companies">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to companies
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const c = company.company;
  const leads = company.crossIcp.rows ?? [];
  const totalLeads = company.crossIcp.pagination.total ?? leads.length;

  return (
    <div className="flex flex-1 flex-col overflow-auto p-6">
      <div className="mb-6 rounded-xl border border-border bg-gradient-to-br from-muted to-white p-5 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-accent text-primary">
            <Building2 className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold text-foreground">{c.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {c.canonicalDomain && (
                <span className="inline-flex items-center gap-1">{c.canonicalDomain}</span>
              )}
              {c.country && (
                <span className="inline-flex items-center gap-1">{c.country}</span>
              )}
              <span className="inline-flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                {totalLeads} lead{totalLeads !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="outline" className="shadow-sm">
              <Link href={`/v2/crm/contacts?company=${encodeURIComponent(c.name ?? "")}`}>
                <Search className="mr-1.5 h-3.5 w-3.5" />
                All contacts
              </Link>
            </Button>
            <Button asChild size="sm" className="bg-primary text-white hover:bg-primary shadow-sm">
              <Link href={`/v2/crm/companies?companyId=${encodeURIComponent(companyId)}`}>
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                Manage contacts
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
        Lead Assignments ({leads.length})
      </h3>
      <div className="space-y-2">
        {leads.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No lead assignments yet. Add leads from the company page.
          </div>
        ) : (
          leads.slice(0, 20).map((lead: { leadAssignmentId?: string; projectName?: string; icpProfileName?: string; icpVersionNumber?: number; qualification?: string; workflowStatus?: string }) => (
            <Link
              key={lead.leadAssignmentId}
              href={`/v2/workspace/leads?selectedLeadId=${lead.leadAssignmentId}`}
              className="flex items-center justify-between rounded-lg border border-border bg-white p-3 shadow-sm transition-all hover:border-primary/20 hover:shadow-md"
            >
              <div>
                <div className="text-sm font-semibold text-foreground">{lead.projectName ?? "Unknown project"}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {lead.icpProfileName} v{lead.icpVersionNumber}
                  {lead.qualification ? ` · ${lead.qualification}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {lead.qualification && (
                  <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                    {lead.qualification}
                  </span>
                )}
                <ExternalLink className="h-4 w-4 text-muted-foreground" />
              </div>
            </Link>
          ))
        )}
      </div>

      <div className="mt-8 border-t border-border pt-6">
        <p className="text-sm text-muted-foreground">
          Contact creation and management is available through the company drawer. Use the 
          {" "}<Link href={`/v2/crm/companies?companyId=${encodeURIComponent(companyId)}`} className="font-semibold text-primary hover:text-primary">Manage contacts</Link>{" "}
          link above to add or edit contacts for this company.
        </p>
      </div>
    </div>
  );
}

function getParam(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  const first = Array.isArray(value) ? value[0] : value;
  return first && first.trim() ? first.trim() : undefined;
}
