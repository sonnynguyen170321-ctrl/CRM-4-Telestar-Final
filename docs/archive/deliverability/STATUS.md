---
classification: HISTORICAL
superseded_by: current code, and the scoped rule or skill named below
---

> ## NOT CURRENT
>
> A record of finished work, kept for its reasoning. **Do not read it as a description
> of how the system behaves today** — it was accurate when written and nothing has kept
> it accurate since. Email health shipped. Behaviour lives in lib/email-health/ and .agent/skills/email-deliverability/.
>
> Current truth: the code, then `.agent/generated/`, then `.agent/` and `.claude/rules/`.

# Deliverability / Email Health — STATUS

> **Read this first.** Resume pointer for the Email Health module (working-order item 4,
> the one `docs/client-reports/PLAN.md:23` defers email-from-CRM to).
> Roadmap + task list: [`PLAN.md`](./PLAN.md).

**Current phase:** Complete (P0 through P8 all completed and green).
**Next unchecked task:** All phases (P0–P8) complete.
**Blockers:** None.

**Gates re-measured 2026-08-03:** `tsc --noEmit` 0 errors · eslint 0 errors ·
Vitest **37 suites / 388 tests** all passing · Playwright **20/20**
(`e2e/crm-journeys.spec.ts` + `e2e/deep-smoke.spec.ts`).

---

## Decisions locked (do not re-litigate)

1. **Enforcement posture** — a manager-set pause (`EmailAccount.sendPausedAt`) is an
   unconditional hard block in `workers/email.ts`. A `critical` health score is **advisory**:
   it raises alerts but only blocks sending when `EMAIL_HEALTH_AUTOPAUSE=true`
   (default off), so a miscalibrated threshold cannot silently halt a client campaign.
2. **DNS** — SPF, DMARC and MX are checked for real via Node's built-in `dns/promises`
   (zero new dependencies). **DKIM is deliberately not automated**: its record lives at
   `<selector>._domainkey.<domain>` and the selector is provider-specific with no discovery
   mechanism, so guessing it would produce confident-looking false failures. DKIM stays a
   manually-set field.
3. **`/automation`** — its per-inbox table was **moved** into `/email-health` (a strict
   superset). `/automation` keeps sequence + queue stats, a 3-tile capacity summary, and a
   "View Email Health →" link. Cap editing now lives in exactly one place.
4. **Snapshots are history only.** Live views recompute from `OutboundMessage` /
   `InboundMessage`, so a failed cron degrades trend charts but never makes the dashboard
   lie. Matches the Runtime Law: *Database records truth. UI reads database truth.*

---

## What P0 actually fixed (the reason the plan was reordered)

The source doc (`~/Downloads/deliverability-email-health-dashboard-implementation.md`) put
schema + dashboard first. That order does not work, because **the metrics were uncomputable**:

| Metric | Why it read zero | Fixed by |
|---|---|---|
| Hard/soft bounce rate | `workers/sync.ts:62` skipped every bounce message before persisting. `handleApplyBounce` never touched `OutboundMessage`, so `status='bounced'` had **no writer at all**. | P0 |
| Reply rate | `handleApplyReply` never set `repliedAt` and never bumped `lead.emailReplyCount`. Both columns were dead. | P0 |
| Open rate | `openedAt` has zero writers and there is no tracking-pixel route. | **Out of scope** — deliberately absent from the UI rather than shipping a column of zeros. |

**Second bug found while rewriting** (not in the original plan): `leadByEmail` was keyed on
`msg.fromEmail`, but bounces were looked up by the *extracted DSN recipient*. Since a bounce's
sender is `mailer-daemon@…`, that lookup **never hit in production** — bounces were not merely
unrecorded, they were never processed: no suppression entry, no sequence pause. The old test
passed only because `findMany` was mocked to return the lead regardless of the `where` clause.
Regression test: `tests/sync-worker.test.ts` → *"looks leads up by the bounced recipient, not
the mailer-daemon sender"*.

**Free side-effect:** `ActivityType` had no reply member, so
`lib/client-reports/metrics.ts:140` (`typeStr.includes('reply')`) never matched — client-report
`replies` / `replyRate` / `positiveReplies` were **already** pinned at zero. Adding
`email_replied` in P0 repairs that module too.

