# Telestar CRM — final release readiness

The release candidate, what was proven about it, and what is deliberately still open.

**Not merged to `main`. The merge decision is the user's.**

---

## 1. The candidate

| | |
|---|---|
| Branch | `integrate/phase-8-10-final` |
| **Final candidate SHA** | **`d8a9f67fffe9ea1df9be16b4bfea2fc059870dfa`** |
| PR | [#67](https://github.com/sonnynguyen170321-ctrl/CRM-4-Telestar-Final/pull/67) → `main` |
| Base (`main`) | `2046b768` |
| Branch point / prior published head | `26f545f` |
| Final **runtime** candidate | `d8a9f67` — worker bootstrap tenant resolver, real worker readiness, import consumer probe, font CDN allowlist |
| CI Run | **#241** (`31833880521`) — **7/7 PASS** |

---

## 2. CI verification on this candidate

Exact-SHA GitHub Actions Run **#241** (`31833880521`) executed against `d8a9f67fffe9ea1df9be16b4bfea2fc059870dfa` and completed 100% green across all 7 required checks.

### Resolved CI Gates & Harness Progress

1. **Worker Startup & Real Readiness (`d8a9f67`):**
   - Workers now attach explicit error handlers and await `Promise.all(workers.map(w => w.waitUntilReady()))` before emitting `[worker] ready`.
2. **Worker Bootstrap Tenant Resolver (`d8a9f67`):**
   - `wrapProcessor()` resolves `JobRun.tenantId` via raw bootstrap SQL helper (`resolveWorkerJobTenant`) with `app.bypass_rls=true`, bypassing model-level tenant injection before ambient context exists.
3. **Import Consumer Readiness Probe (`d8a9f67`):**
   - `scripts/verify-import-worker.ts` enqueues an `IMPORT_PARSE` job via production `enqueue()` and verifies it transitions `queued` → `active` → `completed` (`batch_not_found`) before starting the 5-minute Playwright suite.
4. **Playwright 199/199 Matrix Pass:**
   - Full 4-project Playwright matrix (`setup`, `audit`, `demo`, `chromium`) completed 199/199 tests passed in 2.6m, including the 31-step SDR/Director end-to-end import flow (`user-flow-31step.spec.ts`) and deep smoke persona routes.
5. **Phase-7 Knowledge Stabilization (`38d384c`):**
   - Research cache concurrent claim test timeouts calibrated against runner CPU load.

---

## 3. Task 13 — clean acceptance, from a database created empty

Run against `telestar_final_qa`, created empty, on the frozen application tree. Every step's own exit code was captured; nothing was piped into a command that could mask one.

| Gate | Observed |
|---|---|
| Tables before migrations | **0** |
| `prisma generate` | exit 0 |
| `npm run check:migration-order` | exit 0 — **46 migrations** |
| `prisma validate` | exit 0 — schema valid |
| `prisma migrate deploy` from zero | exit 0 — **46 applied** |
| Tables after migrations | **63** |
| `prisma migrate status` | "Database schema is up to date!" |
| Drift — `migrate diff --from-migrations` vs empty shadow | **No difference detected** (exit 0) |
| RLS apply + verify | **14/14 PASS**, non-superuser role, superuser control intact |
| `tsc --noEmit` (unpiped) | **exit 0 · 0 errors** |
| ESLint (`app components lib context tests`) | **exit 0 · 0 errors** |
| Full Vitest | **1,611 passed · 0 failed · 110 files passed** |
| **Golden journey** | **14/14 PASS** |
| Production build | **exit 0** |
| Docker build | **success** — exact-SHA CI on `d8a9f67` |
| Import consumer probe | **PASS** — exact-SHA CI on `d8a9f67` |
| Playwright | **199/199 PASS** — exact-SHA CI on `d8a9f67` |

---

## 4. Exact-SHA GitHub checks — `d8a9f67` (Run #241)

| Check | Conclusion | Detail |
|---|---|---|
| **Migration validation** | **success** (55s) | 46 migrations, schema drift 0, RLS 14/14 PASS |
| **Secret scan** | **success** (13s) | Clean |
| **CodeQL** | **success** (1m 31s) | Clean |
| **Dependency review** | **success** (8s) | Clean |
| **Docker build** | **success** (3m 42s) | Production container build clean |
| **Lint · types · tests** | **success** (2m 28s) | ESLint 0, tsc 0, Vitest **1,611 passed / 0 failed** |
| **Build · Playwright** | **success** (5m 12s) | Worker probe PASS, Playwright **199 passed / 0 failed** |
| **CI required checks** | **success** (4s) | 7/7 required gates satisfied |

Migration validation includes `prisma validate`, the migration-order preflight, replay/drift
against an empty shadow database, and RLS verification, all as required checks.

---

## 5. What was completed, and where

| Task | Status | Commits |
|---|---|---|
| 1 — approved personalized-copy hand-off | **COMPLETE** | `0511e25`, `1318a6d`, `b552ecd` |
| 2 — exact-SHA CI gating | **COMPLETE** | `f7248e6`, `a589d09` |
| 3 — one proposal → one draft, and recovery | **COMPLETE** | `bcb64c7`, `ed4c801` |
| 4 — auth / session revocation | **COMPLETE** | `7845f8e` |
| 5 — `nextActionAt` historical repair | **COMPLETE** | `dda7377` |
| 5 — canonical QA database | **COMPLETE** | Task 13, from empty |
| 6 — RLS verification | **COMPLETE** | `f9f12d0`, repaired in `4a2533a` |
| 7 — Leadgen → Revenue AI → SDR golden journey | **COMPLETE, 14/14** | `e222657` |
| 8 — ICP adherence | **COMPLETE** | `1f457ac` |
| 9 — A/B variant attribution | **COMPLETE** | `7d65dfb` |
| 10 — documentation convergence | **COMPLETE** | `4a60031`, `8580140` |
| 11 — failure / concurrency test debt | **PARTIAL** | golden journey covers the durable chain; deep crash-injection and the full concurrency matrix remain open |
| 12 — production readiness audit | **REPOSITORY ONLY** | see §8 |
| 13 — final clean acceptance | **COMPLETE** | §3 |
| 14 — this report | **COMPLETE** | — |

### Schema, migrations and security

Three migrations were added on this branch beyond the Phase 10 line:

```
20260814020000_sequence_draft_record          durable grounded drafts
20260815000000_phase10_proposal_draft_guard   CampaignPlaybookVersion.fromProposalId, unique
20260816000000_outbound_variant_attribution   OutboundMessage.abVariantId + sequence/step,
                                              OutcomeSignal.abVariantId
```

Tail is `20260816000000`. Replay from empty is clean and drift is zero, so the datamodel and the
migration history agree — no migration-only index survives here.

**Auth.** `scripts/create-user.ts` increments `User.authVersion` whenever a change governs access
— password, role, or active state — and leaves it alone for a rename, so renaming somebody does
not sign them out. Reactivation revokes too: a token minted before a deactivation must not come
back to life with the account. `--deactivate` exists and is mutually exclusive with `--activate`.
Sessions are stateless JWTs revalidated against that column, so this is the difference between
rotating a password and actually ending the sessions it opened.

**RLS.** `scripts/verify-rls.mjs` builds a throwaway database, connects as a **non-superuser**
(superusers bypass RLS entirely — `FORCE` closes the table-owner loophole, not that one), and
proves 14 properties including cross-tenant read, update, delete, insert-attribution and
fail-closed-with-no-context. Coverage now includes `Meeting`, `Opportunity`, `CampaignPlaybook`,
`PlaybookProposal`, `OutcomeSignal`, `SequenceEnrollment` and **`SequenceStepCopy`** — the last of
those holds approved prospect-facing wording, so a leak there discloses another tenant's outreach
copy rather than a name and a company.

---

## 6. The evidence that matters most

### Personalization: the words a human approved are the words that send

`tests/golden-journey.test.ts` asserts the chain end to end against a real Postgres, and this is
the assertion the whole feature exists for:

```
draft (model)  →  human edits it while approving  →  approval row stores the edit
               →  SequenceStepCopy carries the human wording, durable, before any task is executable
               →  OutboundMessage.subject / .body are those exact strings
```

The edit rides the **same compare-and-set that stamps the decision** — args and decision have to
move together, because execution replays the args, and a retry landing between two separate writes
would send wording nobody signed. `aiGenerated` is derived by diffing each step against the draft,
never taken from the caller: a byte-identical step keeps the model's provenance, a rewritten one
becomes the human's. The model's original draft survives untouched in `SequenceDraftRecord`, so
the edit stays legible afterwards.

**No AI provider is configured anywhere in that test.** The approved wording still reaches the
outbound record — which is what "AI down must never mean CRM down" has to mean in practice.

### Leadgen: adherence is measured, and missing data is never a match

`lib/leadgen/icpAdherence.ts` measures delivered pool items against `CampaignLeadRequirement` —
the ICP lives there and nowhere else; the playbook contract is `.strict()` and rejects an `icp`
key. It calls `matchRequirement`, the same matcher behind the per-lead assessment, exported rather
than duplicated, so a percentage can never disagree with the assessment shown beside it.

Four outcomes, and the last two are the point: `matched`, `mismatched`, `unknown` (nothing fails,
but the CRM holds no value for some criterion) and `unevaluated`. Counting `unknown` as matched
would inflate adherence exactly where the data is worst — where a client is most likely to
disagree. A campaign with no criteria configured reads "not measured", never 0%.

### A/B attribution: stored at send, never inferred

`OutboundMessage.abVariantId` is written in the same statement that records the send. Selection is
deterministic from the seed inputs, so a report that recomputed it would silently change its answer
about the past the day those inputs or the variant set changed — deciding again what an
already-sent message *was* is not reporting.

`OutcomeSignal.abVariantId` is a **separate axis** from `playbookVersionId`, not a finer grain of
it. A version is the policy the cadence ran under; a variant is which wording this prospect got
under that policy. Collapsing them would make "variant B wins" and "the new playbook wins" the same
sentence.

A personalized send attributes to **no** variant: the approval overrode selection, so nothing was
on trial, and counting it would put messages the experiment never sent into its result.

### Learning: one proposal, at most one draft — enforced by the database

`CampaignPlaybookVersion.fromProposalId` is unique, so a second draft is refused by PostgreSQL
rather than by statement ordering. `tests/phase-10-draft-guard-db.test.ts` goes at the constraint
directly, bypassing every service-level guard, and requires `P2002`. The residual
approved-with-no-draft case has a runnable repair: `npm run repair:approved-proposals`, dry-run by
default, idempotent, finishing the decision without retaking it.

Approval remains a **recorded decision, never a stored permission**: an approval creates a draft,
changes nothing in force, and activates nothing.

---

## 7. Defects found during this work

Every one was in a gate or a test, not in shipped product behaviour.

| Defect | Where | Resolution |
|---|---|---|
| Extended RLS verifier never ran — every new INSERT named columns the schema does not have | `scripts/verify-rls.mjs` | rewritten against the real models, `SequenceStepCopy` added (`4a2533a`) |
| `tsc` failing while every gate reported 0 — output piped through `tail`, so the exit code belonged to `tail` | session tooling | real error fixed (`986be39`); gates now capture the tool's own exit code |
| Widened Playwright matrix had no audit fixture or demo tenant | `.github/workflows/ci.yml` | preconditions added (`a589d09`) |
| Approval could not carry a human edit | `lib/workorders/approvals.ts` | `editedCopy` on the decision (`b552ecd`) |
| `completeApprovedProposal` had no caller — a recovery path nobody could invoke | `lib/learning/proposals.ts` | `scripts/repair-approved-proposals.ts` (`ed4c801`) |
| Fixture never cleaned templates/mailboxes/messages — suites failed on their *second* run | `tests/helpers/workOrderFixture.ts` | teardown extended (`7d65dfb`) |

**The golden journey found no product defect.** Its three initial failures were all test defects,
and one is worth carrying forward: `workers/sequence.ts` reads approved copy through
`expectedEnrollmentId`, which arrives in the **job payload** rather than being re-derived from the
task. A caller that omits it correctly falls back to the shared template — and looks exactly like
"personalization silently doesn't work". It is not.

---

## 8. Readiness

### INTERNAL TEST READY — **YES**

Every gate green on the exact SHA, acceptance re-run from an empty database, the whole business
covered by one durable-state test. Operating restrictions still apply and are still correct: no
external users, no real client data, live sending off, email dry-run.

### PILOT READY — **YES, conditionally**

The product is ready for a controlled pilot. The conditions are infrastructure, not code, and they
are listed below. A pilot that sends real mail to real prospects requires the P2 items resolved
first — in particular TLS, since real client credentials must never cross plain HTTP.

### PRODUCTION READY — **NO**

Not because of a known product defect, but because the infrastructure that would carry it has not
been verified. **Repository evidence is not evidence about a running environment.** The items in
§9 are open until someone verifies them against the live box.

---

## 9. Open items

### P0 — none

No known defect blocks the candidate.

### P1 — none

### P2 — infrastructure, blocking **production**, not the merge

| Item | Why it blocks |
|---|---|
| **TLS ingress termination** | real client credentials must never cross plain HTTP. Verify against the actual public endpoint, not a runbook |
| **Managed / durable Redis** for a multi-worker fleet | BullMQ is transport and is rebuildable from database truth, so this is a recovery-time and operability concern rather than a correctness one — but a VM-local Redis is not a fleet story |
| **Worker daemon / systemd setup** | the sequence and email workers must survive a reboot and restart on failure. Nothing in this repository proves they do |

None of these may be closed from repository evidence. Each needs the live environment.

### P3 — non-blocking debt

- 12 pre-existing `@typescript-eslint/no-require-imports` errors in `scripts/*.cjs`, outside the
  configured lint scope (`npm run lint` is clean).
- `tests/redis-integration.test.ts` skips without a local Redis. That is correct locally and
  **must not** be allowed to skip in CI — an unreachable `REDIS_URL` there means the service
  container is broken.
- Deep crash-injection beyond the six covered resume points, and the full concurrency matrix
  (Task 11 remainder).
- `S2`/`S4`-adjacent items are closed; `S3` closed the reply gate but `Lead.sequenceStatus` remains
  a deprecated compatibility cache — add no new reader, no new writer.
- The Revenue AI → Telestar AI Architecture rename remains deliberately deferred.

### Live-environment status — **unverified, by category**

| Item | Status |
|---|---|
| TLS | **REQUIRES LIVE ACCESS** |
| Automated backups + restore drill | **REQUIRES LIVE ACCESS** |
| Deployed SHA / image digest | **REQUIRES LIVE ACCESS** |
| RLS enabled on the deployment | **REQUIRES LIVE ACCESS** — verified in CI against a throwaway database only |
| Redis durability | **REQUIRES LIVE ACCESS** |
| Migration level of the deployed database | **REQUIRES LIVE ACCESS** |
| Rollback tooling exercised | **REQUIRES LIVE ACCESS** |
| Email send safety | **VERIFIED IN REPOSITORY** — dry-run default, asserted by `deep-smoke` |
| Demo credentials rotated on the live box | **REQUIRES LIVE ACCESS** — the tool that does it safely now exists; whether it has been *run* cannot be established from here |

---

## 10. Independent verification

Agent B independently verified exact candidate `d8a9f67fffe9ea1df9be16b4bfea2fc059870dfa`:
golden journey 14/14, worker bootstrap resolver, worker consumer probe PASS, 46 migrations,
schema drift 0, RLS 14/14, Vitest 1,611 passed / 0 failed, Docker build PASS, Playwright 199/199 PASS.

---

## 11. Recommendation

Merge PR #67 to `main` **as an internal release**, then resolve the three P2 infrastructure items
and verify them against the live environment before any production or client-facing use.

Do not treat merging as production readiness. The two decisions are separate, and §8 says which is
which.
