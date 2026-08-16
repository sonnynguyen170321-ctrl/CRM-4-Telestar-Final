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

> **Gates as of 2026-08-08:** `npm ci` clean · `tsc --noEmit` 0 errors · eslint 0 errors
> (63 pre-existing unused-var / exhaustive-deps warnings) · Vitest **707/707** ·
> `next build` exit 0 · Playwright **20/20** across `crm-journeys` and `deep-smoke` ·
> `npm audit` **0 vulnerabilities**.
>
> **`tests/redis-integration.test.ts` needs a real Redis and skips without one**, so a local
> run reports 703 passed + 4 skipped. That is expected on a machine with no Redis; it is
> *not* acceptable on CI, where the suite throws rather than skipping — an unreachable
> `REDIS_URL` there means the service container is broken. It is the only test here that
> connects to Redis; every other BullMQ suite mocks the library.
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
# 1. Seed the audit fixture — additive and idempotent, no deleteMany, namespaced to
#    `pw-audit` / `@audit.test` so it never touches seeded demo rows.
ALLOW_E2E_FIXTURE=1 E2E_PASSWORD='<run-scoped>' \
  node node_modules/tsx/dist/cli.mjs scripts/e2e-audit-fixture.ts

# 2. Run against a built app (`next build` + `next start`), not `next dev`.
BASE_URL=http://localhost:3000 E2E_PASSWORD='<run-scoped>' \
  node node_modules/@playwright/test/cli.js test
