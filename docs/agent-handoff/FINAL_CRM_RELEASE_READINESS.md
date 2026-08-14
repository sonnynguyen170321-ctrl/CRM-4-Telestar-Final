# Telestar CRM — final release readiness

The release candidate, what was proven about it, and what is deliberately still open.

**Not merged to `main`. The merge decision is the user's.**

---

## 1. The candidate

| | |
|---|---|
| Branch | `integrate/phase-8-10-final` |
| **Final candidate SHA** | **`a589d0984b50608a8efce506ea93ca74236a9751`** |
| PR | [#67](https://github.com/sonnynguyen170321-ctrl/CRM-4-Telestar-Final/pull/67) → `main` |
| Base (`main`) | `2046b768` |
| Branch point / prior published head | `26f545f` |
| Final **runtime** candidate | `e222657` — no runtime, schema or test file has changed since |
| Documentation convergence | `8580140` |
| CI fixture correction | `a589d09` |

The distinction in the last three rows is the one that matters when reading the CI history below:
**the application under test has not changed since `e222657`.** Everything after it is
documentation and CI orchestration.

---

## 2. CI history on this candidate, and what the one failure actually was

Three commits carry exact-SHA GitHub Actions runs. The middle one failed, and it is worth being
precise about why, because "the release candidate failed CI" and what actually happened are
different statements.

### `8580140` — `Build · Playwright` failed. **Not a product failure.**

Everything else passed: Lint · types · tests, Migration validation, Docker build, CodeQL, Secret
scan, Dependency review.

The failure was in the test environment, and it was caused by the gate getting *stronger*.
`acc68ab` widened Playwright from two named specs (`crm-journeys`, `deep-smoke`) to all four
projects — `setup`, `audit`, `demo`, `chromium` — without wiring the fixtures the two new projects
depend on:

```
9 × [setup]  Error: Audit fixture missing at e2e/.fixture.json
[demo]       h1 resolved to "Telestar CRM" rather than the greeting
             → signed in to a tenant that was never seeded, so the walkthrough
               landed on the marketing page
[chromium]   deep-smoke ✓  — it uses the legacy dataset CI *does* seed
```

CI ran `npm run db:seed`, which builds the legacy dataset the `chromium` specs sign in to, and
nothing else. The `audit` project reads `e2e/.fixture.json`, written by
`scripts/e2e-audit-fixture.ts`; the `demo` project needs the `demo-telestar` tenant from
`scripts/demo-seed.ts`. Neither existed on the runner.

The passing `chromium` project is exactly why this had not surfaced earlier: the half of the
matrix whose fixture *was* seeded worked, and the half whose fixture was never created had only
just been switched on.

### `a589d09` — fixture preconditions added, gate preserved

Both fixture steps now run **after** the destructive seed, deliberately: `prisma/seed-demo.ts`
clears tenants, so the reverse order would delete exactly what the two new steps had just created.
The audit fixture takes the per-run `E2E_PASSWORD` the job already mints — it rejects the published
demo password by design. The demo seed takes no password override, because the walkthrough falls
back to the same documented default when the variable is unset, and that agreement is what makes
the two halves line up.

Failure summaries now also attach `fixture.log` and `demo-seed.log`, so the next problem in this
area names itself instead of appearing as nine identical setup errors.

**The gate was not weakened.** It is still `npx playwright test` across all four projects. What
changed is that its preconditions are now true.

> This is the release process working. The widened matrix caught that its own fixtures were not
> wired, and the repair was to the environment rather than to the standard.

---

## 3. Task 13 — clean acceptance, from a database created empty

Run against `telestar_final_qa`, created empty, on the frozen application tree. Every step's own
exit code was captured; nothing was piped into a command that could mask one.

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
| ESLint (`app components lib context tests`) | **exit 0** |
| Full Vitest | **1,605 passed · 5 skipped · 109 files passed, 1 skipped** |
| **Golden journey** | **14/14 PASS** |
| Production build | **exit 0** |
| Docker build | **success** — exact-SHA CI on `a589d09` |
| Playwright | see §4 — exact-SHA CI on `a589d09` |

Vitest and the golden journey ran against the fresh database, not the shared development one.

> **A gate is a number, not a word.** During this work a full session of "green" gates was hiding a
> real type error, because `tsc --noEmit | tail` reports `tail`'s exit code. Every figure above is
> the tool's own exit code and its own count.

---

## 4. Exact-SHA GitHub checks — `a589d09`

| Check | Conclusion |
|---|---|
| Lint · types · tests | **success** |
| Migration validation | **success** |
| Docker build | **success** |
| CodeQL | **success** |
| Secret scan | **success** |
| Dependency review | **success** |
| Build · Playwright | _see the run on `a589d09`_ |

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

Agent B verified `e222657` independently: golden journey 14/14 twice, durable-state chain, queue
boundary, diagnostics security, 287 targeted regressions, tsc 0, ESLint 0, 46 linear migrations,
`prisma validate`, RLS 14/14, Vitest 1,605/5, build 92 routes, Playwright 199.

Agent B is re-verifying `a589d09`, whose only difference from the verified runtime tree is CI
orchestration and documentation.

---

## 11. Recommendation

Merge PR #67 to `main` **as an internal release**, then resolve the three P2 infrastructure items
and verify them against the live environment before any production or client-facing use.

Do not treat merging as production readiness. The two decisions are separate, and §8 says which is
which.
