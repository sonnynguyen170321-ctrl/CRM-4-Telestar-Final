import type { V2ImportProfile } from "./types";

const COMPANY_HEADERS = ["company", "company_name", "website", "domain", "industry"];
const CONTACT_HEADERS = ["email", "contact", "contact_name", "first_name", "last_name", "linkedin"];
const ACTIVITY_HEADERS = ["activity", "stage", "email_stage", "call_stage", "linkedin_stage"];
const PIPELINE_HEADERS = ["pipeline", "status", "last_activity_time", "modified_time"];
const MEETING_HEADERS = ["date_book", "date_happen", "meeting", "no_show", "rescheduled"];

export function classifyImportProfile(input: {
  headers: string[];
  row?: Record<string, unknown>;
}): V2ImportProfile {
  const keys = new Set([
    ...input.headers.map(normalizeKey),
    ...Object.keys(input.row ?? {}).map(normalizeKey),
  ]);
  const scores = {
    company: countMatches(keys, COMPANY_HEADERS),
    contact: countMatches(keys, CONTACT_HEADERS),
    activity: countMatches(keys, ACTIVITY_HEADERS),
    pipeline: countMatches(keys, PIPELINE_HEADERS),
    meeting: countMatches(keys, MEETING_HEADERS),
  };

  if (scores.meeting >= 2) {
    return "meeting_tracker";
  }

  if (scores.activity >= 2 && countWideActivitySignals(keys) >= 2) {
    return "wide_activity_bundle";
  }

  if (scores.pipeline >= 2 && scores.activity === 0) {
    return "pipeline_snapshot";
  }

  if (scores.activity > 0 && scores.company + scores.contact > 0) {
    return "activity_event";
  }

  if (scores.company > 0 && scores.contact > 0) {
    return "lead_snapshot";
  }

  if (scores.contact > 0) {
    return "contact_upload";
  }

  if (scores.company > 0) {
    return "company_upload";
  }

  return "unknown_mixed";
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function countMatches(keys: Set<string>, candidates: string[]) {
  return candidates.filter((candidate) =>
    [...keys].some((key) => key === candidate || key.includes(candidate))
  ).length;
}

function countWideActivitySignals(keys: Set<string>) {
  return ["email", "call", "linkedin", "whatsapp", "zalo"].filter((channel) =>
    [...keys].some((key) => key.includes(channel) && key.includes("stage"))
  ).length;
}
