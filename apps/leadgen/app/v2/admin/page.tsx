import { ShieldCheck, Check, Building2 } from "lucide-react";

import { PageHeader } from "@/components/shared/PageHeader";
import { PanelCard } from "@/components/shared/PanelCard";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { getTenantErrorMessage, requirePermission, V2TenantError } from "@/lib/v2/tenant";
import { V2_PERMISSION_ROLE_POLICY } from "@/lib/v2/tenant/permissions";
import { prisma } from "@/lib/server/prisma";

const ROLE_ORDER = ["OWNER", "ADMIN", "MANAGER", "TEAM_LEAD", "SDR", "VIEWER"];

type MemberRow = {
  id: string;
  role: string;
  status: string;
  createdAt: Date | string;
  userName: string | null;
  email: string;
};

export default async function V2AdminPage() {
  const context = await getContext();
  if (context instanceof V2TenantError) {
    const msg = getTenantErrorMessage(context);
    return (
      <WorkspaceFrame>
        <div className="max-w-xl rounded-lg border border-border bg-card p-6">
          <div className="text-sm font-semibold text-foreground">{msg.title}</div>
          <p className="mt-2 text-sm text-muted-foreground">{msg.message}</p>
        </div>
      </WorkspaceFrame>
    );
  }

  const members = await loadMembers(context.organizationId);
  const permissions = Object.keys(V2_PERMISSION_ROLE_POLICY) as Array<keyof typeof V2_PERMISSION_ROLE_POLICY>;

  const memberColumns: DataTableColumn<MemberRow>[] = [
    {
      key: "member",
      header: "Member",
      cell: (member) => (
        <div>
          <div className="font-semibold text-foreground">{member.userName ?? member.email}</div>
          <div className="text-xs text-muted-foreground">{member.email}</div>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      cell: (member) => (
        <span className="inline-flex rounded-full border border-hairline bg-secondary px-2 py-0.5 text-xs font-semibold text-muted-foreground">
          {member.role}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (member) => (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold border ${member.status === "ACTIVE" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" : "bg-secondary text-muted-foreground border-hairline"}`}>
          {member.status}
        </span>
      ),
    },
    {
      key: "joined",
      header: "Joined",
      cell: (member) => <span className="text-muted-foreground">{new Date(member.createdAt).toLocaleDateString()}</span>,
    },
  ];

  return (
    <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0">
      <PageHeader
        title="Admin"
        description="Organization, members, and the role \u2192 permission policy. Read-only in this view."
      />

      <div className="space-y-5 p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <PanelCard title="Organization" contentClassName="p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20">
                <Building2 className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-foreground">{context.organizationName}</div>
                <div className="text-xs text-muted-foreground">{members.length} member{members.length === 1 ? "" : "s"}</div>
              </div>
            </div>
          </PanelCard>
          <PanelCard title="Your access" contentClassName="p-4">
            <div className="text-sm font-semibold text-foreground">
              {context.userName ?? context.emailNormalized}
            </div>
            <div className="mt-1">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                <ShieldCheck className="h-3.5 w-3.5" />
                {context.role}
              </span>
            </div>
          </PanelCard>
          <PanelCard title="Roles" contentClassName="p-4">
            <div className="flex flex-wrap gap-1.5">
              {ROLE_ORDER.map((role) => (
                <span key={role} className="rounded-full border border-hairline bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {role}
                </span>
              ))}
            </div>
          </PanelCard>
        </div>

        <PanelCard title="Members" contentClassName="p-0">
          <DataTable
            columns={memberColumns}
            rows={members}
            getRowId={(member) => member.id}
            minWidth="min-w-[520px]"
            empty={
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                No members found for this organization.
              </div>
            }
            className="border-none shadow-none rounded-none"
          />
        </PanelCard>

        <PanelCard title="Role → permission policy" contentClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-hairline text-xs uppercase tracking-wide text-muted-foreground bg-surface-raised/30">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Permission</th>
                  {ROLE_ORDER.map((role) => (
                    <th key={role} className="px-3 py-2.5 text-center font-medium">{role}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline bg-surface">
                {permissions.map((permission) => (
                  <tr key={permission} className="hover:bg-surface-raised transition-colors">
                    <td className="px-4 py-2.5 font-semibold text-foreground">{permission}</td>
                    {ROLE_ORDER.map((role) => {
                      const allowed = (V2_PERMISSION_ROLE_POLICY[permission] as string[]).includes(role);
                      return (
                        <td key={role} className="px-3 py-2.5 text-center">
                          {allowed ? (
                            <Check className="mx-auto h-4 w-4 text-emerald-600 font-bold" aria-label="allowed" />
                          ) : (
                            <span className="text-muted-foreground/30" aria-label="not allowed">·</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PanelCard>
      </div>
    </WorkspaceFrame>
  );
}

async function loadMembers(organizationId: string): Promise<MemberRow[]> {
  return prisma.$queryRawUnsafe<MemberRow[]>(
    `
      SELECT
        m."id",
        m."role"::text AS "role",
        m."status"::text AS "status",
        m."createdAt",
        u."name" AS "userName",
        u."emailNormalized" AS "email"
      FROM "V2OrganizationMembership" m
      INNER JOIN "V2User" u ON u."id" = m."userId"
      WHERE m."organizationId" = $1
      ORDER BY m."createdAt" ASC
    `,
    organizationId
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
