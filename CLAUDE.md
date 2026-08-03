# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Detailed context lives in `.claude/rules/` — Claude Code loads these automatically:

| File                              | Content                                                   | Loads                   |
|-----------------------------------|-----------------------------------------------------------|-------------------------|
| `rules/project-context.md`        | Company, team hierarchy, toolstack, clients vs users      | Always                  |
| `rules/brand-design.md`           | Brand palette, design guidelines, channel + stage colors  | Always + UI files       |
| `rules/architecture.md`           | Stack, file layout, DB tables, auth, slide-over rule, state mgmt | Always + code files |
| `rules/modules.md`                | All 6 module routes, key UX per module, sidebar structure | When building modules   |
| `rules/dev-commands.md`           | npm, Prisma/Drizzle, TypeScript check, env setup          | package.json + DB files |
| `rules/workflow.md`               | SKILL.md rule, build sequence, iteration patterns, UX gotchas | Always            |
| `rules/runtime-hardening.md`      | Active initiative: runtime law, constraints, guardrails (→ plan) | Always         |

**Product spec:** `SKILL.md` — the authoritative reference for all modules, data models,
UI requirements, and iteration patterns. Always read it before writing code.

## ✅ Deliverability / Email Health (item 4) — complete

P0–P8 are done, including the P7a `client-reports` repair.

Reference: `docs/deliverability/PLAN.md` and `docs/deliverability/STATUS.md`.

> **Gates as of 2026-08-03:** `tsc --noEmit` 0 errors · eslint clean · Vitest 387/388
> (the one failure is cross-file test isolation — several suites share a database and
> `deleteMany()` in `beforeEach`; `tests/bullmq.test.ts` passes 7/7 on its own) ·
> Playwright 20/20 across `crm-journeys` and `deep-smoke`.
>
> An earlier note here claimed 117 `tsc` errors and 11 failing tests. That was stale —
> the P7a repair had already landed. Re-run the gates before trusting any status doc.

> ⚠️ **Windows env trap:** if the checkout path contains `&`, every npm/npx `.bin` shim
> breaks. Call entry scripts through node directly — `node node_modules/prisma/build/index.js …`,
> `node ./node_modules/next/dist/bin/next dev`. `scripts/build.cjs` already does this.
> The current path has no `&`, so npm scripts work here.

## Local development database

There is no Docker or system Postgres on the primary Windows machine. A portable
PostgreSQL 16.10 lives at `C:\Users\admin\pgsql-local` (binaries in `pgsql\bin`,
cluster in `data`), matching the Cloud SQL major version.

```bash
# start / stop  (server holds the console pipe, so start it detached)
C:\Users\admin\pgsql-local\pgsql\bin\pg_ctl.exe -D C:\Users\admin\pgsql-local\data \
  -l C:\Users\admin\pgsql-local\pg.log -o "-p 5432 -c listen_addresses=127.0.0.1" start
C:\Users\admin\pgsql-local\pgsql\bin\pg_ctl.exe -D C:\Users\admin\pgsql-local\data stop
```

`DATABASE_URL=postgresql://postgres:postgres@localhost:5432/telestar_crm` — the DSN
`vitest.config.ts` already defaults to. `.env.local` (gitignored) holds the local values.

**`npm run db:seed` is destructive** — 17 unfiltered `deleteMany()` calls, including
`tenant` and `user`. `package.json` also sets `prisma.seed`, so `prisma migrate dev` and
`migrate reset` fire it automatically. Never point either at a deployed database.

## E2E

```bash
BASE_URL=http://localhost:3000 E2E_PASSWORD=telestar2026 npx playwright test
```

`e2e/crm-journeys.spec.ts` asserts each persona reaches its routes; `e2e/deep-smoke.spec.ts`
asserts nothing is broken once there — every permitted route for all 6 personas must render
with no 5xx, no uncaught exception, no console error, and without silently redirecting away,
plus role gates and the outbound-email safety guard. Point `BASE_URL` at a deployment to use
it as a post-deploy gate.

## 🟡 Runtime Hardening + BullMQ migration

Complete except P10 infra provisioning. Before doing correctness, sequencing, email,
import, or worker/runtime work:

1. Read **`docs/runtime-hardening/STATUS.md`** — the resume pointer (current phase, next task, blockers).
2. Execute the next unchecked task in **`docs/runtime-hardening/PLAN.md`** (corrected P0–P11 roadmap + acceptance tests).
3. Tick the checkbox + update `STATUS.md` when done.

Guardrails and runtime constraints auto-load from `.claude/rules/runtime-hardening.md`.
This supersedes the original `CRM-4U_BullMQ_Runtime_Hardening_Plan.md`.
