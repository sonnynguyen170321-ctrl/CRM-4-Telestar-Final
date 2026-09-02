# D-Track — Data accuracy, tracing & performance (deep session plan)

Goal (user): "update data structure premium + tracing + wiring từ database/schema cho
chính xác, đảm bảo tất cả page + runtime chạy mượt + nhanh."

This is a **measurement-first hardening initiative**, not one sitting. It is sequenced so
every later optimization is justified by a number, and every "premium" data change is
verified against the real schema. Grounded in a fresh read of the current code (examples
below are real, not hypothetical).

---

## 0. Grounded findings (why this track exists)

1. **No tracing / measurement layer at all.** No `instrumentation.ts`, no OpenTelemetry,
   no structured logger, no query timing in `lib/v2`. We are optimizing blind. The dev
   request log mixes compile time + app-code time, so "slow" is currently a guess.

2. **Dashboards fan out into many round-trips.** `lib/v2/home/queryHomeOverview.ts` issues
   **23 separate `COUNT` queries + 3 `findMany` = 26 DB round-trips** for one page. Even
   in a `Promise.all`, that's 26 statements competing for the pool → the ~1.3s app-code
   home time + cold-start spikes. The 23 counts collapse to **one** query with
   `COUNT(*) FILTER (WHERE …)`. This pattern recurs (reports, metric strips).

3. **Accuracy bugs from schema drift / placeholders** (same class as the bugs fixed
   2026-06-24): in `queryHomeOverview`, `owner: 'System'` is hardcoded with a comment
   "Future: map to ownerId if added to schema" — but `V2Project.ownerUserId` **already
   exists** (migration P0.4). `health: 'healthy'` is fabricated. These violate Invariant 7
   (no fabricated display data) and mislead the user.

4. **Read models are hand-written raw SQL** (`$queryRawUnsafe` in ~most read models) with a
   row type **asserted**, not verified. A renamed/removed column is a runtime error, not a
   compile error. No shared "this page reads these columns from these tables" contract → the
   drift class above keeps recurring.

5. **Cold start is heavy.** First hit of a route pays compile (dev) + pool init + the heavy
   aggregation. Production removes compile, but the aggregation + round-trip count remain.

---

## 1. Scope & non-goals

In scope: the V2 read-model + page-loader layer, the runtime job/scoring/outreach loaders,
schema index coverage, and a tracing/measurement layer. UI components only where a loader
change requires it (streaming/skeletons).

