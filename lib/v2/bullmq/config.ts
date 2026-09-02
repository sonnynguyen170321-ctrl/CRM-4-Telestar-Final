// BullMQ runtime configuration — pure env reads, no side effects, no Redis import.
// Importing this file never touches Redis; it only answers "is BullMQ turned on?" and
// supplies prefixes/ids. The whole BullMQ layer stays INERT until V2_BULL_ENABLED is
// truthy, so local dev (and any machine without Redis) runs exactly as before.

export function isBullEnabled(): boolean {
  const value = (process.env.V2_BULL_ENABLED ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "on" || value === "yes";
}

export function bullPrefix(): string {
  // The `{...}` hash tag forces every BullMQ key onto one Redis slot. Required on
  // cluster-mode Redis (e.g. ElastiCache Serverless) where multi-key ops otherwise
  // fail with CROSSSLOT; harmless on single-node Redis. Keep the braces if overriding.
  return process.env.V2_BULL_PREFIX?.trim() || "{telestar:v2}";
}

export function bullWorkerId(): string {
  return process.env.V2_BULL_WORKER_ID?.trim() || `v2-worker-${process.pid}`;
}

/** The Redis URL — required only when BullMQ is enabled; throws a clear error otherwise. */
export function requireRedisUrl(): string {
  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    throw new Error("REDIS_URL is required when V2_BULL_ENABLED is true (BullMQ runtime).");
  }
  return url;
}
