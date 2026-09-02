import "server-only";

import { V2_QUEUE_NAMES } from "./queueNames";
import { addJob } from "./queues";

// The noop queue proves the BullMQ wiring end-to-end (enqueue -> worker -> complete)
// without touching real work. Used by the runtime health check + the bull runner.

export async function enqueueNoop(ping = "ping"): Promise<string | undefined> {
  return addJob(V2_QUEUE_NAMES.noop, "noop", { ping, at: new Date().toISOString() });
}

/** Pure noop processor body (the runner wires this into a BullMQ Worker). */
export function processNoop(data: unknown): { ok: true; echo: unknown } {
  return { ok: true, echo: data };
}
