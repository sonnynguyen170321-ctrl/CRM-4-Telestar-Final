import "server-only";

import { requireRedisUrl } from "./config";

// Lazy ioredis connection. ioredis is loaded via dynamic import ONLY when this runs,
// so importing the BullMQ layer never pulls in Redis on a machine that has it disabled.
// One shared connection is reused across all queues (BullMQ requirement: maxRetries null).

type RedisLike = { 
  ping(): Promise<string>; 
  quit(): Promise<unknown>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: string, duration?: number): Promise<string | null>;
  del(key: string): Promise<number>;
};

let connection: RedisLike | null = null;

export async function getRedisConnection(): Promise<RedisLike> {
  if (connection) return connection;
  const url = requireRedisUrl();
  const { default: IORedis } = await import("ioredis");
  connection = new IORedis(url, { maxRetriesPerRequest: null }) as unknown as RedisLike;
  return connection;
}

/** For graceful shutdown / tests. */
export async function closeRedisConnection(): Promise<void> {
  if (connection) {
    await connection.quit().catch(() => undefined);
    connection = null;
  }
}
