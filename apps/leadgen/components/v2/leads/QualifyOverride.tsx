import { CheckCircle2, ShieldX } from "lucide-react";

import { overrideLeadQualificationAction } from "@/app/v2/workspace/leads/actions";

// One human path to flip a NEEDS_REVIEW lead — reused by the lead, contact, and company
// drawers so the override is implemented once (Inv 4: the action inserts a NEW immutable
// assessment; it never mutates). Server-rendered <form>s posting to the shared action,
// which is gated on `workflow.update` (now incl. SDR). Render only when the caller has the
// permission AND the row is NEEDS_REVIEW — the badge derives from latestHardRuleAssessmentId.

type QualifyOverrideProps = {
  leadAssignmentId: string;
  /** "inline" = side-by-side compact (table rows); "stacked" = full-width (rails). */
  layout?: "inline" | "stacked";
};

export function QualifyOverride({ leadAssignmentId, layout = "inline" }: QualifyOverrideProps) {
  const wrap =
    layout === "stacked"
      ? "flex flex-col gap-2"
      : "flex items-center gap-1.5";
  const btnBase =
    layout === "stacked"
      ? "inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors"
      : "inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-semibold transition-colors";

  return (
    <div className={wrap}>
      <OverrideButton
        leadAssignmentId={leadAssignmentId}
        qualification="QUALIFIED"
        className={`${btnBase} border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}
        icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
        label="Qualify"
        title="Override to QUALIFIED — writes a new immutable assessment"
      />
      <OverrideButton
        leadAssignmentId={leadAssignmentId}
        qualification="UNQUALIFIED"
        className={`${btnBase} border border-red-200 bg-red-50 text-red-700 hover:bg-red-100`}
        icon={<ShieldX className="h-3.5 w-3.5" aria-hidden="true" />}
        label="Disqualify"
        title="Override to UNQUALIFIED — writes a new immutable assessment"
      />
    </div>
  );
}

function OverrideButton({
  leadAssignmentId,
  qualification,
  className,
  icon,
  label,
  title,
}: {
  leadAssignmentId: string;
  qualification: "QUALIFIED" | "UNQUALIFIED";
  className: string;
  icon: React.ReactNode;
  label: string;
  title: string;
}) {
  return (
    <form action={overrideLeadQualificationAction}>
      <input type="hidden" name="leadAssignmentId" value={leadAssignmentId} />
      <input type="hidden" name="qualification" value={qualification} />
      <button type="submit" className={className} title={title}>
        {icon}
        {label}
      </button>
    </form>
  );
}
