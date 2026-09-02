import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

// D0: zero-dependency dev/perf observability. `traceQuery` wraps a DB call to record its
// label + duration (+ optional rowCount); `withSpan` groups a page loader's queries via
// AsyncLocalStorage and emits ONE summary ("span: N queries, M ms") plus the slowest
// breakdown when it blows a budget. OpenTelemetry-SHAPED (span name + attributes) so a
// real exporter (OTel/Sentry) is a later drop-in — the default sink is dev-console +
// a prod JSON line. No PII: labels + timings only (Invariant 9). Inert in prod unless
// V2_TRACE=1, so it never adds overhead to real traffic.

export type QueryRecord = { label: string; durationMs: number; rowCount: number | null };

type SpanContext = { name: string; queries: QueryRecord[]; startedAt: number };

const als = new AsyncLocalStorage<SpanContext>();

const SLOW_QUERY_MS = numberEnv("V2_TRACE_SLOW_QUERY_MS", 200);
const SLOW_LOADER_MS = numberEnv("V2_TRACE_SLOW_LOADER_MS", 500);
const LOADER_QUERY_BUDGET = numberEnv("V2_TRACE_QUERY_BUDGET", 8);

function numberEnv(key: string, fallback: number): number {
  const raw = Number(process.env[key]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function isEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.V2_TRACE === "1";
}

// ---- pure policy (unit-tested by the smoke; no clock, no I/O) ---------------------------

export function isSlowLoader(input: {
  queryCount: number;
  totalMs: number;
  queryBudget?: number;
  slowLoaderMs?: number;
}): boolean {
  const budget = input.queryBudget ?? LOADER_QUERY_BUDGET;
  const slowMs = input.slowLoaderMs ?? SLOW_LOADER_MS;
  return input.queryCount > budget || input.totalMs >= slowMs;
}

export function topSlowQueries(records: readonly QueryRecord[], n = 5): QueryRecord[] {
  return [...records].sort((a, b) => b.durationMs - a.durationMs).slice(0, n);
}

// ---- runtime instrument -----------------------------------------------------------------

/** Group every traceQuery inside `fn` under one named span and emit a summary. */
export async function withSpan<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (!isEnabled()) return fn();
  const ctx: SpanContext = { name, queries: [], startedAt: Date.now() };
  return als.run(ctx, async () => {
    try {
      return await fn();
    } finally {
      emitSummary(ctx);
    }
  });
}

/** Time a single DB call, attach it to the active span (if any), and warn if slow. */
export async function traceQuery<T>(
  label: string,
  fn: () => Promise<T>,
  rowCountOf?: (result: T) => number
): Promise<T> {
  if (!isEnabled()) return fn();
  const start = Date.now();
  const result = await fn();
  const durationMs = Date.now() - start;
  const rowCount = rowCountOf ? safeRowCount(result, rowCountOf) : null;
  const ctx = als.getStore();
  if (ctx) ctx.queries.push({ label, durationMs, rowCount });
  if (durationMs >= SLOW_QUERY_MS && process.env.NODE_ENV !== "production") {
    line(`SLOW QUERY  ${durationMs}ms  ${label}${rowCount != null ? `  (${rowCount} rows)` : ""}`);
  }
  return result;
}

function safeRowCount<T>(result: T, rowCountOf: (result: T) => number): number | null {
  try {
    const n = rowCountOf(result);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function emitSummary(ctx: SpanContext): void {
  const totalMs = Date.now() - ctx.startedAt;
  const queryCount = ctx.queries.length;
  if (process.env.NODE_ENV === "production") {
    // One structured line for a prod log pipeline (timings only).
    line(JSON.stringify({ v2trace: { span: ctx.name, queries: queryCount, ms: totalMs } }));
    return;
  }
  if (!isSlowLoader({ queryCount, totalMs })) return;
  line(`SLOW LOADER  ${ctx.name} — ${queryCount} queries, ${totalMs}ms (budget ${LOADER_QUERY_BUDGET}q/${SLOW_LOADER_MS}ms)`);
  for (const q of topSlowQueries(ctx.queries)) {
    line(`   ${q.durationMs}ms  ${q.label}${q.rowCount != null ? `  (${q.rowCount} rows)` : ""}`);
  }
}

function line(message: string): void {
  console.log(`[v2trace] ${message}`);
}
