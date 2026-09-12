import type { IcpQualification } from "@prisma/client";

export type IcpMatchLabel = "fit" | "review" | "no_fit";
export type IcpMatchReason =
  | "qualified"
  | "needs_review"
  | "unqualified"
  | "not_scored"
  | "stale_assessment"
  | "no_campaign_icp";

export function deriveIcpMatch(input: {
  qualification: IcpQualification | null;
  assessedIcpVersionId: string | null;
  currentIcpVersionId: string | null;
}): { label: IcpMatchLabel; reason: IcpMatchReason } {
  if (!input.currentIcpVersionId)
    return { label: "review", reason: "no_campaign_icp" };
  if (!input.qualification || !input.assessedIcpVersionId) {
    return { label: "review", reason: "not_scored" };
  }
  if (input.assessedIcpVersionId !== input.currentIcpVersionId) {
    return { label: "review", reason: "stale_assessment" };
  }
  if (input.qualification === "qualified")
    return { label: "fit", reason: "qualified" };
  if (input.qualification === "unqualified")
    return { label: "no_fit", reason: "unqualified" };
  return { label: "review", reason: "needs_review" };
}
