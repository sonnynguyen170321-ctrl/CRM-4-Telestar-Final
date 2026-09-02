import { createHash } from "node:crypto";

import type {
  ActivityChannel,
  ActivityExpansionResult,
  ActivityOutcome,
  ActivityType,
  ComputeSourceActivityHashInput,
  ExpandActivityRowsFromRawRowInput,
  ExpandedActivityEvent,
  NormalizeActivityRowInput,
  NormalizeActivityRowResult,
  RawActivityRecapRow,
  TimestampQuality,
  WideRowChannelMapping,
} from "./types";

const FIELD_ALIASES = {
  activityDate: ["activityDate", "activity_date", "date", "activity date"],
  sdrUser: ["sdrUser", "sdr", "owner", "rep", "user"],
  clientAccount: ["clientAccount", "client", "account", "client account"],
  project: ["project", "campaign"],
  companyName: ["companyName", "company", "company name", "account name"],
  companyWebsite: ["website", "companyWebsite", "company website", "domain"],
  contactName: ["contactName", "contact", "full name", "name"],
  contactEmail: ["email", "contactEmail", "contact email"],
  contactPhone: ["phone", "contactPhone", "contact phone"],
  contactLinkedIn: [
    "linkedin",
    "linkedIn",
    "contactLinkedIn",
    "contact linkedin",
  ],
  channel: ["channel"],
  rawStatus: ["status", "rawStatus", "activity status", "result"],
  note: ["note", "notes", "comment", "remarks"],
} as const;

export function normalizeActivityRow(
  input: NormalizeActivityRowInput
): NormalizeActivityRowResult {
  return normalizeActivityRowWithMetadata({
    input,
    eventIndexWithinRow: 0,
  });
}

export function expandActivityRowsFromRawRow(
  input: ExpandActivityRowsFromRawRowInput
): ActivityExpansionResult {
  if (input.importRowKind === "lead_snapshot") {
    return {
      events: [],
      warnings: ["lead_snapshot_does_not_create_activity_events"],
      importRowKind: input.importRowKind,
      requiresManagerReview: false,
    };
  }

  if (input.importRowKind === "pipeline_snapshot") {
    return {
      events: [],
      warnings: ["pipeline_snapshot_does_not_reconstruct_full_history"],
      importRowKind: input.importRowKind,
      requiresManagerReview: false,
    };
  }

  if (input.importRowKind === "meeting_tracker") {
    return {
      events: [],
      warnings: ["meeting_tracker_expansion_deferred"],
      importRowKind: input.importRowKind,
      requiresManagerReview: false,
    };
  }

  if (input.importRowKind === "unknown_mixed") {
    return {
      events: [],
      warnings: ["user_profile_confirmation_required"],
      importRowKind: input.importRowKind,
      requiresManagerReview: true,
    };
  }

  if (input.importRowKind === "activity_event") {
    const event = buildExpandedActivityEvent({
      input,
      eventIndexWithinRow: 0,
      sourceColumnName: null,
      rawStage: readField(input.rawRow, FIELD_ALIASES.rawStatus),
      rawTimestamp: readField(input.rawRow, FIELD_ALIASES.activityDate),
    });

    return {
      events: [event],
      warnings: event.warnings,
      importRowKind: input.importRowKind,
      requiresManagerReview: shouldRequireManagerReview(event),
    };
  }

  const events: ExpandedActivityEvent[] = [];
  const warnings: string[] = [];
  const mappings = input.wideRowChannelMappings ?? [];

  if (mappings.length === 0) {
    warnings.push("wide_activity_bundle_missing_mappings");
  }

  for (const mapping of mappings) {
    const rawStage = readColumn(input.rawRow, mapping.stageColumn);
    const rawNote = mapping.noteColumn
      ? readColumn(input.rawRow, mapping.noteColumn)
      : null;
    const rawTimestamp = mapping.dateColumn
      ? readColumn(input.rawRow, mapping.dateColumn)
      : readField(input.rawRow, FIELD_ALIASES.activityDate);

    if (!hasUsableActivitySignal(rawStage, rawNote)) {
      continue;
    }

    const event = buildExpandedActivityEvent({
      input: {
        ...input,
        rawRow: buildExpandedRawRow(input.rawRow, mapping, rawStage, rawTimestamp, rawNote),
      },
      originalRawRow: input.rawRow,
      eventIndexWithinRow: events.length,
      sourceColumnName: mapping.sourceColumnName ?? mapping.stageColumn,
      rawStage,
      rawTimestamp,
    });

    events.push(event);
    warnings.push(...event.warnings);
  }

  return {
    events,
    warnings,
    importRowKind: input.importRowKind,
    requiresManagerReview:
      warnings.length > 0 || events.some((event) => shouldRequireManagerReview(event)),
  };
}

