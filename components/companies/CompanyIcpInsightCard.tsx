"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Bot, Save } from "lucide-react";

import { StatusBadge } from "@/components/shared/statusBadges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  generateCompanyIcpInsight,
  getCompanyIcpInsights,
  saveCompanyIcpInsight,
  type CompanyIcpInsight,
} from "@/lib/client/companyIcpInsights";

type CompanyIcpInsightCardProps = {
  companyRecordId: string;
  fallbackContext?: CompanyIcpFallbackContext;
};

export type CompanyIcpFallbackContext = {
  companyName: string;
  companyType: string | null;
  qualification: string | null;
  industry: string | null;
  companyBrief: string;
  signalLabels: string[];
  aiReason: string | null;
  aiSummary: string | null;
};

type FormState = {
  targetCustomerSegment: string;
  targetVerticals: string;
  buyerPersonas: string;
  useCasesPainPoints: string;
  sdrMessagingAngle: string;
  openingLine: string;
  confidence: string;
  evidenceNote: string;
};

const emptyForm: FormState = {
  targetCustomerSegment: "",
  targetVerticals: "",
  buyerPersonas: "",
  useCasesPainPoints: "",
  sdrMessagingAngle: "",
  openingLine: "",
  confidence: "",
  evidenceNote: "",
};

