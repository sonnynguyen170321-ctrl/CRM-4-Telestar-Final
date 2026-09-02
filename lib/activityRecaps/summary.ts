import type {
  SdrActivitySummary,
  StandardizedSdrActivityRow,
} from "@/lib/activityRecaps/types";

export function summarizeSdrActivity(
  rows: StandardizedSdrActivityRow[]
): SdrActivitySummary[] {
  const groups = new Map<
    string,
    SdrActivitySummary & {
      leadKeys: Set<string>;
      companyKeys: Set<string>;
    }
  >();

  for (const row of rows) {
    const sdrName = row.sdrName || "Unknown SDR";
    const summary = getOrCreateSummary(groups, sdrName);

    summary.linkedinCount += row.linkedinCount;
    summary.emailCount += row.emailCount;
    summary.callCount += row.callCount;
    summary.noPickupCount += row.noPickupCount;
    summary.notInterestedCount += row.notInterestedCount;
    summary.otherChannelCount += row.otherChannelCount;
    summary.totalActivityCount += row.totalActivityCount;

    if (row.managerReviewFlag) {
      summary.managerReviewCount += 1;
    }

    const leadKey = normalizedKey(row.leadName, row.companyName);
    if (leadKey) {
      summary.leadKeys.add(leadKey);
    }

    const companyKey = normalizedKey(row.companyName || row.website);
    if (companyKey) {
      summary.companyKeys.add(companyKey);
    }
  }

  return Array.from(groups.values())
    .map(({ leadKeys, companyKeys, ...summary }) => ({
      ...summary,
      uniqueLeadsTouched: leadKeys.size,
      uniqueCompaniesTouched: companyKeys.size,
    }))
    .sort((a, b) => b.totalActivityCount - a.totalActivityCount);
}

function getOrCreateSummary(
  groups: Map<
    string,
    SdrActivitySummary & {
      leadKeys: Set<string>;
      companyKeys: Set<string>;
    }
  >,
  sdrName: string
) {
  const existing = groups.get(sdrName);
  if (existing) {
    return existing;
  }

  const created = {
    sdrName,
    linkedinCount: 0,
    emailCount: 0,
    callCount: 0,
    noPickupCount: 0,
    notInterestedCount: 0,
    otherChannelCount: 0,
    totalActivityCount: 0,
    uniqueLeadsTouched: 0,
    uniqueCompaniesTouched: 0,
    managerReviewCount: 0,
    leadKeys: new Set<string>(),
    companyKeys: new Set<string>(),
  };

  groups.set(sdrName, created);
  return created;
}

function normalizedKey(...parts: Array<string | undefined>) {
  return parts
    .map((part) => part?.trim().toLowerCase())
    .filter(Boolean)
    .join("::");
}