function normalizeActivityRowWithMetadata({
  input,
  originalRawRow = input.rawRow,
  eventIndexWithinRow,
  sourceColumnName = null,
  rawStage,
  rawTimestamp,
}: {
  input: NormalizeActivityRowInput;
  originalRawRow?: RawActivityRecapRow;
  eventIndexWithinRow: number;
  sourceColumnName?: string | null;
  rawStage?: string | null;
  rawTimestamp?: string | null;
}): NormalizeActivityRowResult {
  const rawChannel = readField(input.rawRow, FIELD_ALIASES.channel);
  const rawStatus = readField(input.rawRow, FIELD_ALIASES.rawStatus);
  const note = readField(input.rawRow, FIELD_ALIASES.note);
  const warnings: string[] = [];

  const channel = normalizeActivityChannel(rawChannel);
  const activityType = normalizeActivityType(firstPresent(rawStatus, note, rawChannel));
  const outcome = normalizeActivityOutcome(firstPresent(rawStatus, note));
  const activityDate = readField(input.rawRow, FIELD_ALIASES.activityDate);
  const sourceRowHash = computeSourceRowHash(originalRawRow);

  if (channel === "other" && normalizeText(rawChannel) !== null) {
    warnings.push("unknown_channel");
  }

  if (activityType === "other" && firstPresent(rawStatus, note, rawChannel) !== null) {
    warnings.push("unknown_activity_type");
  }

  if (outcome === "unknown" && firstPresent(rawStatus, note) !== null) {
    warnings.push("unknown_outcome");
  }

  return {
    row: {
      activityDate: readField(input.rawRow, FIELD_ALIASES.activityDate),
      sdrUser: readField(input.rawRow, FIELD_ALIASES.sdrUser),
      clientAccount: readField(input.rawRow, FIELD_ALIASES.clientAccount),
      project: readField(input.rawRow, FIELD_ALIASES.project),
      companyName: readField(input.rawRow, FIELD_ALIASES.companyName),
      companyWebsite: readField(input.rawRow, FIELD_ALIASES.companyWebsite),
      contactName: readField(input.rawRow, FIELD_ALIASES.contactName),
      contactEmail: readField(input.rawRow, FIELD_ALIASES.contactEmail),
      contactPhone: readField(input.rawRow, FIELD_ALIASES.contactPhone),
      contactLinkedIn: readField(input.rawRow, FIELD_ALIASES.contactLinkedIn),
      channel,
      activityType,
      outcome,
      rawStatus,
      note,
      sourceFileName: normalizeText(input.sourceFileName),
      sourceSheetName: normalizeText(input.sourceSheetName),
      sourceRowNumber: input.sourceRowNumber,
      sourceRowHash,
      sourceActivityHash: computeSourceActivityHash({
        sourceRowHash,
        channel,
        sourceColumnName,
        rawStage: rawStage ?? rawStatus,
        rawTimestamp: rawTimestamp ?? activityDate,
        eventIndexWithinRow,
      }),
    },
    warnings,
  };
}

export function computeSourceRowHash(rawRow: RawActivityRecapRow): string {
  const sortedRow: Record<string, unknown> = {};

  for (const key of Object.keys(rawRow).sort()) {
    const value = rawRow[key];
    // Undefined is normalized to null so object shape remains stable by key.
    sortedRow[key] = value === undefined ? null : value;
  }

  return createHash("sha256")
    .update(JSON.stringify(sortedRow))
    .digest("hex");
}

export function computeSourceActivityHash(
  input: ComputeSourceActivityHashInput
): string {
  // Contract-only hash for event candidates; not DB dedupe or persistence runtime.
  return createHash("sha256")
    .update(
      [
        input.sourceRowHash,
        input.channel,
        normalizeHashPart(input.sourceColumnName),
        normalizeHashPart(input.rawStage),
        normalizeHashPart(input.rawTimestamp),
        String(input.eventIndexWithinRow),
      ].join("")
    )
    .digest("hex");
}