Non-goals: V1 (frozen, Invariant 1). No new product features. No live-send / cap work (that
is the separate pre-go-live red-blindspot session). No speculative scale infra beyond what a
measured bottleneck justifies (per the blindspot doc: don't build unproven scale work).

Invariants carried: 1 (V1 off-limits), 2 (LeadAssignment is the unit), 5 (org-scoped every
read), 7 (no fabricated/stale display), 8 (soft-delete filtered), 12 (one change-kind per
session — each D-phase is its own session).

---

## D0 — Tracing & measurement foundation (FIRST; nothing else is justified without it)

**Why first:** you cannot make "all pages fast" true if you can't measure which are slow and
why. D0 produces the numbers every later phase cites.

**Build**
- `lib/v2/observability/trace.ts` — a tiny, zero-dep `withSpan(name, fn)` + `traceQuery(label, fn)`
  that records `{ label, durationMs, rowCount }`. Dev: pretty console line when `durationMs`
  exceeds a budget; prod: one structured JSON log line (no PII — labels + timings only,
  Invariant 9). Pure timing core is unit-tested.
- `instrumentation.ts` (Next hook) — register a request span; attach the per-request query
  timings; emit a single "page X: N queries, M ms" summary line per request in dev. Keep it
  OpenTelemetry-*shaped* (span name + attributes) so a real OTel exporter is a later drop-in,
  but ship with the zero-dep console/JSON sink (no vendor lock, no cost now).
- A dev **data-budget assertion**: a page loader that exceeds e.g. >8 queries or >500ms logs
  a `SLOW LOADER` warning with the breakdown. Off in prod.
- `scripts/measure-v2-pages.mjs` — hits each `/v2/*` loader (or calls the read-model directly
  with a seeded org) and prints a **baseline table**: page → queries → ms. Committed as the
  before/after benchmark.

**Deliverable:** a baseline report (the slow list, ranked) + the trace helpers wired into the
read-model entry points. **No optimization yet.**

**Verification:** trace unit test; the baseline script runs and ranks pages; a known page shows
its real query count (home should report ~26 → proves the instrument works).

---

## D1 — Read-model accuracy audit (wiring from schema, page by page)

**Why:** "chính xác" = the UI shows what the DB actually holds. Fix the drift/placeholder class.

**Build**
- A **wiring matrix** doc: each `/v2` page → its read model → tables/columns read → issues
  (org-scope? soft-delete? Invariant-2 unit? fabricated/placeholder fields? stale-schema
  mapping like `owner:'System'`?).
- Fix the accuracy defects found (start: home `owner`/`health`, then sweep). Each fix wires
  the real column (e.g. `V2Project.ownerUserId` → owner name via a join) or honestly shows
  "—" when the data is genuinely absent (never a fabricated default).
- A **typed-row contract** for the hot raw-SQL read models: a single source listing the
  selected columns + their TS types, so a drifted column fails a check (a smoke that runs the
  query `LIMIT 0` against the dev DB and asserts the column set) — closes the "raw SQL has no
  column guarantee" gap without abandoning raw SQL's performance.

**Verification:** the matrix is complete; each fixed page shows real data (SEE-IT); a
`check-v2-readmodel-columns` smoke passes against the dev schema; grep shows no
`'System'`/`'healthy'`-style hardcoded display defaults remain in the audited loaders.

---

## D2 — Query performance + index coverage (driven by D0's numbers)

**Build**
- Collapse fan-out: rewrite the multi-count loaders (home = 26 → ~2-3) using
  `COUNT(*) FILTER (WHERE …)` single-pass aggregation. Same for metric strips / reports.
- Kill N+1: the contact/lead/campaign read models run per-row subqueries (owner, enrollment
  count, intel tokens) — fold into joins / lateral / a single grouped query.
- **Index audit:** `EXPLAIN ANALYZE` (via a dev script) the top-10 slowest from D0; add the
  missing `@@index` for their WHERE/ORDER/JOIN columns (this is the only schema/migration
  work in the track — additive indexes, idempotent `CREATE INDEX IF NOT EXISTS`).
- Cold-start: verify the prisma client/pool config; consider a warmed connection on boot.

**Verification:** the D0 baseline script re-run shows each optimized page's query count + ms
dropped (cite before/after); `EXPLAIN` shows index usage (no seq scans on the hot paths);
results identical to the pre-optimization read (a smoke compares row output).

---

## D3 — "Premium" read-model layer (consistency + reuse, low risk)

**Build**
- Promote the good pattern that already exists (`presentCompanyIntelligence` → one shared
  presenter consumed by every surface) into a **read-model convention**: loader (raw SQL,
  org-scoped) → typed row → pure `presentX` shaper → component. Document it; refactor the
  worst drift-prone loaders to it (no behavior change, just structure + types).
- A small **read-model index** (registry) doc so a new page reuses an existing loader instead
  of hand-rolling a query that drifts.

**Verification:** tsc clean; the refactored loaders return identical data (smoke); zero new
raw queries introduced for already-covered reads.

---

## D4 — Runtime smoothness / perceived performance (after the data is fast + correct)

**Build**
- `loading.tsx` skeletons per heavy route so the shell paints instantly.
- Stream slow-but-non-critical cards via Suspense (the metric strip / reports / company
  intel) so the page is interactive before the heavy aggregation finishes.
- Apply the P5 instant-then-hydrate pattern where a page still blocks on a per-row detail.
- Short, safe `revalidate` (or `unstable_cache`) on read-only dashboards (home/reports) so a
  refresh isn't a cold recompute — only where the data tolerates seconds of staleness, never
  for a send/qualification decision (Invariant 7/8 — truth reads stay live).

**Verification:** SEE-IT — heavy routes paint a skeleton immediately then hydrate; the D0
script shows TTFB improved; no route blocks >1s on first paint in dev after warm.

---

## 2. Sequencing & the strategic call

```
D0 (measure)  ->  D1 (accuracy)  ∥  D2 (perf)  ->  D3 (premium structure)  ->  D4 (smoothness)
```

- **D0 is non-negotiable and first** — it's the instrument. Small, safe, high-leverage.
- **D1 + D2 are the meat** and can interleave per page (fix accuracy + collapse its queries in
  the same pass for that page) — but each commit stays one change-kind (accuracy OR perf).
- **D3/D4 are polish** that compound once data is correct + fast.
- One D-phase = one session = one commit-kind. SEE-IT after each loader-affecting phase.

## 3. Decisions (locked 2026-06-24)

1. **"Tracing" = dev/perf observability** (option a). D0 ships the **zero-dependency** sink
   (dev console slow-loader/slow-query lines + a JSON summary line; the baseline script). It
   stays OpenTelemetry-*shaped* (span name + attributes) so a real exporter (Sentry/OTel) is a
   later drop-in IF wanted — but **no vendor, no cost, no prod exporter now**. Data-lineage
   (trace-a-lead) is explicitly NOT this track (it's a product feature for later).
2. **Sequence = D0 → (D1 + D2 interleaved per page) → D3 → D4.** For each high-traffic page,
   one pass fixes its accuracy (D1) and collapses its slow queries (D2) — but **two commits**
   (accuracy, then perf) to keep one change-kind each (Invariant 12).
3. **Page priority order:** `home → leads → companies → outreach` (highest traffic /
   most-cited slow), then the rest by D0's measured ranking.

## 4. First session = D0 (concrete exit gate)
- `lib/v2/observability/trace.ts` (+ pure-timing smoke).
- `instrumentation.ts` request summary (dev).
- Slow-loader budget warning wired into the read-model entry points.
- `scripts/measure-v2-pages.mjs` → committed baseline table (home must report ~26 queries,
  proving the instrument is real).
- Exit: baseline ranking exists; **zero behavior change**; tsc/lint/serve green. Then D1+D2
  start on `home` (fix `owner:'System'`/`health` + collapse the 26 counts).
