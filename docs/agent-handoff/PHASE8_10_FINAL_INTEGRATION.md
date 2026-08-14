# Phase 8 + 9 + 10 — final integration

Phase 8 internal RC, Phase 9 role surfaces and Phase 10 approved learning now sit together on one
branch, gated and browser-tested. The branch is ready to receive the Email Automation lane.

**Not merged to main. Do not merge to main.**

---

## 1. Branch

| | |
|---|---|
| Integration branch | `integrate/phase-8-10-final` |
| HEAD | `62e9056de268c1afe15e08162fc4cfb360c5bac6` |
| Base | `feat/phase-8-internal-rc` @ `349e495` (RC1) |
| Merge base with Phase 9/10 | `7e73b78` |

### Source branches integrated

| Branch | Commits taken | Result |
|---|---|---|
| `feat/phase-8-internal-rc` | entire branch (base) | preserved verbatim — nothing reverted |
| `feat/phase-9-10-productization` | `321a992`, `206d695` | cherry-picked, in that order |

The remote log was re-verified before picking; the two SHAs in the brief were still the only
commits unique to Phase 9/10, and they had not moved:

```
git log --oneline origin/feat/phase-8-internal-rc..origin/feat/phase-9-10-productization
206d695 test(demo): the walkthrough proves the role split and the approval boundary
321a992 feat(ai): role-aware surfaces and approved learning
```

Cherry-picked rather than merged, so none of the older Phase 9/10 base history came with them.

---

## 2. Conflicts and how each was resolved

### 2.1 `components/ai/PlaybookInsights.tsx` — modify/delete

The only conflict in the whole integration.

- **Phase 8 RC** had modified the file (`edcac82`), adding Approve/Reject buttons.
- **Phase 9/10** deleted it, replacing it with `PlaybookProposals.tsx` + `RoleSurface.tsx`.

**Resolved in favour of the deletion.** This is not a case of product UI beating runtime safety —
the Phase 8 version's buttons stored the decision in local React state (`useState`) and called no
API at all. It rendered "approved by manager" while persisting nothing. Phase 10 replaces it with a
decision that reaches `/api/ai/proposals/[id]`, is authorised server-side and produces a draft
version. Deleting it removes a control that lied about what it did.

Checked before deleting: no remaining importer of `PlaybookInsights` or of the co-deleted
`lib/console/outcomeInsight.ts`.

### 2.2 `tests/ai-optional.test.ts` — the conflict the brief predicted, which did not fire

It merged cleanly, and the required outcome held anyway. Recorded because the brief's description
of which side held what was inverted, and the next person will compare against it:

- **Phase 8 RC (kept):** `AI_IMPORT = /…\/lib\/ai(?:\/[^'"]*)?|@\/lib\/ai(?:\/[^'"]*)?/` — the
  strict, accurate pattern. RC also already carried `components/ai` in `AI_ALLOWED_PREFIXES`.
- **Phase 9/10 (discarded):** the broader `[^'"]*\/ai\/[^'"]*`, which false-positives on a relative
  `./ai/types` import.

The broader exemption was **not** restored. The new `components/ai/*` files from Phase 9/10 are
covered by the prefix the RC already had, so nothing needed loosening.

### 2.3 Everything else

`app/api/ai/console/route.ts`, `components/ai/AiConsoleView.tsx`, `components/ai/AssistPanel.tsx`,
`components/ai/ProspectWorkspace.tsx`, `components/ai/types.ts`, `lib/console/aiConsole.ts`,
`prisma/schema.prisma` and `e2e/demo/demo-telestar-ai.spec.ts` auto-merged. No Phase 8 runtime,
tenant, RLS, worker or reply-recovery behaviour was altered to make anything apply.

---

## 3. Migrations

Phase 10's migration came across exactly as designed. No replacement migration was generated and no
new migration was created.

```
prisma/migrations/20260814000000_phase10_approved_learning/
```

It sorts correctly against the existing tail (`20260813000000_phase8b_reply_classification`), so the
mis-stamp trap documented in `CLAUDE.md` does not apply here.

| Gate | Result |
|---|---|
| `npm run check:migration-order` | ok — 42 migrations, 5 new |
| `prisma validate` | schema valid |
| `prisma migrate status` (integration test DB) | all applied |
| `migrate diff --from-migrations` vs datamodel, fresh shadow | **No difference detected** (exit 0) |
| Fresh replay from empty | succeeds |
| Destructive migration introduced | none |

### RLS

`supabase/rls.sql` needed **no change**, and that is by design rather than by luck: it derives its
table list from the catalog (`FROM pg_class` … `a.attname = 'tenantId'`) instead of hardcoding
names. Phase 10's three tenant-owned models — `OutcomeSignal`, `PlaybookProposal`,
`PlaybookProposalEvidence` — are therefore covered the moment the file is applied.