⚠️ **P0 needs ~7 days of live sync to bake** before the 7-day windows mean anything. Until
then the dashboard renders correctly but with thin data. Do not interpret low counts as a bug.

---

## Progress log

| Date | Phase | Outcome |
|---|---|---|
| 2026-08-02 | Pre-work | `@anthropic-ai/claude-code` CLI installed; caveman installed for Claude Code as a plugin (`claude plugin install caveman@caveman`). Hooks handled by the plugin manifest — **nothing written into `~/.claude/settings.json`**. |
| 2026-08-02 | **P0** ✅ | Migration `20260802050000_email_health_data_capture` applied. `workers/sync.ts` rewritten. `tests/sync-worker.test.ts` **15 → 29 tests, all green**. |
| 2026-08-02 | **P1** ✅ | `lib/email-health/{types,scoring,recommendations,metrics}.ts`. `tests/email-health-scoring.test.ts` **28 tests green** — every threshold boundary and level cutoff pinned. |
| 2026-08-02 | **P2** ✅ | Migration `20260802060000_email_health_models` applied. `supabase/rls.sql` updated — added the 3 new tables **plus 4 pre-existing gaps** (`OutboundMessage`, `InboundMessage`, `SuppressionEntry`, `JobRun` had no DB-level tenant policy). |
| 2026-08-02 | **P3** ✅ | `lib/email-health/access.ts`. Fixed a real leak: `app/api/automation/stats/route.ts` returned **every mailbox in the tenant to any authenticated user, SDRs included**. `tests/email-health-access.test.ts` **22 tests green**. |
| 2026-08-02 | **P4** ✅ | `app/api/cron/email-health/route.ts` + send gate in `workers/email.ts`. `tests/email-worker.test.ts` **7 → 17 tests green**, including *"blocks a manager-paused inbox without consuming daily quota"*. |
| 2026-08-02 | **P5** ✅ | 12 routes under `app/api/email-health/**`, incl. real `dns/promises` SPF/DMARC/MX checking. |
| 2026-08-02 | **P6** ✅ | `app/email-health/page.tsx` + 8 components + sidebar nav + `/automation` table moved out. |
| 2026-08-02 | **P7a** ✅ | `client-reports` repaired — tsc and its suite green. |

**Tests added by this work: 74** — sync +14 (15→29), scoring +28 (new), access +22 (new),
email worker +10 (7→17).

**Full suite as of hand-off:** `34 files, 341 tests — 330 pass, 11 fail`.
All 11 failures are in `tests/client-reports.test.ts`.
`tsc --noEmit` reports **117 errors, 0 of them in any Email Health file** (verified by
filtering the output).

---

## Blockers — RESOLVED (historical record below)

> **Resolved.** P7a repaired `client-reports`; `docs/client-reports/PLAN.md` now shows
> Phases 0–5 done. Re-measured 2026-08-03: `tsc --noEmit` **0 errors**, Vitest
> **388/388**. The counts below are kept only as a record of what P7a faced.
>
> This section stayed stale long enough to mislead — `CLAUDE.md` was still repeating
> "117 errors" on 2026-08-03. **Run the gates before trusting any status doc.**

`tsc --noEmit` reported **117 errors**; the suite had **11 failing tests**. Every one was in
`client-reports`, a module that was mid-build before this work started (its own
`docs/client-reports/PLAN.md` said Phase 0 IN PROGRESS, Phases 1–5 PENDING).
**Zero errors were in any file this work touched** — verified by filtering tsc output.

`next.config.ts` has no `typescript.ignoreBuildErrors`, so `next build` failed at the time.

### Affected files
```
lib/client-reports/{metrics,shareLinks,snapshot}.ts
app/api/client-reports/route.ts
app/api/client-reports/preview/route.ts
app/api/client-reports/[id]/route.ts
app/api/client-reports/[id]/{approve,share}/route.ts
app/api/client-reports/[id]/export/{csv,pdf}/route.ts
app/client-reports/[id]/page.tsx
app/client-reports/public/[token]/page.tsx
components/client-reports/ClientReportDetail.tsx
tests/client-reports.test.ts
```

