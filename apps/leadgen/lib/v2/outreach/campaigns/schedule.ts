import type {
  V2CampaignScheduleV1,
  V2CampaignTimezoneMode,
} from "./types";

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
};

const WEEKDAYS: Record<string, LocalParts["weekday"]> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

export function isValidIanaTimezone(timezone: string | null | undefined): timezone is string {
  if (!timezone?.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function resolveCampaignTimezone(input: {
  mode: V2CampaignTimezoneMode;
  leadTimezone?: string | null;
  campaignTimezone?: string | null;
  organizationTimezone?: string | null;
}): string {
  const ordered =
    input.mode === "LEAD"
      ? [input.leadTimezone, input.campaignTimezone, input.organizationTimezone, "UTC"]
      : input.mode === "CAMPAIGN"
        ? [input.campaignTimezone, input.organizationTimezone, "UTC"]
        : [input.organizationTimezone, input.campaignTimezone, "UTC"];
  return ordered.find(isValidIanaTimezone) ?? "UTC";
}

export function validateCampaignSchedule(
  schedule: V2CampaignScheduleV1 | null | undefined
): string[] {
  const errors: string[] = [];
  if (!schedule || schedule.schemaVersion !== "v2.campaign-schedule.v1") {
    return ["Schedule schema is missing or unsupported."];
  }
  if (
    schedule.weekdays.length === 0 ||
    schedule.weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)
  ) {
    errors.push("At least one valid weekday is required.");
  }
  if (!parseTime(schedule.startLocalTime) || !parseTime(schedule.endLocalTime)) {
    errors.push("Schedule times must use HH:mm.");
  }
  if (schedule.startLocalTime === schedule.endLocalTime) {
    errors.push("Schedule start and end cannot be equal.");
  }
  return errors;
}

export function isWithinCampaignWindow(
  instant: Date,
  schedule: V2CampaignScheduleV1,
  timezone: string
): boolean {
  if (validateCampaignSchedule(schedule).length > 0 || !isValidIanaTimezone(timezone)) return false;
  const local = localParts(instant, timezone);
  const start = toMinute(schedule.startLocalTime);
  const end = toMinute(schedule.endLocalTime);
  const current = local.hour * 60 + local.minute;
  if (start < end) {
    return schedule.weekdays.includes(local.weekday) && current >= start && current < end;
  }
  if (current >= start) return schedule.weekdays.includes(local.weekday);
  return current < end && schedule.weekdays.includes(previousWeekday(local.weekday));
}

export function nextCampaignWindow(
  now: Date,
  schedule: V2CampaignScheduleV1,
  timezone: string
): Date {
  const errors = validateCampaignSchedule(schedule);
  if (errors.length > 0) throw new Error(errors.join(" "));
  if (!isValidIanaTimezone(timezone)) throw new Error("Invalid IANA timezone.");
  const candidate = new Date(now);
  candidate.setUTCSeconds(0, 0);
  if (candidate < now) candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  for (let minute = 0; minute <= 8 * 24 * 60; minute++) {
    if (isWithinCampaignWindow(candidate, schedule, timezone)) return candidate;
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }
  throw new Error("No campaign window found in the next eight days.");
}

function localParts(date: Date, timezone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
    weekday: WEEKDAYS[value("weekday")] ?? 1,
  };
}

function parseTime(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

function toMinute(value: string): number {
  const parsed = parseTime(value);
  if (!parsed) return -1;
  return parsed.hour * 60 + parsed.minute;
}

function previousWeekday(day: LocalParts["weekday"]): LocalParts["weekday"] {
  return (day === 1 ? 7 : day - 1) as LocalParts["weekday"];
}