- `scripts/verify-rls.mjs` — all checks passed.
- `tests/rls-policy-coverage.test.ts` asserts ENABLE + FORCE + exactly one `tenant_isolation`
  policy per tenant-owned table against an isolated database, and passes.

Schema and migration agree on every Phase 10 index — no migration-only index:
`OutcomeSignal(tenantId, signalKey)` unique, `PlaybookProposal(tenantId, proposalKey)` unique,
`PlaybookProposalEvidence(proposalId, signalId)` unique. The last one is what makes the evidence
`createMany({ skipDuplicates: true })` genuinely idempotent rather than decorative.

---

## 4. Defects found and fixed

### DEFECT-1 — an approval that lost the race left a stray draft behind *(fixed)*

**Severity:** HIGH. Phase 10's central invariant is that an approval moves policy forward by exactly
one reviewable step.

**Where:** `lib/learning/proposals.ts`, `reviewProposal`.

**Reproduction:** two managers approve the same proposal at the same instant.

**Expected:** one decision, one draft version.

**Actual:** two draft versions. Both callers passed the `status === 'proposed'` read, both called
`createDraftVersion`, and only then did one lose the compare-and-set. The loser was told the
proposal was already reviewed, but their draft survived — a version numbered off a decision the
database says never happened, attributed to a reviewer whose decision was refused.

