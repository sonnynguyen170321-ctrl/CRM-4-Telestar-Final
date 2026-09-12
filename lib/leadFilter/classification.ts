import type { IcpQualification } from "@prisma/client";

export type LeadFilterVerdict =
  | "qualified"
  | "needs_review"
  | "unqualified"
  | "not_scored";

export type LeadFilterReason =
  | LeadFilterVerdict
  | "stale_assessment"
  | "no_campaign_icp";

export function classifyCampaignProspect(input: {
  qualification: IcpQualification | null;
  assessedIcpVersionId: string | null;
  currentIcpVersionId: string | null;
}): { verdict: LeadFilterVerdict; reason: LeadFilterReason } {
  if (!input.currentIcpVersionId) {
    return { verdict: "needs_review", reason: "no_campaign_icp" };
  }
  if (!input.qualification || !input.assessedIcpVersionId) {
    return { verdict: "not_scored", reason: "not_scored" };
  }
  if (input.assessedIcpVersionId !== input.currentIcpVersionId) {
    return { verdict: "needs_review", reason: "stale_assessment" };
  }
  return { verdict: input.qualification, reason: input.qualification };
}
