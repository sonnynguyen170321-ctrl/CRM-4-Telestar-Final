"use client";

import { useState } from "react";
import { Eye, Loader2, Trash2 } from "lucide-react";

import {
  deleteCampaignVariantAction,
  saveCampaignVariantAction,
} from "@/app/v2/outreach/campaigns/[campaignId]/actions";
import { CAMPAIGN_MERGE_VARIABLES } from "@/lib/v2/outreach/campaigns/mergeVariables";
import { RichComposeEditor } from "./RichComposeEditor";

type VariantInput = {
  id: string;
  key: string;
  weight: number;
  subjectTemplate: string | null;
  bodyTemplate: string | null;
  requiredVariables?: string[];
};

type PreviewContact = { id: string; label: string; email: string | null };
type FieldRender = { text: string; error: string | null };
type PreviewState = { subject: FieldRender; body: FieldRender };

const fieldCls =
  "h-11 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/20";

export function CampaignVariantEditor({
  campaignId,
  stepId,
  variant,
  canRemove,
  previewContacts = [],
}: {
  campaignId: string;
  stepId: string;
  variant: VariantInput;
  canRemove: boolean;
  previewContacts?: PreviewContact[];
}) {
  const [subject, setSubject] = useState(variant.subjectTemplate ?? "");
  const [body, setBody] = useState(variant.bodyTemplate ?? "");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewLeadId, setPreviewLeadId] = useState(previewContacts[0]?.id ?? "");
  // The rich editor carries its own cursor-aware merge picker; the quick-chip row below appends.
  function insertVariable(key: string) {
    setBody((current) => `${current} {{${key}}} `);
  }

  async function runPreview() {
    setPreviewing(true);
    setPreviewError(null);
    try {
      const res = await fetch("/v2/outreach/campaigns/" + campaignId + "/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subjectTemplate: subject,
          bodyTemplate: body,
          leadAssignmentId: previewLeadId || undefined,
        }),
      });
      const data = (await res.json()) as { ok: boolean; subject?: FieldRender; body?: FieldRender; error?: string };
      if (!data.ok || !data.subject || !data.body) {
        setPreviewError(data.error ?? "Preview failed.");
        setPreview(null);
        return;
      }
      setPreview({ subject: data.subject, body: data.body });
    } catch {
      setPreviewError("Preview request failed.");
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs font-semibold text-primary">
        <span>Variant {variant.key}</span>
        {canRemove ? (
          <form action={deleteCampaignVariantAction}>
            <input type="hidden" name="campaignId" value={campaignId} />
            <input type="hidden" name="stepId" value={stepId} />
            <input type="hidden" name="variantId" value={variant.id} />
            <button
              type="submit"
              className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md px-2 text-xs font-medium text-red-600 outline-none transition-colors hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-500"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Remove
            </button>
          </form>
        ) : null}
      </div>

      {previewContacts.length > 0 ? (
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Generate preview for contact
          <select
            value={previewLeadId}
            onChange={(event) => setPreviewLeadId(event.target.value)}
            className="h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
          >
            {previewContacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.label}{contact.email ? ` - ${contact.email}` : ""}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="flex flex-wrap gap-1">
        {CAMPAIGN_MERGE_VARIABLES.map((mergeVariable) => (
          <button
            key={mergeVariable.key}
            type="button"
            onClick={() => insertVariable(mergeVariable.key)}
            title={mergeVariable.label}
            className="inline-flex min-h-8 cursor-pointer items-center rounded-md border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-primary/20 hover:bg-accent hover:text-primary"
          >
            {"{{" + mergeVariable.key + "}}"}
          </button>
        ))}
      </div>

      <form action={saveCampaignVariantAction} className="space-y-2">
        <input type="hidden" name="campaignId" value={campaignId} />
        <input type="hidden" name="stepId" value={stepId} />
        <input type="hidden" name="variantId" value={variant.id} />
        <label className="flex items-center justify-end gap-1 text-xs font-normal text-muted-foreground">
          Weight
          <input
            type="number"
            name="weight"
            min={1}
            max={10000}
            defaultValue={variant.weight}
            className="h-8 w-20 rounded-md border border-border bg-card px-2 text-xs"
          />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Subject
          <input
            name="subjectTemplate"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className={fieldCls}
            placeholder="Subject (blank = keep thread subject on follow-ups)"
          />
        </label>
        <div className="grid gap-1 text-xs font-medium text-muted-foreground">
          Body
          <RichComposeEditor name="bodyTemplate" value={body} onChange={setBody} minHeightPx={200} />
        </div>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Required variables
          <input
            name="requiredVariables"
            className="h-9 rounded-md border border-border bg-card px-3 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
            defaultValue={(variant.requiredVariables ?? []).join(", ")}
            placeholder="first_name, company"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            className="inline-flex min-h-10 cursor-pointer items-center rounded-md bg-primary px-3 text-xs font-semibold text-white outline-none transition-colors hover:bg-primary focus-visible:ring-2 focus-visible:ring-primary/20"
          >
            Save variant {variant.key}
          </button>
          <button
            type="button"
            onClick={runPreview}
            disabled={previewing}
            className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-semibold text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
            {previewLeadId ? "Preview contact" : "Preview sample"}
          </button>
        </div>
      </form>

      {previewError ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">{previewError}</div>
      ) : null}

      {preview ? (
        <div className="rounded-md border border-border bg-muted/40 p-3">
          <div className="mb-1.5 text-[11px] font-semibold uppercase text-muted-foreground">Preview</div>
          <PreviewLine label="Subject" field={preview.subject} />
          <div className="mt-2">
            <PreviewLine label="Body" field={preview.body} multiline />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PreviewLine({ label, field, multiline = false }: { label: string; field: FieldRender; multiline?: boolean }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      {field.error ? (
        <div className="mt-0.5 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">{field.error}</div>
      ) : multiline && field.text && /<\/?[a-z][^>]*>/i.test(field.text) ? (
        <div className="prose prose-sm mt-0.5 max-w-none text-foreground" dangerouslySetInnerHTML={{ __html: field.text }} />
      ) : (
        <div className={"mt-0.5 text-sm text-foreground" + (multiline ? " whitespace-pre-line" : " truncate")}>
          {field.text || <span className="text-muted-foreground">(empty)</span>}
        </div>
      )}
    </div>
  );
}