The comment on `claim` asserted the opposite ("only the winner's branch has already created a
draft"). It described an ordering the code did not have.

**Why the existing suite missed it:** `two managers deciding at once produce one decision` drives
`decision: 'reject'`, and the reject branch never reaches `createDraftVersion`.

**Fix:** claim first. Everything above the claim is a read or a pure validation, so losing the race
costs nothing, and a draft becomes a consequence of winning rather than of trying. Linking the draft
is a second unconditional update — the claim already fixed the status, so nothing competes for that
row. Validation stays ahead of the claim, which matters more now that the claim precedes the draft.

**Regression tests** (`tests/phase-10-approved-learning.test.ts`), both verified to fail against the
old ordering / guard the new one:

- `an approval that loses the race creates no draft at all`
- `a refused change is refused before anything is written`

**Commit:** `62e9056`.

> **Independent confirmation, and a stronger fix worth considering.** The superseded
> `integrate/phase-8-10-unified` lane found the same defect and describes it in nearly identical
> terms. Its migration `20260815000000_phase10_proposal_draft_guard` moves the link onto the version
> row (`CampaignPlaybookVersion.fromProposalId`, unique) so the **database** refuses the second
> insert, rather than relying on application ordering.
>
> That was deliberately **not** adopted here: the brief forbids creating a migration unless a
> confirmed defect genuinely requires a schema change, and the reorder closes the defect without
> one. The compare-and-set is a single atomic statement, so the fix is sound on its own. The
> schema-level guard remains the more durable option and is recommended as a follow-on — see §9.

---

## 5. A finding that is **not** a branch defect: the shared local database is stale

Worth reading before anyone repeats this QA, because it presents as a Phase 10 defect and is not one.

Running the demo walkthrough against the shared local `telestar_crm` failed:

```
approved learning: evidence, a proposal, and an approval that changes nothing yet
  → timeout waiting for getByTestId('proposals-rebuild')
```

The button is gated on `canReview`, which comes from `GET /api/ai/proposals`. That endpoint was
returning **500**:

```
P2022: The column `PlaybookProposal.createdVersionId` does not exist in the current database
```

`prisma migrate status` still reported the database up to date, because the row for
`20260814000000_phase10_approved_learning` was recorded — applied from a *different, earlier* copy
of that migration by another worktree. The shared database also carries
`20260815000000_phase10_proposal_draft_guard`, which exists only on
`integrate/phase-8-10-unified` / `integrate/productization-73973a` and **drops** that column.

So the shared database holds a superseded lane's schema. This branch's migration is correct — it
defines `createdVersionId`, and the fresh-shadow replay from empty reports no drift.

**Consequence for QA:** all browser QA was run against a purpose-built database
(`telestar_integration_test`) migrated from empty, never against the shared one. The shared database
was left untouched, as was the `next start` process already occupying port 3000 — QA ran on 3100 —
because the Email Automation lane may be using both.

---

## 6. Test results

All gates run on `62e9056`.

| Gate | Command | Result |
|---|---|---|
| TypeScript | `node node_modules/typescript/bin/tsc --noEmit` | **0 errors** |
| ESLint | `node node_modules/eslint/bin/eslint.js app components lib context tests` | **0 errors** |
| Vitest | `node node_modules/vitest/vitest.mjs run` | **98 files, 1436 passed, 5 skipped** |
| Production build | `node scripts/build.cjs` | **exit 0** |
| Migration order | `npm run check:migration-order` | ok |
| Prisma validate | `prisma validate` | valid |
| Migration status | `prisma migrate status` | all applied |
| Drift / fresh replay | `migrate diff --from-migrations … --exit-code` | **No difference detected** |
| RLS | `node scripts/verify-rls.mjs` | all checks passed |

Phase 9/10 files were confirmed **discovered and executed**, not merely counted:
`tests/phase-9-role-surfaces.test.ts` + `tests/phase-10-approved-learning.test.ts` = **49 tests**.

> **A trap worth recording.** The first Vitest invocation used `--reporter=basic`, which this
> version rejects — and it **exited 0 having run no tests at all**. Exit code alone is not evidence
> the suite ran. Always confirm the file and test counts.

### Playwright — 194 tests, 0 failures

Against `http://localhost:3100`, database `telestar_integration_test` migrated from empty.

| Project | Tests | Result |
|---|---|---|
| `audit` (+`setup`) | 163 | all passed |
| `demo` | 10 | all passed |
| `chromium` (legacy: crm-journeys, deep-smoke, 31-step) | 21 | all passed |

`e2e/qa/**` does not run, and that is deliberate — `playwright.config.ts` excludes it via
`testIgnore` as self-labelled throwaway scaffolding. Every other spec is claimed by a project.

---

## 7. Role-by-role status

All six roles exercised at both layers — UI **and** direct API. A hidden button was never accepted
as evidence; every negative case issues the forbidden request and asserts the server refuses it.

| Role | Status | Evidence |
|---|---|---|
| Director | PASS | full executive access; every permitted route renders clean; company-wide surface with outcomes, AI spend, cost per meeting; Phase 10 approval workflow |
| Floor Manager | PASS | team supervision, meetings, deliverability; reads team data an SDR cannot; may decide proposals |
| Team Lead | PASS | pod-scoped supervision; gated from routes above role; cannot read the lead pool; can reach either of its SDRs' leads |
| SDR | PASS | focused task queue; gated from executive hubs; cannot read team leaderboard; cannot decide a proposal — refused by the API, not just hidden |
| Leadgen Manager | PASS | 7-tab database ecosystem; gated from routes above role; manager-only pool actions enforced |
| Leadgen | PASS | auto-routes to `/leadgen` workbench; gated from admin surface and from routes above role |

**Tenant isolation (Step 13):** cross-tenant read by direct id, mutation, list leakage, user
enumeration, campaign read, and a cross-tenant write to another tenant's email-account send cap —
all refused. Cross-*user* isolation between two SDRs in the same campaign holds for read, edit,
note, task and reminder, while each SDR can still work their own lead.

**Phase 9 vocabulary (Step 15):** user-facing labels and hints carry no engineering vocabulary.
Occurrences of `queue`/`workOrder`/`human_managed` in `lib/console/surfaces/*` are internal
identifiers, data keys and DB enum values inside queries — never rendered strings.
`lib/console/surfaces/types.ts:18` states the rule.

---

## 8. Golden journey and email safety

The demo walkthrough asserts business behaviour rather than classifier wording, and passes end to
end: research → reply → classification → handoff → SDR assistance → waiting → re-engagement
eligible → **explicit** SDR handback → manager surface → proposal → approval.

Phase 10's boundary is asserted in the browser, not just in unit tests: approving creates **draft
version 2** while the version in force still says ten days, and the confirmation wording is asserted
too, because "approved" is the word a reader will assume means "applied".

**Email remained dry-run throughout.** `deep-smoke` asserts it directly — *"sequence engine refuses
to send while autosend is disabled"* — and it passes. No real prospect email was sent at any point.

---

## 9. Open items

### Blockers

**None.** No unexplained failure in any gate.

### Email Automation handoffs

**None.** No defect owned by the email lane was found. The protected areas —
`lib/automation/**`, `lib/email/**`, scheduling, send-window and cadence calculation, delivery,
mailbox selection, `OutboundMessage` reconciliation, provider code, retry, quota reservation —
were **not modified**. Only the product boundary was tested (sequence status displays correctly,
dry-run holds), never redesigned.

### Non-blocking follow-ons

> **Status 2026-08-14: 1 and 2 are done**, as one change — the version-side unique key is both the
> guard and what makes the repair safe. `CampaignPlaybookVersion.fromProposalId` is unique,
> `PlaybookProposal.createdVersionId` is gone, and `completeApprovedProposal` finishes an approval
> whose draft never got created without retaking the decision. Migration
> `20260815000000_phase10_proposal_draft_guard`, reusing the name below as instructed, with the
> backfill ordered before the drop. **3 is superseded**: the branch schema now matches what the
> shared database already carried, so the two agree; the remaining test debris is cosmetic.

1. **Adopt the schema-level draft guard.** Move the proposal→version link onto
   `CampaignPlaybookVersion.fromProposalId` (unique) as
   `integrate/phase-8-10-unified` did, so the database refuses a duplicate draft rather than relying
   on statement ordering. Requires a migration, hence deferred out of this convergence pass.
2. **Approved-with-no-draft is now the residual failure mode.** If `createDraftVersion` throws
   *after* the claim wins, the proposal reads `approved` with `createdVersionId` null, and
   `reviewProposal` refuses to re-enter because the status is no longer `proposed`. Validation runs
   before the claim so the likely causes are gone, and this is strictly better than the stray drafts
   it replaced, but a resume path would close it. No `$transaction`: Neon HTTP has no interactive
   transactions.
3. **The shared local `telestar_crm` should be rebuilt** from migrations. It carries a superseded
   lane's Phase 10 schema and ~16.8k tenants / 103k leads of accumulated test debris. Not done here:
   it is shared with other worktrees and possibly the Email Automation lane.
4. Carried over from Phase 9/10, unchanged and still not blockers: ICP adherence is represented
   through quality indicators rather than a measured `CampaignLeadRequirement` percentage; sequence
   A/B variant-level reporting is deferred; the Revenue AI → Telestar AI rename is deferred.

---

## 10. Exact next integration step

1. Integrate the Email Automation lane **into this branch** (`integrate/phase-8-10-final`), not into
   `main` and not into the Phase 8 RC.
2. **Re-check migration ordering before applying anything.** The email lane will likely add
   migrations. This branch's tail is `20260814000000_phase10_approved_learning`. If an email
   migration sorts *before* it, investigate rather than restamping — and never rewrite history that
   has already been deployed. `npm run check:migration-order` catches the fast case in about a
   second; `migrate diff --from-migrations` against an empty shadow database is the correctness
   authority.
3. Note that `20260815000000_phase10_proposal_draft_guard` exists on the superseded
   `integrate/phase-8-10-unified` lane and is **applied in the shared local database**. It is not on
   this branch. If follow-on 1 above is taken up, reuse that name and content rather than authoring
   a competing migration.
4. Re-run the full gate set from §6, then the three Playwright projects against a database migrated
   from empty.
5. Only then consider `main`.

---

## 11. Reproducing this QA environment

```bash
# isolated database — never the shared telestar_crm
psql -U postgres -h 127.0.0.1 -d postgres -c "CREATE DATABASE telestar_integration_test;"
export QA_DB="postgresql://postgres:postgres@localhost:5432/telestar_integration_test"

DATABASE_URL="$QA_DB" DIRECT_URL="$QA_DB" node node_modules/prisma/build/index.js migrate deploy
DATABASE_URL="$QA_DB" DIRECT_URL="$QA_DB" ALLOW_DESTRUCTIVE_SEED=I_UNDERSTAND_THIS_DELETES_ALL_DATA \
  node node_modules/tsx/dist/cli.mjs prisma/seed-demo.ts
DATABASE_URL="$QA_DB" DIRECT_URL="$QA_DB" node node_modules/tsx/dist/cli.mjs scripts/demo-seed.ts --reset
DATABASE_URL="$QA_DB" DIRECT_URL="$QA_DB" ALLOW_E2E_FIXTURE=1 E2E_PASSWORD='<run-scoped>' \
  node node_modules/tsx/dist/cli.mjs scripts/e2e-audit-fixture.ts

# port 3100, because 3000 may belong to another lane
DATABASE_URL="$QA_DB" DIRECT_URL="$QA_DB" NEXTAUTH_URL=http://localhost:3100 AUTH_TRUST_HOST=true \
  node node_modules/next/dist/bin/next start -p 3100

BASE_URL=http://localhost:3100 E2E_PASSWORD='<run-scoped>' \
  node node_modules/@playwright/test/cli.js test --project=setup --project=audit --project=demo
BASE_URL=http://localhost:3100 E2E_PASSWORD='<seed password>' \
  node node_modules/@playwright/test/cli.js test --project=chromium
```

The seed prints its own generated password. The audit fixture rejects the published demo password by
design, so pass a run-scoped value.

---

## 12. Status

| | |
|---|---|
| Integration | complete — Phase 8 RC + Phase 9 + Phase 10 on one branch |
| Gates | all green, 0 unexplained failures |
| Defects fixed | 1 (DEFECT-1, with regression coverage) |
| Email-lane handoffs | none |
| Blockers | none |
| **Ready for Email Automation integration** | **YES** |

Not merged to main, and must not be until the Email Automation lane is integrated here and the full
gate set is re-run.
