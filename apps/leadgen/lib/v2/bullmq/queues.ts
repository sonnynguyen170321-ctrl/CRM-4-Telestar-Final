import "server-only";

import type { Queue } from "bullmq";

import { bullPrefix } from "./config";
import { getRedisConnection } from "./connection";
import { defaultJobOptions } from "./jobOptions";

// Lazy queue accessor. BullMQ is loaded via dynamic import the first time a queue is
// actually needed, and queues are memoised (hot-reload safe in dev). Producers add
// POINTER payloads only (ids), never large rows/blobs — Redis is not a data store.

const queues = new Map<string, Queue>();

export async function getQueue(name: string): Promise<Queue> {
  const existing = queues.get(name);
  if (existing) return existing;
  const { Queue: BullQueue } = await import("bullmq");
  const connection = await getRedisConnection();
  // BullMQ accepts an ioredis instance as `connection`; loosely typed across the
  // dynamic-import boundary.
  const queue = new BullQueue(name, {
    connection: connection as never,
    prefix: bullPrefix(),
  });
  queues.set(name, queue);
  return queue;
}

/** Enqueue a pointer-only job onto a V2 queue with the kind's default options. */
export async function addJob(
  name: string,
  jobName: string,
  data: Record<string, unknown>,
  opts?: { jobId?: string }
): Promise<string | undefined> {
  const queue = await getQueue(name);
  // BullMQ forbids ':' in a custom jobId (its internal key separator). Our dedupe keys
  // use ':' — sanitize here so every caller stays idempotent + bull-safe.
  const jobId = opts?.jobId ? opts.jobId.replace(/:/g, "_") : undefined;
  const job = await queue.add(jobName, data, { ...defaultJobOptions(name), jobId });
  return job.id;
}

export async function closeQueues(): Promise<void> {
  for (const queue of queues.values()) {
    await queue.close().catch(() => undefined);
  }
  queues.clear();
}
