import Link from "next/link";
import { AlertTriangle, Archive, CheckCircle2, FilePlus2, Library, Search } from "lucide-react";

import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { PageHeader } from "@/components/shared/PageHeader";
import { CampaignNav } from "@/components/v2/outreach/CampaignNav";
import { ComposeTemplateEditor } from "@/components/v2/outreach/ComposeTemplateEditor";
import { DataState, InsightStrip, OutreachPanel, OutreachPill } from "@/components/v2/outreach/OutreachCommandPrimitives";
import { queryComposeTemplateDetail, queryComposeTemplates, queryTemplatePreviewLeads } from "@/lib/v2/outreach/templates/queryComposeTemplates";
import type { ComposeTemplateStatus } from "@/lib/v2/outreach/templates/templateFields";
import { templateStatusTone } from "@/lib/v2/outreach/templates/templateFields";
import { getTenantErrorMessage, requirePermission, V2TenantError } from "@/lib/v2/tenant";

export const dynamic = "force-dynamic";

const STATUS_FILTERS = ["ALL", "ACTIVE", "DRAFT", "ARCHIVED"] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number];

export default async function V2OutreachTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const context = await getContext();
  if (context instanceof V2TenantError) {
    const msg = getTenantErrorMessage(context);
    return (
      <WorkspaceFrame>
        <div className="max-w-xl rounded-md border border-border bg-card p-6">
          <div className="text-sm font-semibold text-foreground">{msg.title}</div>
          <p className="mt-2 text-sm text-muted-foreground">{msg.message}</p>
        </div>
      </WorkspaceFrame>
    );
  }

  const status = normalizeStatusFilter(pick(params, "status"));
  const q = pick(params, "q") ?? "";
  const category = pick(params, "category") ?? "";
  const selectedId = pick(params, "templateId");
  const notice = pick(params, "notice");
  const [templates, allTemplates, previewLeads] = await Promise.all([
    queryComposeTemplates(context.organizationId, { status, q, category }),
    queryComposeTemplates(context.organizationId),
    queryTemplatePreviewLeads(context.organizationId),
  ]);
  const selectedTemplate = selectedId
    ? await queryComposeTemplateDetail(context.organizationId, selectedId)
    : templates[0] ?? null;
  const categories = Array.from(new Set(allTemplates.map((template) => template.category).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b));
  const counts = buildCounts(allTemplates);

  return (
    <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0">
      <PageHeader
        eyebrow="Outreach"
        title="Compose templates"
        description="Create reusable manual outreach templates with deterministic variable readiness, preview, and safe compose handoff. Applying a template never bypasses live-send readiness."
      />

      <div className="space-y-5 p-5 sm:p-6">
        <CampaignNav active="templates" />

        {notice ? <Notice code={notice} /> : null}

        <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
          <OutreachPanel
            title="Template library"
            description="Searchable manual compose assets. Campaign variants stay separate."
            actions={
              <Link href="/v2/outreach/templates" className="inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-3 text-xs font-semibold text-white hover:bg-primary">
                <FilePlus2 className="h-4 w-4" aria-hidden="true" /> New
              </Link>
            }
            className="min-w-0 xl:sticky xl:top-5 xl:self-start"
          >
            <div className="space-y-3 p-3">
              <form className="relative">
                <input type="hidden" name="status" value={status} />
                {category ? <input type="hidden" name="category" value={category} /> : null}
                <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <input name="q" defaultValue={q} placeholder="Search templates..." className="min-h-11 w-full rounded-md border border-border bg-white pl-9 pr-3 text-sm outline-none focus:border-primary/20 focus:ring-2 focus:ring-primary/20" />
              </form>

              <div className="flex flex-wrap gap-2">
                {STATUS_FILTERS.map((filter) => (
                  <Link key={filter} href={filterHref({ status: filter, q, category })} className={`inline-flex min-h-9 items-center rounded-md border px-3 text-xs font-semibold ${status === filter ? "border-primary/20 bg-accent text-primary" : "border-border bg-white text-muted-foreground hover:bg-muted/40"}`}>
                    {filterLabel(filter)} <span className="ml-1 tabular-nums">{counts[filter]}</span>
                  </Link>
                ))}
              </div>

              {categories.length ? (
                <div className="flex flex-wrap gap-2">
                  {categories.map((item) => (
                    <Link key={item} href={filterHref({ status, q, category: item === category ? "" : item })} className={`inline-flex min-h-8 items-center rounded-full border px-3 text-xs font-semibold ${item === category ? "border-border bg-foreground text-white" : "border-border bg-muted/40 text-foreground hover:bg-white"}`}>
                      {item}
                    </Link>
                  ))}
                </div>
              ) : null}

              {templates.length === 0 ? (
                <DataState icon={Library} title="No templates found" description="Save a draft from this page or from Smart Compose." />
              ) : (
                <div className="max-h-[680px] space-y-2 overflow-y-auto pr-1">
                  {templates.map((template) => {
                    const selected = selectedTemplate?.id === template.id;
                    return (
                      <Link key={template.id} href={templateHref(template.id, status, q, category)} className={`block rounded-md border p-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/20 ${selected ? "border-primary/20 bg-accent" : "border-border bg-card hover:bg-muted/40"}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-foreground">{template.name}</div>
                            <div className="mt-0.5 truncate text-xs text-muted-foreground">{template.category ?? "Uncategorized"}</div>
                          </div>
                          <OutreachPill tone={templateStatusTone(template.status)} className="min-h-6 shrink-0 px-2 py-0 text-[11px]">{template.status}</OutreachPill>
                        </div>
                        <div className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{template.subjectTemplate || template.description || "No subject yet"}</div>
                        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                          <span>{template.usageCount} uses</span>
                          <span>{template.lastUsedAt ? `Last used ${formatDate(template.lastUsedAt)}` : `Updated ${formatDate(template.updatedAt)}`}</span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </OutreachPanel>

          <ComposeTemplateEditor selectedTemplate={selectedTemplate} previewLeads={previewLeads} />
        </div>
      </div>
    </WorkspaceFrame>
  );
}

function Notice({ code }: { code: string }) {
  const map: Record<string, { tone: "green" | "amber" | "red"; icon: typeof CheckCircle2; text: string }> = {
    created: { tone: "green", icon: CheckCircle2, text: "Template created. Review variables and activate it when ready." },
    saved: { tone: "green", icon: CheckCircle2, text: "Template saved." },
    duplicated: { tone: "green", icon: CheckCircle2, text: "Template duplicated as a draft." },
    archived: { tone: "amber", icon: Archive as typeof CheckCircle2, text: "Template archived. It remains visible in the Archived filter." },
    conflict: { tone: "red", icon: AlertTriangle as typeof CheckCircle2, text: "Save conflict: this template changed since the editor loaded. Reopen it and apply your edits again." },
    invalid: { tone: "red", icon: AlertTriangle as typeof CheckCircle2, text: "Template action was missing required context." },
  };
  const notice = map[code];
  if (!notice) return null;
  return <InsightStrip tone={notice.tone} icon={notice.icon}>{notice.text}</InsightStrip>;
}

function buildCounts(templates: Array<{ status: ComposeTemplateStatus }>) {
  return {
    ALL: templates.length,
    ACTIVE: templates.filter((template) => template.status === "ACTIVE").length,
    DRAFT: templates.filter((template) => template.status === "DRAFT").length,
    ARCHIVED: templates.filter((template) => template.status === "ARCHIVED").length,
  };
}

function normalizeStatusFilter(value: string | undefined): StatusFilter {
  const raw = (value ?? "ALL").toUpperCase();
  return STATUS_FILTERS.includes(raw as StatusFilter) ? (raw as StatusFilter) : "ALL";
}

function filterLabel(status: StatusFilter) {
  if (status === "ALL") return "All";
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function filterHref(input: { status: StatusFilter; q: string; category: string }) {
  const params = new URLSearchParams();
  if (input.status !== "ALL") params.set("status", input.status);
  if (input.q) params.set("q", input.q);
  if (input.category) params.set("category", input.category);
  const qs = params.toString();
  return `/v2/outreach/templates${qs ? `?${qs}` : ""}`;
}

function templateHref(templateId: string, status: StatusFilter, q: string, category: string) {
  const params = new URLSearchParams();
  params.set("templateId", templateId);
  if (status !== "ALL") params.set("status", status);
  if (q) params.set("q", q);
  if (category) params.set("category", category);
  return `/v2/outreach/templates?${params.toString()}`;
}

function pick(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  const first = Array.isArray(value) ? value[0] : value;
  return first && first.trim() ? first.trim() : undefined;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(value));
}

async function getContext() {
  try {
    return await requirePermission("crm.read");
  } catch (error) {
    if (error instanceof V2TenantError) return error;
    throw error;
  }
}
