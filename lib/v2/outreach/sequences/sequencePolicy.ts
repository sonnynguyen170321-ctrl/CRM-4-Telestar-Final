// O5 / design B8+B12: pure sequence policy — enrollment idempotency, halt rules
// (stop on reply/bounce/meeting), next-step decision, send window. No DB/network.

export type EnrollmentStatus = "ACTIVE" | "PAUSED" | "COMPLETED" | "HALTED";

export type SequenceConfig = {
  stopOnReply: boolean;
  stopOnBounce: boolean;
  stopOnMeeting: boolean;
  maxTouches?: number | null;
};

export type SequenceStepLite = {
  ordinal: number;
  kind: "EMAIL" | "WAIT" | "BRANCH" | "CALL_TASK" | "LINKEDIN" | "GOAL";
  delayMinutes: number;
  sendWindow?: SendWindow | null;
};

export type EnrollmentLite = {
  status: EnrollmentStatus;
  currentStepOrdinal: number;
  touchesSent?: number;
};

export type HaltSignals = {
  replied?: boolean;
  bounced?: boolean;
  meetingBooked?: boolean;
};

export function buildEnrollmentIdempotencyKey(input: {
  organizationId: string;
  sequenceId: string;
  leadAssignmentId: string;
}): string {
  return `enroll:${input.organizationId}:${input.sequenceId}:${input.leadAssignmentId}`;
}

/** Stop-on-reply/bounce/meeting (+ max touches). Returns a halt reason or null. */
export function shouldHalt(
  config: SequenceConfig,
  enrollment: EnrollmentLite,
  signals: HaltSignals
): string | null {
  if (config.stopOnBounce && signals.bounced) return "bounced";
  if (config.stopOnReply && signals.replied) return "replied";
  if (config.stopOnMeeting && signals.meetingBooked) return "meeting_booked";
  if (config.maxTouches != null && (enrollment.touchesSent ?? 0) >= config.maxTouches) return "max_touches";
  return null;
}

export type NextStepDecision =
  | { action: "halt"; reason: string }
  | { action: "complete" }
  | { action: "noop"; reason: string }
  | { action: "wait"; nextStepAt: Date; ordinal: number }
  | { action: "defer"; nextStepAt: Date; ordinal: number } // outside send window
  | { action: "execute"; step: SequenceStepLite };

/**
 * Decide what the SEQUENCE_STEP_EXECUTE worker should do for an enrollment. Halt
 * always wins; WAIT steps advance with a delay; sendable steps execute only inside
 * the send window, otherwise defer to the next window open.
 */
export function decideNextStep(input: {
  config: SequenceConfig;
  enrollment: EnrollmentLite;
  steps: readonly SequenceStepLite[];
  signals?: HaltSignals;
  now?: Date;
}): NextStepDecision {
  const now = input.now ?? new Date();

  if (input.enrollment.status !== "ACTIVE") {
    return { action: "noop", reason: `enrollment is ${input.enrollment.status}` };
  }
  const haltReason = shouldHalt(input.config, input.enrollment, input.signals ?? {});
  if (haltReason) {
    return { action: "halt", reason: haltReason };
  }
  const ordinal = input.enrollment.currentStepOrdinal;
  const step = input.steps.find((s) => s.ordinal === ordinal);
  if (!step) {
    return { action: "complete" };
  }
  if (step.kind === "WAIT") {
    return { action: "wait", ordinal: ordinal + 1, nextStepAt: addMinutes(now, step.delayMinutes) };
  }
  if (step.sendWindow && !isWithinSendWindow(now, step.sendWindow)) {
    return { action: "defer", ordinal, nextStepAt: nextWindowOpen(now, step.sendWindow) };
  }
  return { action: "execute", step };
}

// ---------------------------------------------------------------------------
// Send window (B8) — business hours, tenant-tz-aware via a fixed utcOffset.
// ---------------------------------------------------------------------------

export type SendWindow = {
  startHour: number; // 0-23 local
  endHour: number; // 0-23 local (exclusive)
  days?: number[]; // 0=Sun..6=Sat; default Mon-Fri
  utcOffsetMinutes?: number; // tenant tz offset; default 0 (UTC)
};

function localParts(now: Date, offsetMinutes: number): { hour: number; day: number } {
  const shifted = new Date(now.getTime() + offsetMinutes * 60_000);
  return { hour: shifted.getUTCHours(), day: shifted.getUTCDay() };
}

export function isWithinSendWindow(now: Date, window: SendWindow): boolean {
  const days = window.days ?? [1, 2, 3, 4, 5];
  const { hour, day } = localParts(now, window.utcOffsetMinutes ?? 0);
  return days.includes(day) && hour >= window.startHour && hour < window.endHour;
}

export function nextWindowOpen(now: Date, window: SendWindow): Date {
  const days = window.days ?? [1, 2, 3, 4, 5];
  const offset = window.utcOffsetMinutes ?? 0;
  // step forward in 30-min increments up to 8 days until the window opens
  for (let i = 1; i <= 8 * 48; i++) {
    const candidate = new Date(now.getTime() + i * 30 * 60_000);
    const { hour, day } = localParts(candidate, offset);
    if (days.includes(day) && hour >= window.startHour && hour < window.endHour) {
      return candidate;
    }
  }
  return addMinutes(now, 60);
}

function addMinutes(d: Date, m: number): Date {
  return new Date(d.getTime() + m * 60_000);
}
