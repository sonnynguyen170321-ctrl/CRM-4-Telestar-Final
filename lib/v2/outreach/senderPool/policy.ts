// O3 / design B6+B9: pure sender-pool + warmup policy. No DB, no network.
// The selector routes a send to a healthy sender with remaining warmup-adjusted
// cap; the warmup policy advances/rolls back a MAILBOX's daily cap by health.

export type SenderKind = "RELAY" | "MAILBOX";
export type SenderStatus = "ACTIVE" | "PAUSED" | "DEGRADED" | "DISABLED";

export type SenderForSelection = {
  id: string;
  kind: SenderKind;
  status: SenderStatus;
  dailyCapCurrent: number;
  dailyCapTarget: number;
  warmupStage: number;
  bounceRate: number;
  complaintRate: number;
  sentToday: number;
  lastSendAt?: Date | string | null;
  displayName?: string | null;
  fromAddress?: string | null;
};

export type HealthThresholds = {
  maxBounceRate: number; // e.g. 0.03 (3%)
  maxComplaintRate: number; // e.g. 0.001 (0.1%)
};

export const DEFAULT_HEALTH_THRESHOLDS: HealthThresholds = {
  maxBounceRate: 0.03,
  maxComplaintRate: 0.001,
};

const WARMUP_SEED_CAP = 20;
const WARMUP_RAMP_FACTOR = 1.3;

/** Effective daily cap: RELAY uses its target; a MAILBOX is bounded by warmup. */
export function effectiveDailyCap(sender: Pick<SenderForSelection, "kind" | "dailyCapCurrent" | "dailyCapTarget">): number {
  if (sender.kind === "RELAY") {
    return Math.max(0, sender.dailyCapTarget);
  }
  const current = sender.dailyCapCurrent > 0 ? sender.dailyCapCurrent : WARMUP_SEED_CAP;
  return Math.max(0, Math.min(current, sender.dailyCapTarget));
}

export function remainingCap(sender: SenderForSelection): number {
  return Math.max(0, effectiveDailyCap(sender) - Math.max(0, sender.sentToday));
}

export function isHealthy(
  sender: Pick<SenderForSelection, "status" | "bounceRate" | "complaintRate">,
  thresholds: HealthThresholds = DEFAULT_HEALTH_THRESHOLDS
): boolean {
  return (
    sender.status === "ACTIVE" &&
    sender.bounceRate <= thresholds.maxBounceRate &&
    sender.complaintRate <= thresholds.maxComplaintRate
  );
}

/** True when this send would exceed the warmup-adjusted cap (B6). */
export function wouldExceedCap(sentToday: number, effectiveCap: number): boolean {
  return sentToday >= effectiveCap;
}

/**
 * Pick a sender: healthy + remaining cap > 0 (+ matching kind if requested),
 * preferring the most remaining capacity, tiebroken by least-recently-used.
 * Returns null when no sender can take the send.
 */
export function selectSender(
  candidates: readonly SenderForSelection[],
  options: { kind?: SenderKind; thresholds?: HealthThresholds } = {}
): SenderForSelection | null {
  const thresholds = options.thresholds ?? DEFAULT_HEALTH_THRESHOLDS;
  const eligible = candidates.filter(
    (s) =>
      (!options.kind || s.kind === options.kind) &&
      isHealthy(s, thresholds) &&
      remainingCap(s) > 0
  );
  if (eligible.length === 0) {
    return null;
  }
  eligible.sort((a, b) => {
    const byRemaining = remainingCap(b) - remainingCap(a);
    if (byRemaining !== 0) return byRemaining;
    return lastSendMs(a) - lastSendMs(b); // LRU
  });
  return eligible[0];
}

function lastSendMs(s: SenderForSelection): number {
  if (!s.lastSendAt) return 0;
  const d = s.lastSendAt instanceof Date ? s.lastSendAt : new Date(s.lastSendAt);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

export type WarmupUpdate = {
  dailyCapCurrent: number;
  warmupStage: number;
  status: SenderStatus;
  rolledBack: boolean;
};

/**
 * Daily warmup tick for a MAILBOX (B9): on a healthy day, ramp the current cap
 * toward target and advance the stage; on bad health, roll back (halve the cap,
 * floor at the seed) and mark DEGRADED. RELAY senders do not warm up.
 */
export function advanceWarmup(
  sender: SenderForSelection,
  signal: { healthy: boolean },
  thresholds: HealthThresholds = DEFAULT_HEALTH_THRESHOLDS
): WarmupUpdate {
  if (sender.kind === "RELAY") {
    return { dailyCapCurrent: sender.dailyCapCurrent, warmupStage: sender.warmupStage, status: sender.status, rolledBack: false };
  }
  const healthy = signal.healthy && isHealthy(sender, thresholds);
  const current = sender.dailyCapCurrent > 0 ? sender.dailyCapCurrent : WARMUP_SEED_CAP;

  if (!healthy) {
    return {
      dailyCapCurrent: Math.max(WARMUP_SEED_CAP, Math.floor(current / 2)),
      warmupStage: Math.max(0, sender.warmupStage - 1),
      status: "DEGRADED",
      rolledBack: true,
    };
  }

  const next = Math.min(sender.dailyCapTarget, Math.max(WARMUP_SEED_CAP, Math.ceil(current * WARMUP_RAMP_FACTOR)));
  return {
    dailyCapCurrent: next,
    warmupStage: sender.warmupStage + 1,
    status: "ACTIVE",
    rolledBack: false,
  };
}

/** A MAILBOX counts toward steady-state volume only after a minimum warmup stage (O9). */
export function isWarmedForSteadyState(sender: Pick<SenderForSelection, "kind" | "warmupStage">, minStage = 4): boolean {
  return sender.kind === "RELAY" || sender.warmupStage >= minStage;
}
