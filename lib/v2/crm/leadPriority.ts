// Lead priority scoring — the "smart" ranking behind /v2/leads.
//
// A lead's priority (0–100) is a pure function of signals the workspace already loads:
// qualification, workflowStatus, fitScore, and last-touch recency. The queue is sorted by
// this in SQL (so pagination is correct across the whole set) AND the badge is computed in
// JS from the same formula. To keep the badge equal to the sort key, the SQL expression
// (PRIORITY_ORDER_BY_SQL) and the JS scorer (computeLeadPriority) MUST stay in lockstep —
// they are co-located here on purpose. If you change one, change the other + the test.

export type LeadPriorityTier = "hot" | "warm" | "cool";

export type LeadPriorityResult = {
  score: number; // clamped 0–100
  tier: LeadPriorityTier;
};

export type LeadPriorityInput = {
  qualification: string | null;
  workflowStatus: string | null;
  fitScore: number | null;
  lastTouchAt: string | null;
};

const DAY_MS = 86_400_000;

function qualificationBase(qualification: string | null): number {
  switch (qualification) {
    case "QUALIFIED":
      return 55;
    case "COMPANY_QUALIFIED_NEEDS_CONTACT":
      return 42;
    case "NEEDS_REVIEW":
      return 38;
    case "UNQUALIFIED":
      return 5;
    default:
      return 22; // NOT_SCORED / null
  }
}

function workflowUrgency(workflowStatus: string | null): number {
  switch (workflowStatus) {
    case "RESPONDED":
      return 28;
    case "MEETING_BOOKED":
      return 22;
    case "NEW":
      return 12;
    case "WORKING":
      return 10;
    case "ASSIGNED":
      return 10;
    case "MEETING_DONE":
      return 6;
    case "CONTACTED":
      return 6;
    case "NURTURE":
      return 2;
    case "PAUSED":
      return -10;
    case "NOT_INTERESTED":
    case "BOUNCED":
    case "SUPPRESSED":
    case "DISQUALIFIED":
    case "ARCHIVED":
      return -40;
    default:
      return 0;
  }
}

// Staleness keyed on qualification (not workflow) so the SQL mirror stays a simple CASE.
// Untouched hot leads and gone-cold follow-ups float up; just-touched leads sink.
function stalenessBump(qualification: string | null, lastTouchAt: string | null, now: number): number {
  const hot = qualification === "QUALIFIED" || qualification === "COMPANY_QUALIFIED_NEEDS_CONTACT";
  const followable = hot || qualification === "NEEDS_REVIEW";
  if (lastTouchAt === null) {
    return hot ? 12 : 0;
  }
  const ageDays = (now - new Date(lastTouchAt).getTime()) / DAY_MS;
  if (ageDays >= 5 && followable) return 10;
  if (ageDays <= 1) return -6;
  return 0;
}

export function computeLeadPriority(input: LeadPriorityInput, now: number = Date.now()): LeadPriorityResult {
  const raw =
    qualificationBase(input.qualification) +
    workflowUrgency(input.workflowStatus) +
    (input.fitScore ?? 0) * 0.15 +
    stalenessBump(input.qualification, input.lastTouchAt, now);

  const score = Math.max(0, Math.min(100, Math.round(raw)));
  return { score, tier: score >= 70 ? "hot" : score >= 45 ? "warm" : "cool" };
}

// SQL mirror of computeLeadPriority for ORDER BY. Assumes the aliases used by
// queryContactLeads: `plead` (the primary lead LATERAL) + `last_touch` (last activity).
// Kept as one expression string so the query stays a single, correct-across-pagination sort.
export const PRIORITY_ORDER_BY_SQL = `(
  CASE plead."qualification"
    WHEN 'QUALIFIED' THEN 55
    WHEN 'COMPANY_QUALIFIED_NEEDS_CONTACT' THEN 42
    WHEN 'NEEDS_REVIEW' THEN 38
    WHEN 'UNQUALIFIED' THEN 5
    ELSE 22
  END
  + CASE plead."workflowStatus"
    WHEN 'RESPONDED' THEN 28
    WHEN 'MEETING_BOOKED' THEN 22
    WHEN 'NEW' THEN 12
    WHEN 'WORKING' THEN 10
    WHEN 'ASSIGNED' THEN 10
    WHEN 'MEETING_DONE' THEN 6
    WHEN 'CONTACTED' THEN 6
    WHEN 'NURTURE' THEN 2
    WHEN 'PAUSED' THEN -10
    WHEN 'NOT_INTERESTED' THEN -40
    WHEN 'BOUNCED' THEN -40
    WHEN 'SUPPRESSED' THEN -40
    WHEN 'DISQUALIFIED' THEN -40
    WHEN 'ARCHIVED' THEN -40
    ELSE 0
  END
  + COALESCE(plead."fitScore", 0) * 0.15
  + CASE
      WHEN last_touch."lastTouchAt" IS NULL
        AND plead."qualification" IN ('QUALIFIED', 'COMPANY_QUALIFIED_NEEDS_CONTACT') THEN 12
      WHEN last_touch."lastTouchAt" < (now() - interval '5 days')
        AND plead."qualification" IN ('QUALIFIED', 'COMPANY_QUALIFIED_NEEDS_CONTACT', 'NEEDS_REVIEW') THEN 10
      WHEN last_touch."lastTouchAt" >= (now() - interval '1 day') THEN -6
      ELSE 0
    END
)`;
