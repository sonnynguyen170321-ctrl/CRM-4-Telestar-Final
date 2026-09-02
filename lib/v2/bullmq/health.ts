import "server-only";

import { isBullEnabled } from "./config";

// Redis liveness for the runtime health route. Returns "disabled" when BullMQ is off
// (the normal local state) — never an error — so the health route is meaningful on a
// machine without Redis. The connection is loaded lazily inside the enabled branch.

export type RedisHealth = "ok" | "disabled" | "fail";

export async function pingRedis(): Promise<RedisHealth> {
  if (!isBullEnabled()) return "disabled";
  try {
    const { getRedisConnection } = await import("./connection");
    const connection = await getRedisConnection();
    const reply = await connection.ping();
    return reply === "PONG" ? "ok" : "fail";
  } catch {
    return "fail";
  }
}