### Root causes identified so far
1. **`parseBody` result never narrowed** (the bulk of the errors). `ParseResult<T>` is
   `{data: T; error?: never} | {data?: never; error: NextResponse}`. Routes read
   `parsed.title` directly. Correct usage, per `lib/validation/core.ts:10-13`:
   ```ts
   const parsed = await parseBody(req, schema);
   if (parsed.error) return parsed.error;
   const body = parsed.data;
   ```
2. **`user: { select: { name: true } }`** — the `User` model has `firstName` / `lastName`,
   there is no `name` column. (`lib/client-reports/metrics.ts` already works around this with
   `act.user.name || act.user.email.split('@')[0]`, which is itself a type error.)
3. **`Property 'shareLinks' does not exist`** — read without the corresponding `include`.
4. **`Argument of type 'unknown' is not assignable to parameter of type 'string'`** — dynamic
   route params are `Promise<{id: string}>` in Next 16 and must be awaited before use.
5. **Tests written against an API that does not exist**: `sanitizeClientNotes`,
   `anonymizeSdrName`, `sanitizeInsightArray` are all `TypeError: … is not a function`. The
   module exports `sanitizeClientFacingText` and `formatRepDisplayName` instead. Also
   `hashPassword` output does not contain `crm_salt_`; CSV export lacks a `KPI,Value` header;
   HTML export renders `Globex Corp` where the test expects `Globex Enterprise Deployment`.
   **Decide per test whether the test or the implementation is wrong** — do not just make
   assertions pass.

### ⚠️ Separate issue: fabricated client-facing numbers
`lib/client-reports/metrics.ts` invents figures that are shipped to clients:
`positiveReplies = replies * 0.45` (line 166); per-channel `meetingsBooked` splits of
0.4 / 0.45 / 0.1 / 0.05 (lines 337-361); `leadQuality.validated = ×0.94`, `qualified = ×0.88`,
`duplicateRate: 0.03`, `averageEmailScore: 92` (lines 385-393).

This contradicts the repo's own guardrail against *"fake demo data as a runtime dependency"*
(`.claude/rules/runtime-hardening.md`). **This was flagged, not fixed — it needs a product
decision, not a code change.** The Email Health block added in P7b will be real data sitting
next to these estimators in the same client PDF.

---

## Environment gotchas (Windows, this machine)

The repo path contains an ampersand: `C:\Users\admin\Desktop\Sonny & AI\…`. **This breaks every
npm/npx `.bin` shim** — `cmd.exe` treats `&` as a command separator and the shim does not quote
the path. Symptom is a misleading `Cannot find module 'C:\Users\admin\Desktop\prisma\build\index.js'`
(note the truncation at the `&`).

```powershell
# Call the package entry script through node directly:
node node_modules/prisma/build/index.js  migrate deploy
node node_modules/vitest/vitest.mjs      run
node node_modules/typescript/bin/tsc     --noEmit
node ./node_modules/next/dist/bin/next   dev      # NOT `npm run dev`
```

Two more:
- **`prisma migrate dev` refuses to run** — the tool shell is non-interactive. Use
  `migrate diff --from-schema-datasource … --to-schema-datamodel … --script` to generate SQL,
  hand-write the migration folder, then `migrate deploy`.
- **`prisma generate` fails with `EPERM … rename query_engine-windows.dll.node`** while
  `next dev` is running — the dev server holds the engine. Stop it, generate, restart.

### Pre-existing schema drift — do not sweep it in
`migrate diff` against this database also reports `TIMESTAMP(3)` changes on
`CampaignLeadRequirement`, `LeadPoolItem` and `LeadgenActivity`. That drift **predates this
work** and was deliberately excluded from both Email Health migrations. Keep excluding it, or
fix it in its own migration.

---

## How to resume

1. Read this file, then [`PLAN.md`](./PLAN.md).
2. Execute the next unchecked task in `PLAN.md`.
3. Re-read the source files before editing — do not trust stale context.
4. Verify with the commands in `PLAN.md` § Verification.
5. Tick the checkbox here and in `PLAN.md`.