export function parseTimestampQuality(value: unknown): TimestampQuality {
  if (Array.isArray(value)) {
    const normalizedValues = value
      .map(normalizeText)
      .filter((item): item is string => item !== null);
    const uniqueValues = new Set(normalizedValues);

    if (uniqueValues.size > 1) {
      return "conflicting";
    }

    return parseTimestampQuality(normalizedValues[0] ?? null);
  }

  const text = normalizeText(value);

  if (text === null) {
    return "missing";
  }

  if (/[|,;]/.test(text)) {
    const uniqueValues = new Set(
      text
        .split(/[|,;]/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    );

    if (uniqueValues.size > 1) {
      return "conflicting";
    }
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(text) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(text)) {
    return "date_only";
  }

  if (!Number.isNaN(Date.parse(text))) {
    return /(\d{1,2}:\d{2}|am\b|pm\b|t\d{2}:?\d{2})/i.test(text)
      ? "exact_datetime"
      : "date_only";
  }

  if (/\b(yesterday|today|tomorrow|last|next)\b/i.test(text)) {
    return "inferred_from_note";
  }

  return "unparseable";
}

export function normalizeActivityChannel(value: unknown): ActivityChannel {
  const normalized = normalizeLookupValue(value);

  if (normalized === null) {
    return "other";
  }

  if (["email", "mail"].includes(normalized)) {
    return "email";
  }

  if (["linkedin", "linked in", "li"].includes(normalized)) {
    return "linkedin";
  }

  if (["call", "phone", "cold call"].includes(normalized)) {
    return "call";
  }

  if (["whatsapp", "wa"].includes(normalized)) {
    return "whatsapp";
  }

  if (normalized === "zalo") {
    return "zalo";
  }

  if (["meeting", "meet"].includes(normalized)) {
    return "meeting";
  }

  if (["note", "manual note"].includes(normalized)) {
    return "manual_note";
  }

  return "other";
}

export function normalizeActivityType(value: unknown): ActivityType {
  const normalized = normalizeLookupValue(value);

  if (normalized === null) {
    return "other";
  }

  if (matchesAny(normalized, ["bounce", "bounced"])) {
    return "new_email";
  }

  if (matchesAny(normalized, ["positive reply", "replied", "interested"])) {
    return "positive_reply";
  }

  if (matchesAny(normalized, ["meeting booked", "booked meeting"])) {
    return "meeting_booked";
  }

  if (matchesAny(normalized, ["meeting done", "meeting completed", "attended"])) {
    return "meeting_done";
  }

  if (matchesAny(normalized, ["connection request", "connect request"])) {
    return "linkedin_connection";
  }

  if (matchesAny(normalized, ["linkedin message", "li message"])) {
    return "linkedin_message";
  }

  if (matchesAny(normalized, ["no pick up", "no pickup", "no answer"])) {
    return "no_pick_up";
  }

  if (matchesAny(normalized, ["call connected", "pickup", "picked up"])) {
    return "call_connected";
  }

  if (matchesAny(normalized, ["call attempt", "cold call"])) {
    return "call_attempt";
  }

  if (matchesAny(normalized, ["not interested"])) {
    return "not_interested";
  }

  if (matchesAny(normalized, ["wrong contact", "wrong person"])) {
    return "wrong_contact";
  }

  if (matchesAny(normalized, ["whatsapp message", "wa message"])) {
    return "whatsapp_message";
  }

  if (matchesAny(normalized, ["follow up", "follow-up"])) {
    return "follow_up_email";
  }

  if (matchesAny(normalized, ["manual note", "note"])) {
    return "manual_note";
  }

  if (matchesAny(normalized, ["email sent", "new email", "first email"])) {
    return "new_email";
  }

  return "other";
}

export function normalizeActivityOutcome(value: unknown): ActivityOutcome {
  const normalized = normalizeLookupValue(value);

  if (normalized === null) {
    return "unknown";
  }

  if (matchesAny(normalized, ["positive reply", "positive response", "replied", "interested"])) {
    return "positive_response";
  }

  if (matchesAny(normalized, ["meeting booked", "booked meeting"])) {
    return "meeting_booked";
  }

  if (matchesAny(normalized, ["meeting done", "meeting completed", "attended"])) {
    return "meeting_done";
  }

  if (matchesAny(normalized, ["follow up", "follow-up", "callback"])) {
    return "follow_up_needed";
  }

  if (matchesAny(normalized, ["no response", "no reply"])) {
    return "no_response";
  }

  if (matchesAny(normalized, ["no pick up", "no pickup", "no answer"])) {
    return "no_pick_up";
  }

  if (matchesAny(normalized, ["not interested"])) {
    return "not_interested";
  }

  if (matchesAny(normalized, ["bad fit", "not fit"])) {
    return "bad_fit";
  }

  if (matchesAny(normalized, ["wrong person", "wrong contact"])) {
    return "wrong_person";
  }

  if (matchesAny(normalized, ["bounce", "bounced"])) {
    return "bounced";
  }

  if (matchesAny(normalized, ["duplicate", "dupe"])) {
    return "duplicate";
  }

  return "unknown";
}

export function normalizeText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();

  return text.length > 0 ? text : null;
}