export function CompanyIcpInsightCard({
  companyRecordId,
  fallbackContext,
}: CompanyIcpInsightCardProps) {
  const [insight, setInsight] = useState<CompanyIcpInsight | null>(null);
  const [historyCount, setHistoryCount] = useState(0);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [status, setStatus] = useState<
    "loading" | "idle" | "generating" | "saving" | "error"
  >("loading");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadInsight() {
      setStatus("loading");
      setMessage(null);

      try {
        const result = await getCompanyIcpInsights(companyRecordId);

        if (cancelled) {
          return;
        }

        setInsight(result.latestInsight);
        setHistoryCount(result.historyCount);
        setForm(toFormState(result.latestInsight, fallbackContext));
        setStatus("idle");
      } catch (error) {
        if (cancelled) {
          return;
        }

        setStatus("error");
        setMessage(
          error instanceof Error ? error.message : "Company ICP load failed."
        );
      }
    }

    void loadInsight();

    return () => {
      cancelled = true;
    };
  }, [companyRecordId, fallbackContext]);

  const insightStatus = useMemo(() => getInsightStatus(insight), [insight]);

  async function handleGenerate() {
    setStatus("generating");
    setMessage(null);

    try {
      const generated = await generateCompanyIcpInsight(companyRecordId);
      setInsight(generated);
      setForm(toFormState(generated, fallbackContext));
      setHistoryCount((count) => count + 1);
      setStatus("idle");
      setMessage("Company ICP generated. SDR can edit before using in outreach.");
    } catch (error) {
      setStatus("error");
      setMessage(
        getFriendlyAiError(
          error instanceof Error
            ? error.message
            : "Company ICP generation failed."
        )
      );
    }
  }

  async function handleSave() {
    const confidence = parseConfidence(form.confidence);

    if (confidence === "invalid") {
      setStatus("error");
      setMessage("Confidence must be a number from 0 to 1.");
      return;
    }

    setStatus("saving");
    setMessage(null);

    try {
      const saved = await saveCompanyIcpInsight(companyRecordId, {
        targetCustomerSegment: form.targetCustomerSegment,
        targetVerticals: splitLines(form.targetVerticals),
        buyerPersonas: splitLines(form.buyerPersonas),
        useCasesPainPoints: splitLines(form.useCasesPainPoints),
        sdrMessagingAngle: form.sdrMessagingAngle,
        confidence,
        evidenceNote: form.evidenceNote,
      });

      setInsight(saved);
      setForm((current) => ({
        ...toFormState(saved, fallbackContext),
        openingLine: current.openingLine,
      }));
      setHistoryCount((count) => count + 1);
      setStatus("idle");
      setMessage("Company ICP saved as SDR-edited insight.");
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error ? error.message : "Company ICP save failed."
      );
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            Company ICP and SDR angle
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            AI suggested target customer profile. Use this to brief SDR
            messaging. SDR can edit before using.
          </p>
        </div>
        <StatusBadge tone={insightStatus.tone}>{insightStatus.label}</StatusBadge>
      </div>

      <div className="space-y-4 rounded-md border bg-background p-3">
        <div className="rounded-md border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">
          AI insight only. It does not change score, qualification, SDR
          feedback, or exports.
          {historyCount > 0 ? ` Saved versions: ${historyCount}.` : ""}
        </div>

        {status === "loading" ? (
          <p className="text-sm text-muted-foreground">Loading Company ICP...</p>
        ) : (
          <>
            {!insight && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                Not generated yet. Generate an AI suggestion for this company
                only, or fill the fields manually and save.
              </div>
            )}

            {insight?.errorMessage && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <p className="text-destructive">
                  {getFriendlyAiError(insight.errorMessage)}
                </p>
                <details className="mt-2 text-xs text-muted-foreground">
                  <summary className="cursor-pointer">
                    Technical error details
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap">
                    {insight.errorMessage}
                  </p>
                </details>
              </div>
            )}

            <div className="grid gap-3">
              <EditableInsightBox
                title="Company ICP"
                source={getBoxSource({
                  insight,
                  fallbackValue: buildFallbackIcp(fallbackContext),
                  currentValue: form.targetCustomerSegment,
                })}
                note="Saved as target customer / segment."
              >
                <Textarea
                  value={form.targetCustomerSegment}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      targetCustomerSegment: event.target.value,
                    }))
                  }
                  placeholder="Not available yet. Run AI assessment or enter an ICP manually."
                />
              </EditableInsightBox>

              <EditableInsightBox
                title="Pain points"
                source={getBoxSource({
                  insight,
                  fallbackValue: fallbackContext?.aiReason ?? "",
                  currentValue: form.useCasesPainPoints,
                  unavailableWhenNoInsight: true,
                })}
                note="Saved as use cases / pain points."
              >
                <Textarea
                  value={form.useCasesPainPoints}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      useCasesPainPoints: event.target.value,
                    }))
                  }
                  placeholder="Not available yet. Run AI assessment."
                />
              </EditableInsightBox>

              <EditableInsightBox
                title="Telestar SDR angle / script"
                source={getBoxSource({
                  insight,
                  fallbackValue: buildFallbackAngle(fallbackContext),
                  currentValue: form.sdrMessagingAngle,
                })}
                note="Saved as SDR messaging angle."
              >
                <Textarea
                  value={form.sdrMessagingAngle}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      sdrMessagingAngle: event.target.value,
                    }))
                  }
                  placeholder="Not available yet. Run AI assessment or enter a rule-based angle."
                />
              </EditableInsightBox>

              <EditableInsightBox
                title="Opening line / message angle"
                source={insight ? "AI generated draft" : "Draft only / not saved"}
                note="Local draft only. There is no persistence field for opening line yet."
              >
                <Textarea
                  value={form.openingLine}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      openingLine: event.target.value,
                    }))
                  }
                  placeholder="Not available yet. Run AI assessment or draft an opener manually."
                />
              </EditableInsightBox>

              <details className="rounded-md border bg-muted/20">
                <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">
                  Additional saved ICP fields
                </summary>
                <div className="grid gap-3 border-t p-3">
              <Field label="Target verticals">
                <Textarea
                  value={form.targetVerticals}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      targetVerticals: event.target.value,
                    }))
                  }
                  placeholder="One vertical per line"
                />
              </Field>

              <Field label="Buyer personas">
                <Textarea
                  value={form.buyerPersonas}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      buyerPersonas: event.target.value,
                    }))
                  }
                  placeholder="One persona per line"
                />
              </Field>

              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Confidence">
                  <Input
                    value={form.confidence}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        confidence: event.target.value,
                      }))
                    }
                    placeholder="0.0 to 1.0"
                  />
                </Field>
                <Field label="Source note / evidence note">
                  <Input
                    value={form.evidenceNote}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        evidenceNote: event.target.value,
                      }))
                    }
                    placeholder="Evidence strength or manual review note"
                  />
                </Field>
              </div>
                </div>
              </details>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleGenerate()}
                disabled={status === "generating" || status === "saving"}
              >
                <Bot className="h-4 w-4" />
                {insight ? "Regenerate with AI" : "Generate with AI"}
              </Button>
              <Button
                type="button"
                onClick={() => void handleSave()}
                disabled={status === "generating" || status === "saving"}
              >
                <Save className="h-4 w-4" />
                {status === "saving" ? "Saving ICP" : "Save Company ICP"}
              </Button>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              Save persists Company ICP, pain points, SDR angle, verticals,
              personas, confidence, and evidence note. Opening line is local
              draft only because no persistence field exists yet.
            </p>

            {message && (
              <p
                className={`rounded-md border p-3 text-sm ${
                  status === "error"
                    ? "border-destructive/40 bg-destructive/5 text-destructive"
                    : "bg-muted/30 text-muted-foreground"
                }`}
              >
                {message}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function EditableInsightBox({
  title,
  source,
  note,
  children,
}: {
  title: string;
  source: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-slate-950">{title}</h4>
          <p className="mt-1 text-xs text-muted-foreground">{note}</p>
        </div>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500">
          {source}
        </span>
      </div>
      {children}
    </div>
  );
}

function toFormState(
  insight: CompanyIcpInsight | null,
  fallbackContext?: CompanyIcpFallbackContext
): FormState {
  if (!insight) {
    return {
      ...emptyForm,
      targetCustomerSegment: buildFallbackIcp(fallbackContext),
      sdrMessagingAngle: buildFallbackAngle(fallbackContext),
      openingLine: buildFallbackOpeningLine(fallbackContext),
    };
  }

  return {
    targetCustomerSegment:
      insight.targetCustomerSegment ?? buildFallbackIcp(fallbackContext),
    targetVerticals: insight.targetVerticals.join("\n"),
    buyerPersonas: insight.buyerPersonas.join("\n"),
    useCasesPainPoints:
      insight.useCasesPainPoints.join("\n") || fallbackContext?.aiReason || "",
    sdrMessagingAngle:
      insight.sdrMessagingAngle ?? buildFallbackAngle(fallbackContext),
    openingLine:
      fallbackContext?.aiSummary ?? buildFallbackOpeningLine(fallbackContext),
    confidence:
      typeof insight.confidence === "number" ? String(insight.confidence) : "",
    evidenceNote: insight.evidenceNote ?? "",
  };
}

function getBoxSource({
  insight,
  fallbackValue,
  currentValue,
  unavailableWhenNoInsight,
}: {
  insight: CompanyIcpInsight | null;
  fallbackValue: string;
  currentValue: string;
  unavailableWhenNoInsight?: boolean;
}) {
  if (insight?.source === "sdr_edit") {
    return "Edited by SDR";
  }

  if (insight && currentValue.trim()) {
    return "AI generated";
  }

  if (unavailableWhenNoInsight && !insight) {
    return "Not available yet";
  }

  if (fallbackValue.trim()) {
    return "Rule-based fallback";
  }

  return "Not available yet";
}

function buildFallbackIcp(context?: CompanyIcpFallbackContext) {
  if (!context) return "";

  return [
    context.companyType ? `${context.companyType} segment` : null,
    context.qualification ? `${context.qualification} fit` : null,
    context.industry ? `Industry: ${context.industry}` : null,
    context.signalLabels.length > 0
      ? `Signals: ${context.signalLabels.slice(0, 4).join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildFallbackAngle(context?: CompanyIcpFallbackContext) {
  if (!context) return "";

  if (!context.companyType && !context.industry && context.signalLabels.length === 0) {
    return "";
  }

  const fitCopy =
    context.qualification === "qualified"
      ? "prioritize as a strong-fit account"
      : context.qualification === "uncertain"
        ? "validate fit with a light discovery message"
        : "treat carefully unless new evidence changes the fit";
  const segment = context.companyType ?? context.industry ?? "this company";
  const signals =
    context.signalLabels.length > 0
      ? ` Mention observed ${context.signalLabels.slice(0, 3).join(", ")} signals.`
      : "";

  return `Use a Telestar SDR outsourcing angle for ${segment}: ${fitCopy}.${signals}`;
}

function buildFallbackOpeningLine(context?: CompanyIcpFallbackContext) {
  if (!context) return "";

  if (!context.companyBrief || context.companyBrief === "No company brief available yet.") {
    return `Rule-based fallback draft: ask ${context.companyName} whether additional outbound pipeline support is useful for their current growth motion.`;
  }

  return `Rule-based fallback draft: reference ${context.companyName}'s public positioning, then ask whether additional SDR capacity would help support their current go-to-market motion.`;
}

function splitLines(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseConfidence(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return "invalid" as const;
  }

  return parsed;
}

function getInsightStatus(insight: CompanyIcpInsight | null) {
  if (!insight) {
    return { label: "Not generated yet", tone: "neutral" as const };
  }

  if (insight.errorMessage) {
    return { label: "AI failed", tone: "danger" as const };
  }

  if (insight.source === "sdr_edit") {
    return { label: "Edited by SDR", tone: "info" as const };
  }

  return { label: "AI suggested", tone: "warning" as const };
}

function getFriendlyAiError(message: string) {
  const lower = message.toLowerCase();

  if (
    lower.includes("429") ||
    lower.includes("quota") ||
    lower.includes("rate limit")
  ) {
    return "AI was enabled, but this assessment could not complete because the provider quota/rate limit was reached. Local scoring and SDR review still work.";
  }

  if (lower.includes("disabled")) {
    return "AI is disabled. Local scoring and SDR review still work.";
  }

  return message;
}
