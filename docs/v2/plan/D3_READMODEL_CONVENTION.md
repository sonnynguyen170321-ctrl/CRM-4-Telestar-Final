# D3 — V2 read-model convention (premium, drift-resistant)

Status: convention doc. **No code refactor** — leads, companies, home, and outreach already
follow this after D1/D2. This codifies the pattern so the next page doesn't re-introduce the
drift D-Track just removed (the home 26-count fan-out + fabricated fields; the outreach
fetch-all-then-count-in-JS).

## The shape

```
page.tsx (server)            -> awaits loaders in Promise.all, renders components
  loader (lib/v2/**, raw SQL) -> org-scoped, soft-delete-filtered, ONE query where it can be
    typed Row                 -> the exact columns the SQL returns (asserted shape)
  presentX (pure)             -> maps Row -> view model (no DB, unit-testable)
  component                   -> renders the view model (shared, never re-queries)
```

The gold example is `presentCompanyIntelligence` → `IntelligenceView` → `CompanyIntelligencePanel`,
consumed by the company drawer, lead drawer, compose, and manager review — one shaper, zero
drift across surfaces.

## Rules (the ones the audit proved we need)

1. **Aggregate in SQL, never in JS.** Counts/sums are `COUNT(*) FILTER (WHERE …)` /
   `GROUP BY`, not "fetch every row and `.filter().length`". (home: 22 counts → 1; outreach:
   stop streaming whole tables.)
2. **One round-trip per logical read where possible.** Per-row data joins via `LEFT JOIN
   LATERAL`, not N separate queries. (leads/companies already do this — copy them, not home's
   old `one(sql)` fan-out.)
3. **No fabricated display data (Invariant 7).** If a column isn't in the schema or is null,
   render "—" / omit it — never a hardcoded `'System'` / `'healthy'` / `createdAt+30d`.
   Wire the real column (e.g. `V2Project.ownerUserId`, `V2ProjectStage`, `updatedAt`).
4. **Org-scoped + soft-delete-filtered every query (Invariants 5/8).** `WHERE "organizationId"
   = $1 AND "deletedAt" IS NULL` is the default; the org comes from the session, never a param.
5. **Pure shapers.** The `presentX` / `buildX` function takes rows/counts and returns the view
   model with no I/O, so it gets a `.mjs` smoke (see `check-v2-*` scripts).
6. **Trace the loader.** Wrap the loader body in `withSpan("<page>.<read>")` and each query in
   `traceQuery("<label>", …)` (lib/v2/observability/trace). In dev a loader over the budget
   (>8 queries or >=500ms) prints a `SLOW LOADER` line with the slowest queries — the
   regression guard against a future fan-out/N+1.
7. **Typed row, not `any`.** The `$queryRawUnsafe<Row[]>` generic must list the real columns.
   A drifted/renamed column is then a typed assumption — and `scripts/check-v2-readmodel-
   columns.mjs` makes it a HARD check: it captures each read model's actual SQL and runs it
   as `SELECT * FROM (<sql>) LIMIT 0` against the dev schema, so a dropped column errors and
   an aliased column that goes missing is flagged. Run it (`node --env-file=.env
   scripts/check-v2-readmodel-columns.mjs`) when you touch a read model or rename a column.

## Read-model registry (headline pages)

| Page | Loader(s) | Round-trips | Notes |
|---|---|---|---|
| home | `queryHomeOverview` | 4 (1 counts + 3 lists) | D2: 22 counts → 1 `FILTER`/CTE query |
| leads | `queryContactLeads` (+ `…Metrics`, `listLeadWorkspaceFilterOptions`) | 2 / 1 / 4 | LATERAL joins, not N+1 — already optimal |
| companies | `queryCompanyDirectory` (+ `…Aggregates`, `…FilterOptions`) | 2 / 4 / n | paginated + GROUP BY/DISTINCT ON facets |
| outreach | `queryOutreachReport` | 4 | D2: aggregate counts, no fetch-all |

New page? Reuse a loader from here or add one that follows the rules above + lands in this
table. Don't hand-roll a query that re-counts in JS.

## Verification gate for a new/changed read model
- tsc + eslint clean; the pure shaper has a `check-v2-*` smoke.
- `node scripts/measure-v2-pages.mjs` shows the loader under the 8-query budget — or a
  comment explains why not. (home/leads/companies/outreach are all baselined there.)
- `node --env-file=.env scripts/check-v2-readmodel-columns.mjs` passes — the loader's real
  SQL executes against the dev schema and returns the expected key columns (column-drift
  hard-check). Add the new loader to its `READ_MODELS` list.

## NOT in scope (deliberately)
No refactor of the already-aligned loaders — churn on working code is a liability. D3 is the
guardrail; apply it to the next read model, not retroactively to good ones.
