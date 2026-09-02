import Link from "next/link";
import { revalidatePath } from "next/cache";
import { ArrowLeft, Ban } from "lucide-react";

import { PageHeader } from "@/components/shared/PageHeader";
import { PanelCard } from "@/components/shared/PanelCard";
import { MetricCard } from "@/components/shared/MetricCard";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { WorkspaceMetricGrid } from "@/components/shared/WorkspaceMetricGrid";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { BatchEmailCheckPanel, type BatchCampaignOption } from "@/components/v2/outreach/BatchEmailCheckPanel";
import { getTenantErrorMessage, hasPermission, requirePermission, V2TenantError } from "@/lib/v2/tenant";
import { prisma } from "@/lib/server/prisma";
import { extractDomainIdentifier, normalizeEmailIdentifier } from "@/lib/v2/outreach/suppression/normalizeIdentifier";

// NS4: /v2/outreach/suppression - suppression list. The suppression gate is the
// last synchronous check before any send (Invariant 10); this view shows what is
// currently blocked and lets outreach admins run batch hygiene checks.

async function addSuppressionAction(formData: FormData) {
  "use server";
  let context;
  try {
    context = await requirePermission("outreach.admin");
  } catch {
    return;
  }
  const raw = (formData.get("identifier")?.toString() ?? "").trim();
  const identifierType = formData.get("identifierType")?.toString() === "DOMAIN" ? "DOMAIN" : "EMAIL";
  const normalized = identifierType === "DOMAIN" ? extractDomainIdentifier(raw) : normalizeEmailIdentifier(raw);
  if (!normalized) return;
  const suppressionType = ["MANUAL", "BLACKLIST", "TENANT_LEVEL"].includes(String(formData.get("suppressionType")))
    ? String(formData.get("suppressionType"))
    : "MANUAL";
  await prisma.v2SuppressionEntry.create({
    data: {
      organizationId: context.organizationId,
      scopeType: "ORGANIZATION",
      identifierType,
      identifierValueNormalized: normalized,
      suppressionType: suppressionType as "MANUAL" | "BLACKLIST" | "TENANT_LEVEL",
      reason: (formData.get("reason")?.toString() ?? "").trim() || "Manual suppression from outreach UI",
      source: "OUTREACH_UI",
      createdByUserId: context.userId,
    },
  });
  revalidatePath("/v2/outreach/suppression");
}

async function deleteSuppressionAction(formData: FormData) {
  "use server";
  let context;
  try {
    context = await requirePermission("outreach.admin");
  } catch {
    return;
  }
  const suppressionId = (formData.get("suppressionId")?.toString() ?? "").trim();
  if (!suppressionId) return;
  await prisma.v2SuppressionEntry.updateMany({
    where: {
      id: suppressionId,
      organizationId: context.organizationId,
      deletedAt: null,
    },
    data: {
      deletedAt: new Date(),
      deletedByUserId: context.userId,
      deletionReason: "Removed from outreach UI",
    },
  });
  revalidatePath("/v2/outreach/suppression");
}

async function bulkImportSuppressionAction(formData: FormData) {
  "use server";
  let context;
  try {
    context = await requirePermission("outreach.admin");
  } catch {
    return;
  }
  const raw = (formData.get("identifiers")?.toString() ?? "").trim();
  const reason = (formData.get("reason")?.toString() ?? "").trim() || "Bulk import from outreach UI";
  if (!raw) return;

  // Paste/CSV import: split on newlines/commas/semicolons, auto-detect email vs domain per
  // token, normalize with the same helpers the send gate uses, dedupe in-batch, skip
  // identifiers that are already actively suppressed. Cap per submit to keep it request-safe.
  const tokens = Array.from(new Set(
    raw.split(/[\n,;]+/).map((t) => t.trim()).filter(Boolean)
  )).slice(0, 2000);
  const parsed = tokens
    .map((token) => {
      const isEmail = token.includes("@");
      const normalized = isEmail ? normalizeEmailIdentifier(token) : extractDomainIdentifier(token);
      return normalized ? { identifierType: isEmail ? "EMAIL" as const : "DOMAIN" as const, normalized } : null;
    })
    .filter((v): v is { identifierType: "EMAIL" | "DOMAIN"; normalized: string } => v !== null);
  if (parsed.length === 0) return;

  const existing = await prisma.v2SuppressionEntry.findMany({
    where: {
      organizationId: context.organizationId,
      deletedAt: null,
      identifierValueNormalized: { in: parsed.map((p) => p.normalized) },
    },
    select: { identifierValueNormalized: true },
  });
  const existingSet = new Set(existing.map((e) => e.identifierValueNormalized));
  const fresh = parsed.filter((p) => !existingSet.has(p.normalized));
  if (fresh.length > 0) {
    await prisma.v2SuppressionEntry.createMany({
      data: fresh.map((p) => ({
        organizationId: context.organizationId,
        scopeType: "ORGANIZATION" as const,
        identifierType: p.identifierType,
        identifierValueNormalized: p.normalized,
        suppressionType: "MANUAL" as const,
        reason,
        source: "OUTREACH_UI_BULK",
        createdByUserId: context.userId,
      })),
    });
  }
  revalidatePath("/v2/outreach/suppression");
}