```

> ⚠️ **`E2E_PASSWORD=telestar2026` no longer works and has not for some time.**
> `e2e/support/fixture.ts:67` refuses the published demo password outright — every persona in
> `auth.setup.ts` fails and the whole run reports `9 failed, 167 did not run`, which looks like a
> broken app and is not. Use a run-scoped value. This block previously documented the refused
> command; `docs/automation-engine/STATUS.md` had already recorded the guard.

`e2e/crm-journeys.spec.ts` asserts each persona reaches its routes; `e2e/deep-smoke.spec.ts`
asserts nothing is broken once there — every permitted route for all 6 personas must render
with no 5xx, no uncaught exception, no console error, and without silently redirecting away,
plus role gates and the outbound-email safety guard. Point `BASE_URL` at a deployment to use
it as a post-deploy gate.

## 🔴 Pre-Domain Hardening — ACTIVE initiative

Ten tasks across four milestones, none of which depend on the production domain. **Read
`docs/pre-domain-hardening/STATUS.md` first**, then execute the next unchecked task in
`docs/pre-domain-hardening/PLAN.md`. Tick the box and update STATUS when it lands.

Operating restrictions in force for the whole phase: no external users, no real client data,
live sequence sending stays off, email stays in dry-run, a manual Cloud SQL backup before
every migration, and never `prisma migrate reset` or a destructive seed against a remote
database.

> ⚠️ **`prisma/seed.ts` is armed and wired into `prisma.seed`.** 17 unguarded `deleteMany()`
> including `tenant` and `user`, run through a bare `new PrismaClient()` that bypasses tenant
> scoping. `prisma migrate dev` and `migrate reset` invoke it automatically. Task 1 of the
> hardening plan defuses this — until then, never point either command at a remote database.

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

> **The impact dialog now discloses what a transfer leaves behind (2026-08-08).** It used to
> count leadgen pool rows only via `assignedSdrId`, so `LeadPoolItem.qualifiedById` and the
> FK-less `Lead.archivedById` / `EmailAccount.sendPausedById` /
> `EmailHealthAlert.acknowledgedById` / `resolvedById` were counted nowhere and shown nowhere.
> `computeUserImpact` now returns `staleAttributions` for all five, and `ImpactPanel` lists
> the non-zero ones.
>
> **They are deliberately excluded from `totalOpen`.** These record *who did something*, not
> work someone must pick up. Rolling them in would flip `canRemoveSafely` for users whose only
> remaining trace is history and start returning 409 on removals that are correct today — the
> opposite of the intent, which is disclosure rather than a new gate. A test in
> `tests/admin-impact.test.ts` pins that: an archived-lead attribution is reported *and*
> `safe_remove` still stands.
>
> Still true: nothing rewrites these columns on transfer, and four of the five have no FK, so
> the database will not keep them consistent either.

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

## ✅ Automation Engine — complete

Scheduling, eligibility, and send-window policy for sequence automation. Before touching
sequence scheduling, eligibility, send windows, jitter, A/B selection, or the sequence builder's
step save path: read **`docs/automation-engine/STATUS.md`**, then `PLAN.md`, `ARCHITECTURE.md`
and `DOMAIN_MAP.md` in that directory.

**The rules that must not regress:**

- Nothing computes a schedule except `lib/automation/scheduling.ts`. Not a component, not a
  worker, not the preview endpoint — the preview calls the same function server-side precisely
  so it cannot drift from what the worker does.
- Jitter and A/B variant selection are seeded from durable ids (`tenantId + sequenceId + stepId
  + leadId`), never `Math.random()`. That is why the builder reconciles steps by id instead of
  delete-and-recreate: new step ids would re-roll send times and re-bucket every in-flight lead.
- Quota exhaustion is a `DEFER`, not a permanent failure, and the deliverability preflight runs
  *before* quota reservation so a blocked send never burns a slot.

> **New Playwright specs must live in a named subdirectory** (`e2e/journeys/`, `e2e/roles/`, …).
> The `audit` project's `testMatch` only covers those; the `chromium` project runs a hardcoded
> three-file list. A spec at the `e2e/` root matches no project and silently never runs — which
> is exactly what happened to `automation-journeys.spec.ts` before it moved.

## 🔵 Telestar Revenue AI — ACTIVE initiative

One shared agent runtime serving every role, not five AI systems. **Read
`docs/revenue-ai/STATUS.md` first**, then execute the next unchecked item in
`docs/revenue-ai/PLAN.md`. `ARCHITECTURE.md` there is the contract.

**Phases 0–10 are complete and converged on `integrate/phase-8-10-final` @ `e222657`.** That
branch is the release candidate; **it is not merged to `main`**, and `main` is still at the
Phase 7 line. Read `docs/revenue-ai/STATUS.md` before assuming anything below is current.

> **Everything the lane was waiting on has landed**, including the two follow-ons carried as known
> gaps. ICP adherence is measured (`lib/leadgen/icpAdherence.ts`), A/B variants are attributed at
> send time (`OutboundMessage.abVariantId`), the approved-copy hand-off is wired **and editable by
> the approver**, the one-proposal-one-draft rule is a database constraint with a runnable repair,
> `create-user` revokes sessions, and the RLS verifier covers the AI/learning/sequence models.
>
> **`tests/golden-journey.test.ts` is the whole business in one test** — sourced record →
> ICP qualification → delivery → CRM lead → evidence → draft → human edit → approval → durable
> `SequenceStepCopy` → launch → the exact approved wording in `OutboundMessage` → reply → the
> exact enrollment pauses → SDR ownership → explicit handback → outcome signal → proposal →
> exactly one draft policy. It mocks **only** the BullMQ transport, and configures no AI provider
> on purpose. Break the chain and it fails.
>
> **A trap it already caught:** the sequence worker reads approved copy through
> `expectedEnrollmentId`, which arrives in the **job payload**, not from the task. A caller that
> omits it correctly falls back to the shared template — which looks exactly like
> "personalization silently doesn't work". It is not.

> **Never report a gate from a piped command.** `tsc --noEmit | tail` reports `tail`'s exit code.
> A full session of green gates was hiding a real type error this way. Capture the tool's own
> exit code, and record counts rather than "PASS".

> Phase 7 shipped as one commit — knowledge architecture and the research engine (PR #65,
> `3c8a801`, merge commit `6aeeb1f`). The monolithic `lib/ai/sdr-skills.md` became eight
> retrievable modules, five evidence/cache models landed, and `lib/workorders/plan.ts` produces
> real planned tool calls for the first time.
>
> **`research_batch` is the only work order type Phase 7 plans.** Every other type still returns
> `[]`, asserted exhaustively over `ALL_WORK_ORDER_TYPES`. Filling those branches is Phase 8.
>
> **The deferred Revenue AI → Telestar AI Architecture rename is still deferred.** Do not fold it
> into Phase 8.

> **Research spend rules.** Retryable provider failures (429, transient 5xx, network/timeout,
> coalesced live `in_progress`) become `RetryableResearchError` and reach the **existing**
> Agent/BullMQ retry boundary — there is no second queue. Consumption is settled from the
> `AiCall`/`AgentAction` ledgers *before* that error leaves `executeWorkOrder`, so a paid 429 is
> charged before the retry starts. **`maxToolCalls` counts logical planned tool actions**
> (`AgentAction` rows, stable across retries via the positional action key); research and token
> spend is charged **per provider attempt**.

> **Null is not a wildcard.** A requested account or contact must be *exactly* the one the
> authorized lead points at, so a lead with a null link authorizes nothing —
> `validateEvidenceCitations` enforces the same rule for evidence, so a target scope with no
> account authorizes no account evidence. Research tools refuse by **throwing**; a returned
> refusal string would be recorded as a completed `AgentAction` for an action that never ran.

> **RLS-enabled deployments must reapply `supabase/rls.sql` after any migration that adds a
> tenant-owned table.** Prisma migrations deliberately contain no `ENABLE`/`FORCE`/`CREATE
> POLICY`. See `docs/DEPLOY.md` §9.
>
> **Approval is a recorded decision, never a stored permission.** `resumeApprovedAction`
> re-derives authorization on every resume — a tightened policy, a `human_only` capability, a
> cancelled order, an expired approval, or an approval granted at a level the policy now exceeds
> each still refuse. Do not add a path that reads the approved flag and executes.

The operating model: **AI does the repetitive prospecting work, SDRs do the selling, managers
manage exceptions and performance, the CRM keeps everything connected and controlled.**

**Invariants that must not regress:**

- The CRM owns truth; AI owns interpretation. No agent tool holds a Prisma client — every
  mutation goes through a domain service that already enforces tenancy, permissions and audit.
- **No second system.** One CRM, one sequence engine, one email pipeline, one permission model,
  one tenancy mechanism, one audit trail, one reporting layer. `ARCHITECTURE.md` §9 is the reuse
  map. A capability that seems to need its own path means the existing service needs a
  parameter, not a twin.
- **AI down must never mean CRM down.** True today only because nothing in the CRM calls
  `lib/ai/`. Phase 1 makes it a tested property.
- **Handoff to the SDR is automatic; handback to AI is not.** A meaningful reply moves a lead to
  `human_attention` on its own. Nothing moves it out of `human_managed` except an explicit SDR
  action — ghost detection produces eligibility and a recommendation, never an enrollment.
- `human_managed` means "AI may not touch the prospect", not "AI off". Summaries, reply drafts,
  objection help and meeting prep stay available to the SDR throughout.
- Autonomy is **per capability**, never a scalar level, and lands before any write-capable tool.
  `prospect_reply` is `human_only` at every setting.
- The AI recommends, policy validates, automation executes. No agent rewrites the rules it runs
  under — observation → recommendation → human approval → a new playbook *version*.
- Anything deciding *when* an automated step runs calls `lib/automation/scheduling.ts`. An agent
  proposing "resume after the OOO date" emits an intent; the engine computes the timestamp.

**State model (decided — `ARCHITECTURE.md` §4):** three distinct axes. `Lead.stage` = sales
lifecycle. `SequenceEnrollment.status` + `nextActionAt` / `pausedReason` / `currentStep` =
**authoritative** execution lifecycle. `ProspectOperatingState` = who or what is responsible now.

> ⚠️ **`Lead.sequenceStatus` is legacy compatibility cache, not truth.** It stays only because
> 15 files already use it (~25 writes, ~20 reads, no constraint keeping it honest). **Add no new
> reader and no new writer** — new logic branches on `SequenceEnrollment`. Where the two
> disagree, the enrollment is right. Deprecation path in `ARCHITECTURE.md` §4.1.

> ⚠️ **AI client/server boundary (`ARCHITECTURE.md` §10).** `lib/ai/models.ts` is client-safe and
> **must stay import-free**. `provider.ts`, `usage.ts`, `tools.ts` and any Prisma-backed AI
> service are **server-only** — no `"use client"` module may import them, directly or
> transitively. `provider.ts` reaches the database via `usage.ts`, so a client import pulls
> `async_hooks`/`dns`/`net` into the browser bundle and `next build` fails. **tsc and Vitest
> pass while this is broken.** Two tests in `tests/ai-optional.test.ts` hold the line.

**Agent capabilities (Phase 2, shipped).** Every tool call resolves through
`lib/agent/authorization.ts`, returning `ALLOW` / `REQUIRE_USER_APPROVAL` /
`REQUIRE_MANAGER_APPROVAL` / `DENY`. Eight rules, all permanent:

1. CRM authorization runs **independently** of agent autonomy — always, in the domain services.
2. Autonomy can **restrict** existing authority, never widen it.
3. `CAPABILITY_CEILING` is **not** tenant-overridable (resolution: ceiling → stored → default,
   strictest wins).
4. `prospect_reply` is `human_only` for every role and every mode.
5. An unregistered tool fails closed.
6. Missing authorization context fails closed.
7. No legacy exemption — `create_task` is enforced like everything else.
8. A blocked action is **never** reported to the model or user as if it succeeded.
9. **Agent tools call domain services, not our own HTTP API** — for any CRM read or mutation a
   shared domain service can own. Never a bypass header, a forwarded cookie, a bearer token or
   a service account. External provider calls (Groq, Gemini, Tavily, Jina) are unaffected.

> **Repaid in Phase 5.** `create_task` / `get_my_tasks` used to `fetch` this app's `/api/tasks`
> with no session cookie and return 401. `lib/tasks/service.ts` now owns task create and list,
> and both the route and the tools call it — so there is no internal-HTTP exception list left to
> grandfather. `tests/agent-object-authorization.test.ts` still fails the build on any *new*
> internal-HTTP call from the agent layer.

> ⚠️ **Capability authorization is not object authorization** (`ARCHITECTURE.md` §11).
> `tasks = auto` means "may create tasks at all", *not* "may act on this lead". Object scope —
> tenant, `canAccessLead`, `canAccessUser`, pod hierarchy, leadgen campaign/account scope,
> send-window permission — stays in the CRM domain services and is **never reproduced in the
> agent layer**. `CapabilityDecision` carries no record id, and `decideCapability` takes no
> record argument, so the separation is structural. `tests/agent-object-authorization.test.ts`
> asserts both halves.

**`next build` is a required gate** for any change touching shared imports, Next.js routes,
provider code, the server/client boundary or app wiring — the fast gates cannot see bundling
failures. Docker build too for runtime/deployment changes. CI is green only when GitHub reports
each required check successful; a watcher exiting 0 is not evidence.

**Campaign policy authority (Phase 4, shipped).** Three owners, never merged:

| Owner | Answers |
|---|---|
| `CampaignLeadRequirement` | who leadgen should source, and what qualifies (**ICP lives here**) |
| `CampaignPlaybookVersion` | how approved outreach should operate |
| CRM / automation services | execution and enforcement |

> ⚠️ **The playbook must never define ICP.** `lib/playbooks/policy.ts` is a `.strict()` zod
> contract, so an `icp`/`targetTitles`/`companySizeMin` key is *rejected*. Approved versions are
> immutable — editing creates a new draft. Only an approved version may be activated, at most
> one per playbook, and activation supersedes the outgoing one at the **same** timestamp so
> `[activatedAt, supersededAt)` windows tile without gap or overlap. Send-window policy is
> intent only: it reaches a prospect through approved sequence configuration →
> `assertSendWindowPermission` → `SequenceStep` → the automation scheduler. No playbook-side
> scheduler.

**The migration drift gate is required** for any change to `prisma/schema.prisma` or migration
SQL. Run locally before pushing:

```bash
npm run check:migration-order          # fast: catches a mis-sorted new migration
node node_modules/prisma/build/index.js migrate status
node node_modules/prisma/build/index.js migrate diff \
  --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma \
  --shadow-database-url "postgresql://postgres:postgres@127.0.0.1:5432/telestar_shadow" --exit-code
