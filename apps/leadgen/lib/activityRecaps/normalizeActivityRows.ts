import { evaluateManagerReviewRules } from "@/lib/activityRecaps/managerReviewRules";
import type {
  ActivityColumnMapping,
  CallStageNormalized,
  EmailStageNormalized,
  LinkedInStageNormalized,
  OtherChannelNormalized,
  StandardizedSdrActivityRow,
} from "@/lib/activityRecaps/types";

export function normalizeActivityRows(
  rows: Record<string, string>[],
  mapping: ActivityColumnMapping
): StandardizedSdrActivityRow[] {
  return rows.map((rawRow, index) => normalizeActivityRow(rawRow, mapping, index + 1));
}

function normalizeActivityRow(
  rawRow: Record<string, string>,
  mapping: ActivityColumnMapping,
  rowIndex: number
): StandardizedSdrActivityRow {
  const linkedinStageRaw = getValue(rawRow, mapping, "linkedinStage");
  const linkedinDate = getValue(rawRow, mapping, "linkedinDate");
  const emailStageRaw = getValue(rawRow, mapping, "emailStage");
  const emailDate = getValue(rawRow, mapping, "emailDate");
  const callStageRaw = getValue(rawRow, mapping, "callStage");
  const callDate = getValue(rawRow, mapping, "callDate");
  const otherChannelRaw = getValue(rawRow, mapping, "otherChannelStage");
  const otherChannelDate = getValue(rawRow, mapping, "otherChannelDate");
  const noteCombined = getCombinedValue(rawRow, mapping.noteCombined);

  const linkedinStageNormalized = normalizeLinkedInStage(linkedinStageRaw);
  const emailStageNormalized = normalizeEmailStage(emailStageRaw);
  const callStageNormalized = normalizeCallStage(callStageRaw);
  const otherChannelNormalized = normalizeOtherChannel(otherChannelRaw);

  const linkedinCount =
    linkedInStageCounts(linkedinStageRaw, linkedinStageNormalized) || linkedinDate
      ? 1
      : 0;
  const emailCount =
    emailStageCounts(emailStageRaw, emailStageNormalized) || emailDate ? 1 : 0;
  const callCount =
    callStageCounts(callStageRaw, callStageNormalized) || callDate ? 1 : 0;
  const otherChannelCount =
    otherChannelNormalized !== "none" || otherChannelDate ? 1 : 0;
  const noPickupCount = callStageNormalized === "no_pick_up" ? 1 : 0;
  const notInterestedCount =
    callStageNormalized === "not_interested" ||
    linkedinStageNormalized === "not_interested" ||
    containsNotInterested(noteCombined)
      ? 1
      : 0;

  const baseRow = {
    rowIndex,
    sdrName: getSdrName(rawRow, mapping),
    leadName: getValue(rawRow, mapping, "leadName"),
    companyName: getValue(rawRow, mapping, "companyName"),
    website: getValue(rawRow, mapping, "website"),
    title: getValue(rawRow, mapping, "title"),
    contactLinkedInUrl: getValue(rawRow, mapping, "contactLinkedInUrl"),
    email: getValue(rawRow, mapping, "email"),
    phone: getValue(rawRow, mapping, "phone"),
    companyCountry: getValue(rawRow, mapping, "companyCountry"),
    contactCountry: getValue(rawRow, mapping, "contactCountry"),
    companyLinkedInUrl: getValue(rawRow, mapping, "companyLinkedInUrl"),
    companyIndustry: getValue(rawRow, mapping, "companyIndustry"),
    companyStaffCountRange: getValue(rawRow, mapping, "companyStaffCountRange"),
    activityDate: getValue(rawRow, mapping, "activityDate"),
    weekLabel: getValue(rawRow, mapping, "weekLabel"),
    linkedinStageRaw,
    linkedinStageNormalized,
    emailStageRaw,
    emailStageNormalized,
    callStageRaw,
    callStageNormalized,
    otherChannelRaw,
    otherChannelNormalized,
    noteCombined,
    meetingDate: getValue(rawRow, mapping, "meetingDate"),
    meetingStatus: getValue(rawRow, mapping, "meetingStatus"),
    channelResponded: getValue(rawRow, mapping, "channelResponded"),
    linkedinCount,
    emailCount,
    callCount,
    noPickupCount,
    notInterestedCount,
    otherChannelCount,
    totalActivityCount:
      linkedinCount + emailCount + callCount + otherChannelCount,
    rawRow,
  } satisfies Omit<
    StandardizedSdrActivityRow,
    "managerReviewFlag" | "managerReviewPriority" | "managerReviewReasons"
  >;

  const review = evaluateManagerReviewRules(baseRow);

  return {
    ...baseRow,
    ...review,
  };
}

