const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type CampaignLeadEligibility = {
  leadAssignmentId: string;
  qualification: "QUALIFIED" | "NEEDS_REVIEW" | "UNQUALIFIED" | "NOT_SCORED";
  fitScore: number | null;
  email: string | null;
  suppressed: boolean;
  overrideReason?: string | null;
};

export type CampaignLeadDecision =
  | { eligible: true; requiresOverride: boolean }
  | { eligible: false; code: "INVALID_EMAIL" | "SUPPRESSED" | "OVERRIDE_REQUIRED"; reason: string };

export function decideCampaignLeadEligibility(lead: CampaignLeadEligibility): CampaignLeadDecision {
  if (!lead.email || !EMAIL_PATTERN.test(lead.email.trim())) {
    return { eligible: false, code: "INVALID_EMAIL", reason: "Lead has no valid primary email." };
  }
  if (lead.suppressed) {
    return { eligible: false, code: "SUPPRESSED", reason: "Recipient is suppressed." };
  }
  if (lead.qualification !== "QUALIFIED" && !lead.overrideReason?.trim()) {
    return {
      eligible: false,
      code: "OVERRIDE_REQUIRED",
      reason: "Non-qualified outreach requires an explicit reason.",
    };
  }
  return { eligible: true, requiresOverride: lead.qualification !== "QUALIFIED" };
}

const QUALIFICATION_ORDER = {
  QUALIFIED: 0,
  NEEDS_REVIEW: 1,
  UNQUALIFIED: 2,
  NOT_SCORED: 3,
} as const;

export function prioritizeCampaignLeads<T extends CampaignLeadEligibility>(leads: readonly T[]): T[] {
  return [...leads].sort((left, right) => {
    const qualificationDelta =
      QUALIFICATION_ORDER[left.qualification] - QUALIFICATION_ORDER[right.qualification];
    if (qualificationDelta !== 0) return qualificationDelta;
    return (right.fitScore ?? -1) - (left.fitScore ?? -1);
  });
}