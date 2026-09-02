import { buildOutreachActivity, type OutreachActivityRow } from "../send/buildOutreachMessage";

// O6: non-email outreach (calls, LinkedIn touches) write Link A timeline events
// with NO provider/send risk. LinkedIn imports must go through the SHARED identity
// resolver (lib/v2/activity-recaps) — no second resolver (Invariant 1). Pure builders.

export type NonEmailChannel = "call" | "linkedin" | "whatsapp" | "manual_note";

export function buildCallActivity(input: {
  organizationId: string;
  leadAssignmentId: string;
  companyId?: string | null;
  contactId?: string | null;
  actorUserId?: string | null;
  outcome?: string;
  note?: string;
  occurredAt?: Date;
}): OutreachActivityRow {
  return buildOutreachActivity({
    ...input,
    channel: "call",
    eventKind: "outreach.call_logged",
    metadata: { outcome: input.outcome ?? "logged", note: input.note ?? null },
  });
}

export function buildLinkedinActivity(input: {
  organizationId: string;
  leadAssignmentId: string;
  companyId?: string | null;
  contactId?: string | null;
  actorUserId?: string | null;
  action?: "connection" | "message" | "view";
  note?: string;
  occurredAt?: Date;
}): OutreachActivityRow {
  return buildOutreachActivity({
    ...input,
    channel: "linkedin",
    eventKind: `outreach.linkedin_${input.action ?? "message"}`,
    metadata: { note: input.note ?? null },
  });
}

export function buildManualOutreachActivity(input: {
  organizationId: string;
  leadAssignmentId: string;
  channel: NonEmailChannel;
  eventKind: string;
  contactId?: string | null;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
}): OutreachActivityRow {
  return buildOutreachActivity({ ...input });
}