function getValue(
  row: Record<string, string>,
  mapping: ActivityColumnMapping,
  field: keyof ActivityColumnMapping
) {
  const selectedColumn = mapping[field]?.[0];
  if (!selectedColumn) {
    return "";
  }

  return (row[selectedColumn] ?? "").trim();
}

function getCombinedValue(row: Record<string, string>, columns?: string[]) {
  return (columns ?? [])
    .map((column) => (row[column] ?? "").trim())
    .filter(Boolean)
    .join(" | ");
}

function getSdrName(row: Record<string, string>, mapping: ActivityColumnMapping) {
  const explicit = getValue(row, mapping, "sdrName");
  if (explicit) {
    return explicit;
  }

  const listHeader = Object.keys(row).find((header) => header.toLowerCase() === "list");
  const listValue = listHeader ? row[listHeader] : "";
  const parsed = parseSdrFromListName(listValue);

  return parsed || "Unknown SDR";
}

function parseSdrFromListName(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const match = trimmed.match(/(?:tele|pmax)[^_]*_\d{1,2}\.\d{1,2}_([a-z][a-z .'-]*)/i);
  if (match?.[1]) {
    return titleCase(match[1]);
  }

  const lastSegment = trimmed.split("_").at(-1)?.trim();
  if (lastSegment && /^[a-z][a-z .'-]*$/i.test(lastSegment)) {
    return titleCase(lastSegment);
  }

  return "";
}

function normalizeLinkedInStage(value: string): LinkedInStageNormalized {
  const normalized = value.toLowerCase();
  if (!normalized) {
    return "none";
  }
  if (/\b(not interested|ni)\b/.test(normalized)) {
    return "not_interested";
  }
  if (/\breplied|reply|got response\b/.test(normalized)) {
    return "replied";
  }
  if (/\bconnected|accepted\b/.test(normalized)) {
    return "connected";
  }
  if (/\bmess|message\b/.test(normalized)) {
    return "message";
  }
  if (/\bsent|linkedin sent|1st message\b/.test(normalized)) {
    return "sent";
  }
  return "none";
}

function normalizeEmailStage(value: string): EmailStageNormalized {
  const normalized = value.toLowerCase();
  if (!normalized || normalized.includes("validation")) {
    return "none";
  }
  if (/\bbounce|bounced\b/.test(normalized)) {
    return "bounced";
  }
  if (/\breplied|reply|got response\b/.test(normalized)) {
    return "replied";
  }
  if (/\b(sent|true|1st email|email sent)\b/.test(normalized)) {
    return "sent";
  }
  return "none";
}

function normalizeCallStage(value: string): CallStageNormalized {
  const normalized = value.toLowerCase();
  if (!normalized) {
    return "none";
  }
  if (/\b(npu|no pick\s?up|no pickup|call no pickup)\b/.test(normalized)) {
    return "no_pick_up";
  }
  if (/\b(not interested|ni)\b/.test(normalized)) {
    return "not_interested";
  }
  if (/\b(call back|callback)\b/.test(normalized)) {
    return "callback";
  }
  if (/\b(pu|pickup|pick up|call pick up)\b/.test(normalized)) {
    return "pickup";
  }
  if (/\b(true|made|called|call made)\b/.test(normalized)) {
    return "made";
  }
  return "none";
}

function normalizeOtherChannel(value: string): OtherChannelNormalized {
  const normalized = value.toLowerCase();
  if (!normalized) {
    return "none";
  }
  if (/\b(wa|whatsapp)\b/.test(normalized)) {
    return "whatsapp";
  }
  if (/\bzalo\b/.test(normalized)) {
    return "zalo";
  }
  if (/\b(other|social)\b/.test(normalized)) {
    return "other";
  }
  return "none";
}

function linkedInStageCounts(
  raw: string,
  normalized: LinkedInStageNormalized
) {
  return (
    normalized === "sent" ||
    normalized === "message" ||
    normalized === "connected" ||
    normalized === "replied" ||
    /\blinkedin (sent|mess|message)\b/i.test(raw)
  );
}

function emailStageCounts(raw: string, normalized: EmailStageNormalized) {
  if (raw.toLowerCase().includes("validation")) {
    return false;
  }

  return normalized === "sent" || normalized === "replied";
}

function callStageCounts(raw: string, normalized: CallStageNormalized) {
  return (
    normalized !== "none" ||
    /\b(pu|npu|pickup|no pick\s?up|made|true|not interested|callback)\b/i.test(raw)
  );
}

function containsNotInterested(note: string) {
  const normalized = note.toLowerCase();
  return normalized.includes("not interested") && !normalized.includes("not relevant");
}

function titleCase(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