```

> ⚠️ **Prisma stamps a migration with generation time, not dependency position.** On a branch
> whose earlier migrations were authored with dates ahead of the wall clock, a newly generated
> migration sorts *before* the tables it alters. It then applies fine to your database — which
> already has those tables — and `migrate status` stays green. **Only a replay from empty sees
> it.** This has happened three times (`work_order_phase6a`, `work_order_lease_fencing`,
> `agent_execution_phase6b`, all renamed to `202608110[123]0000`).
>
> `npm run check:migration-order` now fails in about a second when a new migration sorts before
> the existing tail, and runs in CI ahead of the replay. It is a **speed** gate only —
> `migrate diff --from-migrations` against an empty shadow database remains the correctness
> authority, because a migration can sort correctly and still be wrong. **Always check a
> generated migration's name against the tail of `prisma/migrations/` before applying it.**

A **migration-only index or constraint is not acceptable** unless the datamodel represents the
same final schema — it survives only until someone regenerates a migration from the schema,
then vanishes silently. Create the shadow DB once: `CREATE DATABASE telestar_shadow;`

Operating-state transitions go through four domain services — `handoffProspectToHuman`,
`markReengagementEligible`, `handbackProspectToAI`, `startAIReengagement` — each owning its
Task, Notification, Activity, WorkOrder and cache-refresh consequences. No route, tool or worker
writes the state column directly. `markReengagementEligible` is **inert**: badge and
recommendation only, never a sequence, enrollment or external action. Handback builds a **new**
approved follow-up; restarting the prior cold sequence is prohibited.
