// Default BullMQ job options per queue kind. Pure — no Redis. Research/AI work gets
// more attempts + longer backoff (provider flakiness); everything else is lighter.
// Retention keeps a bounded history for the runtime status UI without unbounded growth.

export type V2JobOptions = {
  attempts: number;
  backoff: { type: "exponential"; delay: number };
  removeOnComplete: { age: number; count: number };
  removeOnFail: { age: number; count: number };
};

export function defaultJobOptions(queueName: string): V2JobOptions {
  const heavy = queueName.startsWith("v2.research.") || queueName.startsWith("v2.ai.");
  return {
    attempts: heavy ? 4 : 3,
    backoff: { type: "exponential", delay: heavy ? 15_000 : 5_000 },
    removeOnComplete: {
      age: numEnv("V2_BULL_REMOVE_COMPLETED_AGE_SECONDS", 86_400),
      count: numEnv("V2_BULL_REMOVE_COMPLETED_COUNT", 10_000),
    },
    removeOnFail: {
      age: numEnv("V2_BULL_REMOVE_FAILED_AGE_SECONDS", 604_800),
      count: numEnv("V2_BULL_REMOVE_FAILED_COUNT", 50_000),
    },
  };
}

function numEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
