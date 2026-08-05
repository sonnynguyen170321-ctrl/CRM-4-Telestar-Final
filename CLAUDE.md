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

> **Gates as of 2026-08-03:** `npm ci` clean · `tsc --noEmit` 0 errors · eslint 0 errors
> (56 pre-existing unused-var warnings) · Vitest **388/388** · `next build` exit 0 ·
> Playwright **20/20** across `crm-journeys` and `deep-smoke`.
>
> Vitest is occasionally 387/388: several DB suites share one database and call
> `deleteMany()` in `beforeEach`, so parallel files can wipe each other's rows.
> `tests/bullmq.test.ts` passes 7/7 in isolation. Re-run the file alone before treating
> a failure there as real.
>
> `prisma generate` fails on Windows with `EPERM ... query_engine-windows.dll.node` while a
> dev server is running — stop it before `npm run build`.
>
> An earlier note here claimed 117 `tsc` errors and 11 failing tests. That was stale —
> the P7a repair had already landed. Re-run the gates before trusting any status doc.

> ⚠️ **Windows env trap — this IS biting.** The checkout path is
> `C:\Users\admin\Desktop\Sonny & AI\clone-CRM-4-U-migration-main`. The `&` breaks every
> npm/npx `.bin` shim (`npx tsc` resolves to `C:\Users\admin\Desktop\typescript\bin\tsc`).
> An earlier note here claimed "the current path has no `&`, so npm scripts work here" —
> that was wrong. Call entry scripts through node directly:
>
> ```bash
> node node_modules/typescript/bin/tsc --noEmit
> node node_modules/vitest/vitest.mjs run
> node node_modules/eslint/bin/eslint.js .
> node node_modules/prisma/build/index.js migrate deploy
> node ./node_modules/next/dist/bin/next dev
> ```
>
> `scripts/build.cjs` already does this. **`tsc` and `next build` also need
> `NODE_OPTIONS=--max-old-space-size=8192`** or they die with
> `FATAL ERROR: Ineffective mark-compacts near heap limit` (exit 134) — a heap limit, not a
> type error.

## Local development database

PostgreSQL 16 runs as the Windows service **`postgresql-x64-16`**, binaries at
`C:\Program Files\PostgreSQL\16\bin`. It matches the Cloud SQL major version.

```bash
# state
Get-Service postgresql-x64-16
# psql
& 'C:\Program Files\PostgreSQL\16\bin\psql.exe' -U postgres -h 127.0.0.1 -d telestar_crm
```

> Pass SQL to `psql` with `-f file.sql`, not `-c "..."` — PowerShell strips the double
> quotes around identifiers, so `"CampaignLeadRequirement"` arrives lowercased and the
> statement fails with `relation ... does not exist`.

> An earlier note here described a portable install at `C:\Users\admin\pgsql-local` driven
> by `pg_ctl`. That path does not exist on this machine; the service above is what runs.

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

## ✅ Admin Control Center (people-ops console) — complete

Director/Floor Manager manage users, teams, clients, campaign membership, work transfer
and an audit log from `/admin`. Built, gated, and covered.

**The rule that must not regress:** removing a campaign member or deactivating a user runs an
impact check first and returns **409** unless the caller names a handling mode
(`transfer_work` / `pause_tasks` / `keep_existing_work`) plus a reason. Enforcement lives in
`lib/admin/campaignMembers.ts` — both `/api/admin/assignments` and
`/api/campaigns/[id]/members` delegate to it, so it cannot be bypassed.

Before touching admin, user, campaign-membership or work-ownership code:
read **`docs/admin-control-center/STATUS.md`** — gate status, architecture constraints,
and what was deliberately *not* built.

> **The impact dialog is not exhaustive.** `lib/admin/impact.ts` counts leadgen pool rows
> only via `assignedSdrId`. `LeadPoolItem.qualifiedById` and the FK-less `Lead.archivedById` /
> `EmailAccount.sendPausedById` / `EmailHealthAlert.acknowledgedById` / `resolvedById` are
> counted nowhere and shown nowhere — they are silently left behind on transfer. Intended,
> but don't tell an operator the dialog is complete.

> `lib/admin/transferWork.ts` deliberately has no `$transaction` — Neon HTTP has no interactive
> transactions and the `lib/prisma.ts` `$extends` wrappers defeat array batching, so wrapping it
> would look atomic and not be. It is idempotent-resumable instead. Don't "fix" it.

## 🟡 Runtime Hardening + BullMQ migration

Complete except P10 infra provisioning. Before doing correctness, sequencing, email,
import, or worker/runtime work:

1. Read **`docs/runtime-hardening/STATUS.md`** — the resume pointer (current phase, next task, blockers).
2. Execute the next unchecked task in **`docs/runtime-hardening/PLAN.md`** (corrected P0–P11 roadmap + acceptance tests).
3. Tick the checkbox + update `STATUS.md` when done.

Guardrails and runtime constraints auto-load from `.claude/rules/runtime-hardening.md`.
This supersedes the original `CRM-4U_BullMQ_Runtime_Hardening_Plan.md`.
