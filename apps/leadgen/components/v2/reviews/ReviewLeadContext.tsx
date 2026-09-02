import Link from "next/link";
import { CheckCircle2, XCircle, FileText, Mail } from "lucide-react";

import type { LeadWorkspaceDetail } from "@/lib/v2/crm";

// M3: surface the SDR-grade lead context inside the manager review so a reviewer
// decides with the SAME evidence the SDR sees (assessment reason, hard gates,
// company intelligence + evidence, contact readiness) — not a stub. Read-only;
// resolutions still never mutate the assessment (assessments are immutable).

function formatLabel(value: string): string {
  return value
    .split("_")
    .map((p) => p.charAt(0) + p.slice(1).toLowerCase())
    .join(" ");
}

type HardGate = { label: string; passed: boolean | null; detail: string | null };

function parseHardGates(value: unknown): HardGate[] {
  if (!Array.isArray(value)) return [];
  const out: HardGate[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const r = entry as Record<string, unknown>;
    const label =
      (typeof r.label === "string" && r.label) ||
      (typeof r.rule === "string" && r.rule) ||
      (typeof r.name === "string" && r.name) ||
      (typeof r.gate === "string" && r.gate) ||
      null;
    if (!label) continue;
    const passedRaw = r.passed ?? r.pass ?? r.result;
    const passed =
      typeof passedRaw === "boolean"
        ? passedRaw
        : typeof passedRaw === "string"
          ? /^(pass|passed|true|ok)$/i.test(passedRaw)
          : null;
    const detail =
      (typeof r.detail === "string" && r.detail) ||
      (typeof r.reason === "string" && r.reason) ||
      (typeof r.message === "string" && r.message) ||
      null;
    out.push({ label, passed, detail });
  }
  return out;
}

export function ReviewLeadContext({ detail }: { detail: LeadWorkspaceDetail }) {
  const a = detail.latestAssessment;
  const intel = detail.companyIntelligence;
  const hardGates = a ? parseHardGates(a.hardGateResultsJson) : [];

  return (
    <section className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Lead context (SDR view)</h3>
        <Link
          href={`/v2/workspace/leads?selectedLeadId=${detail.leadAssignmentId}`}
          className="text-xs font-medium text-primary hover:text-primary"
        >
          Open full lead
        </Link>
      </div>

      {/* Contact readiness — the SDR's first question. */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          {detail.contactName ?? "Company-level"}
        </span>
        {detail.contactTitle ? <span>· {detail.contactTitle}</span> : null}
        {detail.contactEmail ? (
          <span className="inline-flex items-center gap-1">
            <Mail className="h-3 w-3" aria-hidden="true" />
            {detail.contactEmail}
            {detail.hasVerifiedEmail ? (
              <span className="text-emerald-600">verified</span>
            ) : (
              <span className="text-amber-600">unverified</span>
            )}
          </span>
        ) : (
          <span className="text-amber-600">No email on file</span>
        )}
      </div>

      {/* Assessment (the immutable scoring outcome). */}
      {a ? (
        <div className="rounded-md border border-border bg-white p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">
              {formatLabel(a.qualification)}
            </span>
            <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">
              Fit {a.fitScore}
            </span>
            <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">
              Confidence {a.confidenceScore ?? a.confidence}
            </span>
            {a.accountPreRank ? (
              <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">
                {formatLabel(a.accountPreRank)}
              </span>
            ) : null}
          </div>
          {a.oneSentenceCompanySummary ? (
            <p className="mt-2 text-xs font-medium text-foreground">{a.oneSentenceCompanySummary}</p>
          ) : null}
          {a.reason ? <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{a.reason}</p> : null}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border bg-white p-3 text-xs text-muted-foreground">
          Not scored yet — no assessment to review.
        </div>
      )}

      {/* Hard gates — why it qualified / failed. */}
      {hardGates.length > 0 ? (
        <div>
          <div className="text-xs font-medium text-muted-foreground">Hard gates</div>
          <ul className="mt-1.5 space-y-1">
            {hardGates.map((g, i) => (
              <li key={`${g.label}-${i}`} className="flex items-start gap-1.5 text-xs">
                {g.passed === false ? (
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
                )}
                <span className="text-foreground">
                  {g.label}
                  {g.detail ? <span className="text-muted-foreground"> — {g.detail}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Company intelligence + evidence (the SDR's research). */}
      {intel?.companySummary ? (
        <div className="rounded-md border border-border bg-white p-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            Company intelligence
          </div>
          <p className="mt-1 text-xs text-foreground">{intel.companySummary}</p>
          {intel.evidenceByFamily.length > 0 ? (
            <ul className="mt-2 space-y-1.5">
              {intel.evidenceByFamily.slice(0, 4).map((fam) => (
                <li key={fam.family} className="text-xs">
                  <span className="font-medium text-muted-foreground">{formatLabel(fam.family)}:</span>{" "}
                  <span className="text-muted-foreground">
                    {fam.items.slice(0, 2).map((it) => it.evidenceText).filter(Boolean).join(" · ") || "—"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
