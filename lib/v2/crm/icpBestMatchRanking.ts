import type { LeadWorkspaceQualification, LeadWorkspaceAccountPreRank } from "./types";

// S1 pure ranking core (no I/O) — kept separate from the DB read model so it is
// unit-testable and never overclaims: ranking is presentation over existing
// immutable HardRuleAssessment fields, it does not invent or merge qualifications.

export type IcpMatchRow = {
  leadAssignmentId: string;
  projectId: string;
  projectName: string;
  icpProfileName: string;
  icpVersionNumber: number;
  workflowStatus: string;
  qualification: LeadWorkspaceQualification;
  accountPreRank: LeadWorkspaceAccountPreRank | null;
  fitScore: number | null;
  confidenceScore: number | null;
  ownerUserId: string | null;
  createdAt: string;
};

export type RankedIcpMatch = IcpMatchRow & {
  rank: number; // 1 = best
  isBest: boolean;
  gapReason: string | null; // why this ranks below the best (null for the best)
};

export type IcpBestMatchResult = {
  ranked: RankedIcpMatch[];
  best: RankedIcpMatch | null;
  // True only when the best is a positive, decided fit (QUALIFIED family) — so the
  // UI can say "ICP X is the best fit" instead of overclaiming a tentative match.
  confident: boolean;
  totalIcps: number;
};

// Lower number = stronger. UNKNOWN (NOT_SCORED) ranks above a decided UNQUALIFIED:
// an unscored ICP may still fit, a disqualified one is a known mismatch.
const QUALIFICATION_ORDER: Record<LeadWorkspaceQualification, number> = {
  QUALIFIED: 0,
  COMPANY_QUALIFIED_NEEDS_CONTACT: 1,
  NEEDS_REVIEW: 2,
  NOT_SCORED: 3,
  UNQUALIFIED: 4,
};

const POSITIVE_QUALIFICATIONS: ReadonlySet<LeadWorkspaceQualification> = new Set([
  "QUALIFIED",
  "COMPANY_QUALIFIED_NEEDS_CONTACT",
]);

function compareMatches(a: IcpMatchRow, b: IcpMatchRow): number {
  const q = QUALIFICATION_ORDER[a.qualification] - QUALIFICATION_ORDER[b.qualification];
  if (q !== 0) return q;
  const fa = a.fitScore ?? -1;
  const fb = b.fitScore ?? -1;
  if (fa !== fb) return fb - fa;
  const ca = a.confidenceScore ?? -1;
  const cb = b.confidenceScore ?? -1;
  if (ca !== cb) return cb - ca;
  if (a.icpVersionNumber !== b.icpVersionNumber) return b.icpVersionNumber - a.icpVersionNumber;
  return b.createdAt.localeCompare(a.createdAt);
}

function formatQualification(q: LeadWorkspaceQualification): string {
  return q
    .split("_")
    .map((p) => p.charAt(0) + p.slice(1).toLowerCase())
    .join(" ");
}

function gapReasonFor(rowItem: IcpMatchRow, best: IcpMatchRow): string | null {
  if (rowItem.leadAssignmentId === best.leadAssignmentId) return null;
  if (QUALIFICATION_ORDER[rowItem.qualification] > QUALIFICATION_ORDER[best.qualification]) {
    return `${formatQualification(rowItem.qualification)} vs ${formatQualification(best.qualification)} for the best fit`;
  }
  const rowFit = rowItem.fitScore ?? -1;
  const bestFit = best.fitScore ?? -1;
  if (rowFit < bestFit) return `Lower fit (${rowItem.fitScore ?? "—"} vs ${best.fitScore ?? "—"})`;
  const rowConf = rowItem.confidenceScore ?? -1;
  const bestConf = best.confidenceScore ?? -1;
  if (rowConf < bestConf) return "Lower confidence at equal fit";
  return "Older ICP version";
}

/** Pure: rank a company's ICP assignments and identify the best fit. */
export function rankIcpAssignments(rows: IcpMatchRow[]): IcpBestMatchResult {
  const sorted = [...rows].sort(compareMatches);
  const best = sorted[0] ?? null;
  const ranked: RankedIcpMatch[] = sorted.map((row, i) => ({
    ...row,
    rank: i + 1,
    isBest: best ? row.leadAssignmentId === best.leadAssignmentId : false,
    gapReason: best ? gapReasonFor(row, best) : null,
  }));
  return {
    ranked,
    best: ranked[0] ?? null,
    confident: Boolean(best && POSITIVE_QUALIFICATIONS.has(best.qualification)),
    totalIcps: ranked.length,
  };
}
