import Link from "next/link";
import { revalidatePath } from "next/cache";
import { ArrowLeft, UserCheck, Users, Inbox } from "lucide-react";

import { PageHeader } from "@/components/shared/PageHeader";
import { PanelCard } from "@/components/shared/PanelCard";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { prisma } from "@/lib/server/prisma";
import {
  assignLead,
  type AssignLeadDb,
  queryAssignedLeads,
  queryAssignableMembers,
  type AssignedLead,
  type AssignableMember,
} from "@/lib/v2/crm";
import {
  getTenantErrorMessage,
  hasPermission,
  requirePermission,
  V2TenantError,
} from "@/lib/v2/tenant";

export const dynamic = "force-dynamic";

// M1 lead-ownership queues (SEE-IT). My leads / Unassigned / Team views over
// LeadAssignment (Invariant 2), with a manager/lead assign control (lead.assign).
// Ownership is shown next to — never merged into — workflow/qualification (Inv 3).

type Scope = "mine" | "unassigned" | "all";

const SCOPES: { key: Scope; label: string; icon: typeof Inbox }[] = [
  { key: "mine", label: "My leads", icon: UserCheck },
  { key: "unassigned", label: "Unassigned", icon: Inbox },
  { key: "all", label: "Team", icon: Users },
];

async function assignLeadAction(formData: FormData) {
  "use server";
  let context;
  try {
    context = await requirePermission("lead.assign");
  } catch {
    return;
  }
  const leadAssignmentId = (formData.get("leadAssignmentId")?.toString() ?? "").trim();
  const ownerRaw = (formData.get("ownerUserId")?.toString() ?? "").trim();
  if (!leadAssignmentId) return;

  await assignLead(prisma as unknown as AssignLeadDb, {
    organizationId: context.organizationId,
    actorUserId: context.userId,
    leadAssignmentId,
    ownerUserId: ownerRaw || null,
  });
  revalidatePath("/v2/workspace/leads/queue");
}

export default async function V2LeadQueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await getContext();
  if (context instanceof V2TenantError) {
    const msg = getTenantErrorMessage(context);
    return (
      <WorkspaceFrame>
        <div className="max-w-xl rounded-lg border border-border bg-white p-6">
          <div className="text-sm font-semibold text-foreground">{msg.title}</div>
          <p className="mt-2 text-sm text-muted-foreground">{msg.message}</p>
        </div>
      </WorkspaceFrame>
    );
  }

  const sp = await searchParams;
  const scopeRaw = Array.isArray(sp.scope) ? sp.scope[0] : sp.scope;
  const scope: Scope = scopeRaw === "unassigned" || scopeRaw === "all" ? scopeRaw : "mine";
  const canAssign = hasPermission(context.role, "lead.assign");

  const [leads, members] = await Promise.all([
    queryAssignedLeads(context.organizationId, { scope, ownerUserId: context.userId }),
    canAssign ? queryAssignableMembers(context.organizationId) : Promise.resolve([] as AssignableMember[]),
  ]);

  return (
    <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0">
      <PageHeader
        eyebrow="Leads"
        title="Lead queues"
        description="Leads grouped by ownership. Managers route unassigned leads to SDRs; each SDR works their own queue."
      />

      <div className="space-y-5 p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <Link href="/v2/workspace/leads" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Full lead workspace
          </Link>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {SCOPES.map((s) => {
            const active = s.key === scope;
            const Icon = s.icon;
            return (
              <Link
                key={s.key}
                href={`/v2/workspace/leads/queue?scope=${s.key}`}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${
                  active ? "bg-primary text-white" : "border border-border text-muted-foreground hover:bg-muted/40"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {s.label}
              </Link>
            );
          })}
        </div>

        <PanelCard title={`${SCOPES.find((s) => s.key === scope)?.label} · ${leads.length}`} contentClassName="p-0">
          {leads.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              {scope === "mine"
                ? "No leads assigned to you yet. A manager assigns leads from the Unassigned queue."
                : scope === "unassigned"
                  ? "No unassigned leads. Every active lead has an owner."
                  : "No active leads."}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {leads.map((lead) => (
                <LeadRow key={lead.leadAssignmentId} lead={lead} canAssign={canAssign} members={members} />
              ))}
            </ul>
          )}
        </PanelCard>
      </div>
    </WorkspaceFrame>
  );
}

function LeadRow({ lead, canAssign, members }: { lead: AssignedLead; canAssign: boolean; members: AssignableMember[] }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40">
      <div className="min-w-0 flex-1">
        <Link href={`/v2/workspace/leads?selectedLeadId=${lead.leadAssignmentId}`} className="truncate text-sm font-medium text-foreground hover:text-primary">
          {lead.companyName ?? "Unknown company"}
        </Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{lead.contactName ?? "Company-level"}</span>
          {lead.qualification ? <Badge tone="slate">{formatLabel(lead.qualification)}</Badge> : null}
          <Badge tone="blue">{formatLabel(lead.workflowStatus)}</Badge>
          <span className="text-muted-foreground">
            {lead.ownerName ? `Owner: ${lead.ownerName}` : "Unassigned"}
          </span>
        </div>
      </div>

      {canAssign ? (
        <form action={assignLeadAction} className="flex items-center gap-1.5">
          <input type="hidden" name="leadAssignmentId" value={lead.leadAssignmentId} />
          <select name="ownerUserId" defaultValue={lead.ownerUserId ?? ""} className={selectCls}>
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {(m.name ?? m.email)} · {m.role}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="inline-flex h-8 cursor-pointer items-center rounded-md bg-primary px-3 text-xs font-medium text-white hover:bg-primary"
          >
            Assign
          </button>
        </form>
      ) : null}
    </li>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "slate" | "blue" }) {
  const cls = tone === "blue" ? "bg-accent text-primary" : "bg-muted text-muted-foreground";
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>;
}

const selectCls =
  "h-8 rounded-md border border-border bg-white px-2 text-xs text-foreground outline-none focus:border-primary/20 focus:ring-2 focus:ring-primary/20";

function formatLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

async function getContext() {
  try {
    return await requirePermission("crm.read");
  } catch (error) {
    if (error instanceof V2TenantError) return error;
    throw error;
  }
}
