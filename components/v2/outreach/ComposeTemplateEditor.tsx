"use client";

import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Copy, Eye, FilePlus2, Save, Wand2, Info } from "lucide-react";
import {
  archiveTemplateAction,
  createTemplateAction,
  duplicateTemplateAction,
  restoreTemplateAction,
  saveTemplateAction,
} from "@/app/v2/outreach/templates/actions";
import { analyzeTemplate } from "@/lib/v2/outreach/templates/templateAnalysis";
import { stringifyRequiredVariables, templateStatusTone, type ComposeTemplateStatus } from "@/lib/v2/outreach/templates/templateFields";
import type { ComposeTemplateSummary, TemplatePreviewLead } from "@/lib/v2/outreach/templates/queryComposeTemplates";
import { RichComposeEditor } from "./RichComposeEditor";
import { ActionQueue, OutreachPill, ReadinessChecklist } from "./OutreachCommandPrimitives";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ComposeTemplateEditor({
  selectedTemplate,
  previewLeads,
}: {
  selectedTemplate: ComposeTemplateSummary | null;
  previewLeads: TemplatePreviewLead[];
}) {
  const [name, setName] = useState(selectedTemplate?.name ?? "");
  const [description, setDescription] = useState(selectedTemplate?.description ?? "");
  const [category, setCategory] = useState(selectedTemplate?.category ?? "Manual compose");
  const [status, setStatus] = useState<ComposeTemplateStatus>(selectedTemplate?.status ?? "DRAFT");
  const [subjectTemplate, setSubjectTemplate] = useState(selectedTemplate?.subjectTemplate ?? "");
  const [bodyTemplate, setBodyTemplate] = useState(selectedTemplate?.bodyTemplate ?? "");
  const [requiredVariables, setRequiredVariables] = useState(stringifyRequiredVariables(selectedTemplate?.requiredVariables));
  const [previewLeadId, setPreviewLeadId] = useState(previewLeads[0]?.id ?? "");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [isPending, startTransition] = useTransition();

  const analysis = useMemo(
    () => analyzeTemplate({ subjectTemplate, bodyTemplate, requiredVariables: requiredVariables.split(/[\n,]/).map((v) => v.trim()).filter(Boolean) }),
    [subjectTemplate, bodyTemplate, requiredVariables]
  );

  const readiness = [
    { ok: Boolean(name.trim()), label: "Template name", detail: name.trim() || "Give the template a human-readable name." },
    { ok: Boolean(subjectTemplate.trim()), label: "Subject ready", detail: subjectTemplate.trim() ? `${subjectTemplate.trim().length} characters` : "Subject is empty." },
    { ok: Boolean(bodyTemplate.trim()), label: "Body ready", detail: bodyTemplate.trim() ? `${bodyTemplate.trim().split(/\s+/).length} words` : "Body is empty." },
    { ok: analysis.unknownVariables.length === 0, label: "Merge variables are known", detail: analysis.unknownVariables.length ? analysis.unknownVariables.join(", ") : "All variables match the V2 catalog or custom.*." },
    { ok: analysis.missingRequiredVariables.length === 0, label: "Required variables are used", detail: analysis.missingRequiredVariables.length ? analysis.missingRequiredVariables.join(", ") : "No required variable is declared without being used." },
  ];
  const actions = [
    ...analysis.warnings.map((warning) => ({ label: warning, detail: "Template quality check", tone: "amber" as const })),
    ...analysis.unknownVariables.map((variable) => ({ label: `Unknown variable: ${variable}`, detail: "Use a catalog key or custom.* so preview/send can resolve it.", tone: "red" as const })),
    ...analysis.missingRequiredVariables.map((variable) => ({ label: `Required but unused: ${variable}`, detail: "Insert it into subject/body or remove it from required variables.", tone: "amber" as const })),
  ];

  function runPreview() {
    startTransition(async () => {
      setPreview(null);
      const response = await fetch("/v2/outreach/templates/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectTemplate, bodyTemplate, requiredVariables, leadAssignmentId: previewLeadId || null }),
      });
      const data = (await response.json()) as PreviewState;
      setPreview(data);
    });
  }

  const issuesCount = actions.length;

  return (
    <div className="grid h-full xl:grid-cols-2 bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      {/* Left Pane - Editor */}
      <div className="flex flex-col border-r border-border">
        {/* Header Actions */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-muted/50">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-bold text-foreground">
              {selectedTemplate ? selectedTemplate.name : "New compose template"}
            </h2>
            <OutreachPill tone={templateStatusTone(status)}>{status}</OutreachPill>
          </div>

          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors ${issuesCount > 0 ? "bg-amber-100 text-amber-700 hover:bg-amber-200" : "bg-green-100 text-green-700 hover:bg-green-200"}`}>
                  {issuesCount > 0 ? <AlertTriangle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  {issuesCount > 0 ? `${issuesCount} Issues` : "Ready"}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80 p-0">
                <div className="p-3 bg-muted/40 border-b border-border">
                  <h4 className="text-xs font-bold uppercase text-muted-foreground">Readiness Checklist</h4>
                </div>
                <div className="p-3 max-h-96 overflow-y-auto">
                  <ReadinessChecklist items={readiness} footer="Checks do not assert live-send readiness." />
                  {actions.length > 0 && (
                    <div className="mt-4">
                      <ActionQueue items={actions} emptyLabel="" />
                    </div>
                  )}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            {selectedTemplate ? (
              <>
                <button type="submit" formAction={saveTemplateAction} form="template-form" className="inline-flex h-8 items-center gap-1.5 rounded bg-primary px-3 text-xs font-semibold text-white hover:bg-primary">
                  <Save className="w-3.5 h-3.5" /> Save
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded border border-border bg-white text-foreground hover:bg-muted/40">
                      ...
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <form action={duplicateTemplateAction} className="block">
                      <input type="hidden" name="templateId" value={selectedTemplate.id} />
                      <button type="submit" className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-muted">
                        <Copy className="w-3.5 h-3.5" /> Duplicate
                      </button>
                    </form>
                    <form action={selectedTemplate.status === "ARCHIVED" ? restoreTemplateAction : archiveTemplateAction} className="block border-t border-border mt-1 pt-1">
                      <input type="hidden" name="templateId" value={selectedTemplate.id} />
                      <button type="submit" className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50">
                        <AlertTriangle className="w-3.5 h-3.5" /> {selectedTemplate.status === "ARCHIVED" ? "Restore" : "Archive"}
                      </button>
                    </form>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <button type="submit" formAction={createTemplateAction} form="template-form" className="inline-flex h-8 items-center gap-1.5 rounded bg-primary px-3 text-xs font-semibold text-white hover:bg-primary">
                <FilePlus2 className="w-3.5 h-3.5" /> Create
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <form id="template-form" className="space-y-5">
            <input type="hidden" name="templateId" value={selectedTemplate?.id ?? ""} />
            <input type="hidden" name="version" value={selectedTemplate?.version ?? 1} />

            <div className="grid gap-4 md:grid-cols-2">
              <Labeled label="Template Name">
                <input name="name" className="border-b border-border bg-transparent py-2 text-sm font-medium outline-none focus:border-primary/20 transition-colors" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Finance leaders roundtable intro" />
              </Labeled>
              <Labeled label="Category & Status">
                <div className="flex gap-2">
                  <input name="category" className="flex-1 border-b border-border bg-transparent py-2 text-sm outline-none focus:border-primary/20" value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Category" />
                  <select name="status" className="w-32 border-b border-border bg-transparent py-2 text-sm outline-none focus:border-primary/20" value={status} onChange={(event) => setStatus(event.target.value as ComposeTemplateStatus)}>
                    <option value="DRAFT">Draft</option>
                    <option value="ACTIVE">Active</option>
                    <option value="ARCHIVED">Archived</option>
                  </select>
                </div>
              </Labeled>
            </div>

            <Labeled label="Subject">
              <input name="subjectTemplate" className="w-full border-b border-border bg-transparent py-2 text-sm font-semibold outline-none focus:border-primary/20 transition-colors" value={subjectTemplate} onChange={(event) => setSubjectTemplate(event.target.value)} placeholder="Quick question for {{ company }}" />
            </Labeled>

            <div className="space-y-1">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Body Message</span>
              <RichComposeEditor name="bodyTemplate" value={bodyTemplate} onChange={setBodyTemplate} minHeightPx={280} />
            </div>

            <div className="pt-4 border-t border-border">
              <Labeled label="Required Variables (One per line)">
                <textarea name="requiredVariables" rows={3} className="w-full rounded-md border border-border bg-muted/40 p-2 font-mono text-xs outline-none focus:border-primary/20" value={requiredVariables} onChange={(event) => setRequiredVariables(event.target.value)} placeholder={"first_name\ncompany"} />
              </Labeled>
            </div>
          </form>
        </div>
      </div>

      {/* Right Pane - Live Preview */}
      <div className="flex flex-col bg-muted/50">
        <div className="flex items-center justify-between border-b border-border px-5 py-3 bg-white">
          <h2 className="text-sm font-bold text-foreground">Live Preview</h2>
          <div className="flex items-center gap-2">
            <select className="h-8 rounded-md border border-border bg-white px-2 text-xs font-medium outline-none focus:border-primary/20" value={previewLeadId} onChange={(event) => setPreviewLeadId(event.target.value)}>
              <option value="">Sample data</option>
              {previewLeads.map((lead) => (
                <option key={lead.id} value={lead.id}>{lead.label}{lead.email ? ` (${lead.email})` : ""}</option>
              ))}
            </select>
            <button type="button" onClick={runPreview} disabled={isPending} className="inline-flex h-8 items-center gap-1.5 rounded bg-foreground px-3 text-xs font-semibold text-white hover:bg-foreground disabled:opacity-50">
              <Wand2 className="w-3.5 h-3.5" /> {isPending ? "Generating..." : "Preview"}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {preview?.ok === false ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <AlertTriangle className="mb-2 h-5 w-5 text-red-600" />
              {preview.error ?? "Preview failed to render."}
            </div>
          ) : preview?.ok ? (
            <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
              <div className="border-b border-border bg-muted/80 px-4 py-3">
                <div className="flex mb-1">
                  <span className="w-16 text-xs font-semibold text-muted-foreground">To:</span>
                  <span className="text-xs font-medium text-foreground">{preview.source === "sample" ? "Sample Contact <sample@example.com>" : "Lead Contact"}</span>
                </div>
                <div className="flex">
                  <span className="w-16 text-xs font-semibold text-muted-foreground">Subject:</span>
                  <span className="text-xs font-bold text-foreground">{preview.subject.text || preview.subject.error || "(No subject)"}</span>
                </div>
              </div>
              <div className="p-5">
                {preview.body.error ? (
                  <p className="text-sm text-red-600">{preview.body.error}</p>
                ) : preview.body.text ? (
                  looksLikeHtml(preview.body.text) ? (
                    <div className="prose prose-sm max-w-none leading-relaxed text-foreground" dangerouslySetInnerHTML={{ __html: preview.body.text }} />
                  ) : (
                    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">{preview.body.text}</pre>
                  )
                ) : (
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">(Empty body)</pre>
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-center px-4">
              <div className="mb-4 rounded-full bg-muted p-3">
                <Eye className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">See how it looks</h3>
              <p className="mt-1 text-xs text-muted-foreground max-w-xs">Select a real lead or use sample data, then hit Preview to see the final rendered email.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type PreviewState =
  | { ok: true; subject: { text: string; error: string | null }; body: { text: string; error: string | null }; source: "lead" | "sample" }
  | { ok: false; error: string };

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
      {children}
    </label>
  );
}

// Client-safe mirror of looksLikeHtml (the server copy lives with node:crypto, so it can't be imported here).
function looksLikeHtml(body: string): boolean {
  return /<\/?(?:p|div|br|span|strong|em|b|i|u|ul|ol|li|a|h[1-6]|blockquote|pre|table|img)\b[^>]*>/i.test(body);
}