function readField(
  row: RawActivityRecapRow,
  aliases: readonly string[]
): string | null {
  const normalizedAliases = new Set(aliases.map(normalizeKey));

  for (const [key, value] of Object.entries(row)) {
    if (normalizedAliases.has(normalizeKey(key))) {
      return normalizeText(value);
    }
  }

  return null;
}

function readColumn(row: RawActivityRecapRow, columnName: string): string | null {
  for (const [key, value] of Object.entries(row)) {
    if (normalizeKey(key) === normalizeKey(columnName)) {
      return normalizeText(value);
    }
  }

  return null;
}

function buildExpandedRawRow(
  rawRow: RawActivityRecapRow,
  mapping: WideRowChannelMapping,
  rawStage: string | null,
  rawTimestamp: string | null,
  rawNote: string | null
): RawActivityRecapRow {
  return {
    ...rawRow,
    channel: mapping.channel,
    rawStatus: rawStage,
    activityDate: rawTimestamp,
    note: rawNote,
  };
}

function buildExpandedActivityEvent({
  input,
  originalRawRow = input.rawRow,
  eventIndexWithinRow,
  sourceColumnName,
  rawStage,
  rawTimestamp,
}: {
  input: NormalizeActivityRowInput;
  originalRawRow?: RawActivityRecapRow;
  eventIndexWithinRow: number;
  sourceColumnName?: string | null;
  rawStage?: string | null;
  rawTimestamp?: string | null;
}): ExpandedActivityEvent {
  const normalized = normalizeActivityRowWithMetadata({
    input,
    originalRawRow,
    eventIndexWithinRow,
    sourceColumnName,
    rawStage,
    rawTimestamp,
  });
  const timestampQuality = parseTimestampQuality(rawTimestamp);
  const warnings = [...normalized.warnings];

  if (timestampQuality === "missing") {
    warnings.push("missing_timestamp");
  } else if (timestampQuality === "unparseable") {
    warnings.push("unparseable_timestamp");
  } else if (timestampQuality === "conflicting") {
    warnings.push("conflicting_timestamp");
  }

  return {
    row: normalized.row,
    eventIndexWithinRow,
    sourceColumnName,
    timestampQuality,
    warnings,
  };
}

function shouldRequireManagerReview(event: ExpandedActivityEvent): boolean {
  return event.warnings.some((warning) =>
    [
      "missing_timestamp",
      "unparseable_timestamp",
      "conflicting_timestamp",
      "unknown_channel",
      "unknown_activity_type",
      "unknown_outcome",
    ].includes(warning)
  );
}

function hasUsableActivitySignal(
  rawStage: string | null,
  rawNote: string | null
): boolean {
  return rawStage !== null || rawNote !== null;
}

function normalizeHashPart(value: string | null | undefined): string {
  return value ?? "";
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeLookupValue(value: unknown): string | null {
  const text = normalizeText(value);

  return text?.toLowerCase().replace(/\s+/g, " ") ?? null;
}

function firstPresent(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = normalizeText(value);

    if (normalized !== null) {
      return normalized;
    }
  }

  return null;
}

function matchesAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => value.includes(pattern));
}
