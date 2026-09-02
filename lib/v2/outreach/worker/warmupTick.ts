import { advanceWarmup, isHealthy, type SenderForSelection, type WarmupUpdate } from "../senderPool/policy";

// O5s / design B9: daily warmup tick. For each MAILBOX, advance the cap toward
// target on a healthy day, roll back + DEGRADE on bad health. Pure: the worker
// loads senders, calls this, and persists the updates.

export type SenderWarmupInput = SenderForSelection & {
  // rolling-window health signal (already aggregated from O7 bounce/complaint).
  windowHealthy?: boolean;
};

export type SenderWarmupResult = {
  senderId: string;
  update: WarmupUpdate;
};

export function computeWarmupTick(senders: readonly SenderWarmupInput[]): SenderWarmupResult[] {
  return senders.map((sender) => ({
    senderId: sender.id,
    update: advanceWarmup(sender, { healthy: sender.windowHealthy ?? isHealthy(sender) }),
  }));
}
