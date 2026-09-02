import { Badge } from "@/components/ui/badge";
import { getQualificationBadgeClassName } from "@/components/shared/statusBadges";
import { cn } from "@/lib/utils";
import type {
  LeadWorkspaceAccountPreRank,
  LeadWorkspaceAssessment,
  LeadWorkspaceConfidenceBand,
  LeadWorkspaceQualification,
} from "@/lib/v2/crm";

type AssessmentSummaryCardProps = {
  assessment: LeadWorkspaceAssessment | null;
  compact?: boolean;
};

export function AssessmentSummaryCard({
  assessment,
  compact = false,
}: AssessmentSummaryCardProps) {
  if (!assessment) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-white px-3 py-3 text-sm text-muted-foreground">
        <QualificationBadge qualification="NOT_SCORED" />
        <div className="mt-2">No hard-rule assessment has been persisted.</div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-white px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <QualificationBadge qualification={assessment.qualification} />
        {assessment.confidenceBand && (
          <ConfidenceBadge confidenceBand={assessment.confidenceBand} />
        )}
        {assessment.accountPreRank && (
          <AccountPreRankBadge accountPreRank={assessment.accountPreRank} />
        )}
        <span className="text-xs text-muted-foreground">
          {formatDateTime(assessment.createdAt)}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <Metric label="Fit score" value={`${assessment.fitScore}`} />
        <Metric
          label="Evidence confidence"
          value={
            assessment.confidenceScore !== null
              ? `${assessment.confidenceScore}`
              : `${Math.round(assessment.confidence * 100)}`
          }
        />
      </div>
      {!compact && (
        <>
          <p className="mt-3 line-clamp-3 text-sm text-foreground">
            {assessment.reason || "No reason recorded."}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Deterministic ICP rule assessment. Confidence describes evidence
            quality, not close probability.
          </p>
        </>
      )}
    </div>
  );
}

// Business-facing qualification labels. COMPANY_QUALIFIED_NEEDS_CONTACT means the account fits but we
// lack a qualifying (decision-maker) contact — either none, or one without a persona title — so it reads
// "Needs a decision-maker", not the verbose "Company Qualified Needs Contact".
const QUALIFICATION_LABEL: Record<string, string> = {
  QUALIFIED: "Qualified",
  NEEDS_REVIEW: "Needs review",
  UNQUALIFIED: "Unqualified",
  COMPANY_QUALIFIED_NEEDS_CONTACT: "Needs a decision-maker",
  NOT_SCORED: "Not scored",
};

export function qualificationLabel(qualification: string): string {
  return QUALIFICATION_LABEL[qualification] ?? formatEnumLabel(qualification);
}

export function QualificationBadge({
  qualification,
}: {
  qualification: LeadWorkspaceQualification;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("rounded-md", getQualificationBadgeClassName(qualification))}
    >
      {qualificationLabel(qualification)}
    </Badge>
  );
}

export function AccountPreRankBadge({
  accountPreRank,
}: {
  accountPreRank: LeadWorkspaceAccountPreRank;
}) {
  const className =
    accountPreRank === "STRONG_ACCOUNT_FIT"
      ? "border-qual-qualified-border bg-qual-qualified-surface text-qual-qualified-foreground"
      : accountPreRank === "POSSIBLE_ACCOUNT_FIT"
        ? "border-qual-needs-contact-border bg-qual-needs-contact-surface text-qual-needs-contact-foreground"
        : accountPreRank === "WEAK_FIT"
          ? "border-qual-needs-review-border bg-qual-needs-review-surface text-qual-needs-review-foreground"
          : "border-qual-unqualified-border bg-qual-unqualified-surface text-qual-unqualified-foreground";

  return (
    <Badge variant="outline" className={cn("rounded-md", className)}>
      {formatEnumLabel(accountPreRank)}
    </Badge>
  );
}

export function WorkflowBadge({ workflowStatus }: { workflowStatus: string }) {
  return (
    <Badge variant="outline" className="border-border bg-muted/40 text-foreground">
      {formatEnumLabel(workflowStatus)}
    </Badge>
  );
}

export function AssignmentLevelBadge({
  assignmentLevel,
}: {
  assignmentLevel: string;
}) {
  return (
    <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">
      {formatEnumLabel(assignmentLevel)}
    </Badge>
  );
}

export function ConfidenceBadge({
  confidenceBand,
}: {
  confidenceBand: LeadWorkspaceConfidenceBand;
}) {
  const className =
    confidenceBand === "HIGH"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : confidenceBand === "MEDIUM"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-border bg-muted/40 text-foreground";

  return (
    <Badge variant="outline" className={className}>
      {formatEnumLabel(confidenceBand)}
    </Badge>
  );
}

export function formatEnumLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/40 px-2 py-1.5">
      <div className="text-[11px] font-medium uppercase tracking-normal text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}