type SuppressionRow = {
  id: string;
  scopeType: string;
  identifierType: string;
  identifierValueNormalized: string;
  suppressionType: string;
  reason: string | null;
  source: string | null;
  createdAt: Date | string;
  expiresAt: Date | string | null;
};

export default async function V2OutreachSuppressionPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const q = (Array.isArray(params.q) ? params.q[0] : params.q)?.trim() ?? "";
  const typeFilterRaw = (Array.isArray(params.type) ? params.type[0] : params.type)?.trim() ?? "";
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

  const canAdmin = hasPermission(context.role, "outreach.admin");
  const [entries, campaigns] = await Promise.all([
    loadSuppression(context.organizationId, { q, type: typeFilterRaw }),
    canAdmin ? loadDraftCampaigns(context.organizationId) : Promise.resolve([]),
  ]);
  const byType = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.suppressionType] = (acc[e.suppressionType] ?? 0) + 1;
    return acc;
  }, {});

  const columns: DataTableColumn<SuppressionRow>[] = [
    {
      key: "identifier",
      header: "Identifier",
      cell: (entry) => <span className="font-medium text-foreground">{entry.identifierValueNormalized}</span>,
    },
    {
      key: "type",
      header: "Type",
      cell: (entry) => (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${suppressionTone(entry.suppressionType)}`}>
          {formatLabel(entry.suppressionType)}
        </span>
      ),
    },
    {
      key: "reason",
      header: "Reason",
      cell: (entry) => <span className="text-muted-foreground">{entry.reason ?? "-"}</span>,
    },
    {
      key: "scope",
      header: "Scope",
      cell: (entry) => <span className="text-muted-foreground">{formatLabel(entry.scopeType)}</span>,
    },
    {
      key: "source",
      header: "Source",
      cell: (entry) => <span className="text-muted-foreground">{entry.source ?? "-"}</span>,
    },
    {
      key: "added",
      header: "Added",
      cell: (entry) => <span className="text-muted-foreground">{new Date(entry.createdAt).toLocaleDateString()}</span>,
    },
    ...(canAdmin
      ? [
          {
            key: "action",
            header: "Action",
            cell: (entry) => (
              <form action={deleteSuppressionAction}>
                <input type="hidden" name="suppressionId" value={entry.id} />
                <button type="submit" className="text-xs font-semibold text-red-700 hover:text-red-800">Remove</button>
              </form>
            ),
          } as DataTableColumn<SuppressionRow>,
        ]
      : []),
  ];

  return (
    <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0">
      <PageHeader
        title="Suppression"
        description="Addresses blocked from outreach. The suppression check runs synchronously immediately before every send."
      />

      <div className="space-y-5 p-5 sm:p-6">
        <Link href="/v2/outreach" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to outreach
        </Link>

        {canAdmin ? <AddSuppressionPanel /> : null}

        {canAdmin ? <BatchEmailCheckPanel campaigns={campaigns} /> : null}

        <WorkspaceMetricGrid>
          <MetricCard label="Active entries" value={entries.length.toLocaleString()} icon={Ban} />
          <MetricCard label="Bounces" value={(byType.BOUNCE ?? 0).toLocaleString()} />
          <MetricCard label="Unsubscribes" value={(byType.UNSUBSCRIBE ?? 0).toLocaleString()} />
          <MetricCard label="Manual / other" value={(entries.length - (byType.BOUNCE ?? 0) - (byType.UNSUBSCRIBE ?? 0)).toLocaleString()} />
        </WorkspaceMetricGrid>

        {canAdmin ? (
          <PanelCard title="Bulk import" description="Paste emails/domains (one per line, or comma-separated). Duplicates and already-suppressed identifiers are skipped.">
            <form action={bulkImportSuppressionAction} className="space-y-3">
              <textarea
                name="identifiers"
                rows={4}
                required
                placeholder={"person@example.com\nspam-domain.com\nother@blocked.io"}
                className="w-full rounded-md border border-border bg-white px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-primary/20"
              />
              <div className="flex flex-wrap items-end gap-3">
                <label className="min-w-64 flex-1 text-xs font-medium text-muted-foreground">
                  Reason
                  <input name="reason" placeholder="Why block these?" className="mt-1 h-10 w-full rounded-md border border-border bg-white px-3 text-sm text-foreground outline-none focus:border-primary/20" />
                </label>
                <button type="submit" className="inline-flex h-10 items-center rounded-md bg-foreground px-4 text-sm font-semibold text-white hover:bg-foreground">
                  Import list
                </button>
              </div>
            </form>
          </PanelCard>
        ) : null}

        {/* Search + type filter (GET form keeps the server-rendered list canonical). */}
        <form method="GET" className="flex flex-wrap items-center gap-2">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search suppressed identifiers…"
            className="h-10 w-72 rounded-md border border-border bg-white px-3 text-sm text-foreground outline-none focus:border-primary/20"
          />
          <select name="type" defaultValue={typeFilterRaw} className="h-10 rounded-md border border-border bg-white px-2 text-sm text-foreground outline-none focus:border-primary/20">
            <option value="">All types</option>
            <option value="MANUAL">Manual</option>
            <option value="BOUNCE">Bounce</option>
            <option value="UNSUBSCRIBE">Unsubscribe</option>
            <option value="COMPLAINT">Complaint</option>
            <option value="BLACKLIST">Blacklist</option>
            <option value="TENANT_LEVEL">Tenant level</option>
          </select>
          <button type="submit" className="h-10 rounded-md border border-border bg-white px-3 text-sm font-semibold text-foreground hover:bg-muted/40">
            Filter
          </button>
          {(q || typeFilterRaw) ? (
            <Link href="/v2/outreach/suppression" className="text-sm font-medium text-primary hover:text-primary">Clear</Link>
          ) : null}
        </form>

        <PanelCard title="Suppressed identifiers" contentClassName="p-0">
          <DataTable
            columns={columns}
            rows={entries}
            getRowId={(entry) => entry.id}
            minWidth="min-w-[760px]"
            empty={
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                No active suppression entries. Hard bounces and unsubscribes are added here
                automatically once outreach is live.
              </div>
            }
            className="border-none shadow-none rounded-none"
          />
        </PanelCard>
      </div>
    </WorkspaceFrame>
  );
}

function AddSuppressionPanel() {
  return (
    <PanelCard title="Add suppression" description="Manual entries are active immediately and are checked synchronously before every send.">
      <form action={addSuppressionAction} className="grid gap-3 lg:grid-cols-[150px_minmax(220px,1fr)_160px_minmax(220px,1fr)_auto]">
        <label className="text-xs font-medium text-muted-foreground">
          Identifier type
          <select name="identifierType" className="mt-1 h-10 w-full rounded-md border border-border bg-white px-2 text-sm text-foreground outline-none focus:border-primary/20">
            <option value="EMAIL">Email</option>
            <option value="DOMAIN">Domain</option>
          </select>
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          Identifier
          <input name="identifier" required placeholder="person@example.com or example.com" className="mt-1 h-10 w-full rounded-md border border-border bg-white px-3 text-sm text-foreground outline-none focus:border-primary/20" />
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          Type
          <select name="suppressionType" className="mt-1 h-10 w-full rounded-md border border-border bg-white px-2 text-sm text-foreground outline-none focus:border-primary/20">
            <option value="MANUAL">Manual</option>
            <option value="BLACKLIST">Blacklist</option>
            <option value="TENANT_LEVEL">Tenant level</option>
          </select>
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          Reason
          <input name="reason" placeholder="Why block this recipient/domain?" className="mt-1 h-10 w-full rounded-md border border-border bg-white px-3 text-sm text-foreground outline-none focus:border-primary/20" />
        </label>
        <button type="submit" className="mt-5 inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-white outline-none hover:bg-primary focus-visible:ring-2 focus-visible:ring-primary/20">
          Add
        </button>
      </form>
    </PanelCard>
  );
}

const SUPPRESSION_TYPE_FILTERS = new Set(["MANUAL", "BLACKLIST", "TENANT_LEVEL", "BOUNCE", "UNSUBSCRIBE", "COMPLAINT"]);

async function loadSuppression(
  organizationId: string,
  filters: { q?: string; type?: string } = {}
): Promise<SuppressionRow[]> {
  const params: unknown[] = [organizationId];
  const clauses = [
    `"organizationId" = $1`,
    `"deletedAt" IS NULL`,
    `("expiresAt" IS NULL OR "expiresAt" > CURRENT_TIMESTAMP)`,
  ];
  if (filters.q?.trim()) {
    params.push(`%${filters.q.trim().toLowerCase()}%`);
    clauses.push(`"identifierValueNormalized" LIKE $${params.length}`);
  }
  if (filters.type && SUPPRESSION_TYPE_FILTERS.has(filters.type)) {
    params.push(filters.type);
    clauses.push(`"suppressionType"::text = $${params.length}`);
  }
  return prisma.$queryRawUnsafe<SuppressionRow[]>(
    `
      SELECT
        "id", "scopeType"::text AS "scopeType", "identifierType"::text AS "identifierType",
        "identifierValueNormalized", "suppressionType"::text AS "suppressionType",
        "reason", "source", "createdAt", "expiresAt"
      FROM "V2SuppressionEntry"
      WHERE ${clauses.join(" AND ")}
      ORDER BY "createdAt" DESC
      LIMIT 500
    `,
    ...params
  );
}

async function loadDraftCampaigns(organizationId: string): Promise<BatchCampaignOption[]> {
  const rows = await prisma.v2Sequence.findMany({
    where: {
      organizationId,
      deletedAt: null,
      status: "DRAFT",
    },
    select: {
      id: true,
      name: true,
      status: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
  }));
}

function suppressionTone(type: string) {
  return type === "BOUNCE"
    ? "bg-red-50 text-red-700"
    : type === "UNSUBSCRIBE"
      ? "bg-amber-50 text-amber-700"
      : "bg-muted text-muted-foreground";
}

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