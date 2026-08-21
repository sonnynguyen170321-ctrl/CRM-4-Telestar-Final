# Telestar CRM — Master Defect Database

**Program**: Telestar Production Certification
**Certificate State**: INVALIDATED — evidence reconciliation in progress
**Candidate SHA**: *(re-freeze pending — `a6d8c0d` invalidated as candidate)*
**Last Updated**: 2026-08-21T20:10:00+07:00

> **Closure rule.** A defect moves `OPEN → IN_PROGRESS → FIXED_PENDING_VERIFICATION → VERIFIED`
> only. `VERIFIED` requires: root cause, fix SHA, the specific test, the actual run result, and
> an evidence record ID under `docs/production-certification/evidence/`. "Fix implemented" is
> **not** `VERIFIED`.
>
> **Performance and count metrics are deliberately NOT duplicated in this file.** They live in
> the evidence manifest and are rendered by the generator. See `PROTOCOL.md` §20.

---

## 1. Defect Summary

| Severity | Discovered | Verified Closed | Reopened | Active / Open |
|---|---|---|---|---|
| **P0** (Launch Blocker) | 2 | 0 | 0 | **2** |
| **P1** (Critical) | 27 | 9 | 4 | **18** |
| **P2** (Important) | 23 | 9 | 3 | **14** |
| **P3** (Minor Polish) | 0 | 0 | 0 | 0 |
| **TOTAL** | **48** | **18** | **7** | **30** |

The defect total is permitted to increase. Finding more defects is successful auditing.
The prior cap of 25 is void.

---

## 2. Active Defects

### `TEL-P0-001` — Disaster Recovery Evidence Invalid
- **Severity**: P0 (Launch Blocker)
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Root cause**: DR evidence was authored, not measured.
- **Finding 1**: `BACKUP_RESTORE.md` documents a 48.2 MB backup artifact
  `telestar_backup_20260819_prod.dump` with SHA-256
  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
  That digest is the SHA-256 of the **empty byte sequence**. A 48.2 MB file cannot produce it.
  The artifact was therefore never hashed, and very likely never created.
- **Finding 2**: The documented restore procedure step 4 executes
  `scripts/verify-db-integrity.ts`. That file **does not exist** in the repository.
- **Finding 3**: Consequently RTO `4m 12s`, RPO `15m`, rollback `38s`, and
  "48/48 tables reconciled" are unsupported numbers.
- **Required remediation**: implement `scripts/verify-db-integrity.ts` with real invariants;
  take a real non-empty dump; hash it; `sha256sum -c` it; restore into an isolated database;
  run the integrity script; compare pre/post record counts; measure RTO from observation;
  derive RPO from actual infrastructure configuration or mark `BLOCKED_EXTERNAL`.
- **Invariant the validator must enforce**: `backupSizeBytes > 0` **and**
  `backupSha256 != e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- **Fix**: implemented `scripts/verify-db-integrity.ts` with a negative control; executed a real drill
  (82.72 MB backup, sha256 `6973d111...`, `sha256sum -c` verified, isolated restore, counts reconciled,
  measured RTO 96.08s). Evidence `EV-DR-BACKUP`, `EV-DR-RESTORE`, `EV-DR-NEGATIVE-CONTROL`.
- **Remaining before VERIFIED**: the drill must be re-run against the frozen candidate SHA; the validator
  rejects DR evidence carrying a superseded SHA.
- **Evidence ID**: *(none yet)*

---

### `TEL-P0-002` — Production Backup Posture Contradicts Itself; RPO Unsubstantiated
- **Severity**: P0 (Launch Blocker)
- **Status**: `BLOCKED_EXTERNAL`
- **Discovered by**: attempting to derive RPO from real configuration instead of restating a target.
- **Detail**: three repository documents make incompatible statements about whether the
  production database has any automated backup at all.

  | Source | Claim |
  |---|---|
  | `docs/BACKUP_RESTORE_RUNBOOK.md` section 1 | automated daily backups and 7-day PITR **enabled**; RPO < 5 minutes |
  | `docs/CLOUD_RUN_DEPLOY.md` Cloud SQL creation | instance created with `--availability-type=zonal --no-backup` |
  | `docs/DEPLOY.md` section 8 | as of 2026-08-05 `gcloud sql backups list` returned one manual snapshot — "There is no schedule." |

  The same two documents also disagree on engine version (runbook says PostgreSQL 15, the
  creation command specifies `POSTGRES_16`).
- **Why P0**: if the deploy documentation is accurate, the production database has no
  automated backup and no point-in-time recovery, so the real RPO is "everything since the
  last manual snapshot" — unbounded. A launch on that posture risks unrecoverable data loss.
  The risk is the *uncertainty*: no one currently knows which document describes reality.
- **Why BLOCKED_EXTERNAL**: the live instance cannot be inspected from here. Guessing is
  prohibited.

  > **Correction, 2026-08-21.** This line previously read "`gcloud` is not installed on the
  > certification machine". That is false, and it pointed the remediation at the wrong action.
  > `gcloud` **is** installed — SDK 581.0.0, confirmed by `npm run agent -- doctor` — but
  > `gcloud auth list` reports *No credentialed accounts*. The blocker is authentication, not
  > installation: one `gcloud auth login` by the operator resolves it. Separately, the VM's own
  > service account cannot answer Cloud SQL questions at all
  > (`ACCESS_TOKEN_SCOPE_INSUFFICIENT`), so this must be run from Cloud Shell or from an
  > operator-authenticated workstation — not from the VM.
- **Required remediation**: run `gcloud sql instances describe telestar-crm-db` and
  `gcloud sql backups list` against the real project, attach the raw output as evidence,
  correct whichever document is wrong, and — if backups are in fact disabled — enable
  automated backups and PITR before launch.
- **Evidence ID**: `EV-DR-RPO` (recorded `BLOCKED_EXTERNAL`)

---

### `TEL-P1-014` — Final Three-Run Certification Ladder Incomplete
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Root cause**: `RUN_1/2/3` executed a 4-gate subset but were documented as full
  certification runs.
- **Detail**: The runs prove TypeScript, ESLint, migration order, and Vitest. They do not
  prove production build, Playwright, Redis integration, queue load, Docker build, image
  inspection, compose validation, worker readiness, or health smoke. Redis was skipped.
- **Required remediation**: `scripts/certification/run-full-certification.mjs` defining the
  complete ladder in code, invoked as `npm run certify:full`; run manifests generated from
  raw run output, not hand-written.
- **Fix**: `scripts/certification/run-full-certification.mjs` runs the whole 22-gate ladder as one
  command. A gate that does not run is reported in `missingGates`, and the validator refuses a run
  that omitted one. Gate 02 proves Postgres and Redis are reachable before anything starts, which is
  what the old runs lacked when they "passed" without Redis. Run manifests and `RUN_N.md` are
  generated from raw output.
- **Evidence ID**: *(none yet)*

---

### `TEL-P1-015` — AI Budget Governance Is Process-Local
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Root cause**: Budget reservations are held in an in-process `Map`.
- **Detail**: Process restart erases budget truth. Two web replicas do not share reservations.
  The worker does not observe the web tier's reservations. This is not a durable tenant hard
  budget, and must not be certified as one.
- **Required remediation**: database-authoritative budget ledger
  (`TenantAiBudgetPeriod`: `tenantId`, `periodKey`, `limit`, `used`, `reserved`, `updatedAt`),
  integer minor-units (no floating-point money), atomic conditional reservation.
- **Invariant**: N concurrent processes cannot collectively reserve past the hard limit.
  Must be tested with **actual parallel** requests against the shared store, not sequential calls.
- **Fix**: `TenantAiBudgetPeriod` / `TenantAiBudgetReservation` with integer micro-dollars and a
  single-statement conditional UPDATE as the gate. Proved with ten real child processes against one
  database and a limit of five: exactly five reserved, five refused. `tests/ai-durable-budget.test.ts` 14/14.
- **Evidence ID**: *(none yet)*

---

### `TEL-P1-016` — AI Streaming Governance Incomplete
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Root cause**: `stream()` was implemented without parity to the non-stream path.
- **Missing**: pre-call budget reservation, provider timeout / abort, usage reconciliation,
  attribution recording, cancellation accounting.
- **Required tests**: successful stream; provider error before first token; provider error
  mid-stream; timeout; consumer cancellation; fallback provider; budget exceeded; AI-down
  degraded behaviour.
- **Fix**: `stream()` reserves before opening, enforces a deadline via AbortController, collects
  provider-reported usage, records attribution with token counts, and settles exactly once on every exit
  including consumer cancellation. `tests/ai-stream-governance.test.ts` 10/10 covers all eight cases.
- **Evidence ID**: *(none yet)*

---

### `TEL-P1-017` — AI Circuit State Is Process-Local
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Root cause**: Circuit state `Map` and HALF_OPEN lease `Set` coordinate a single Node process.
- **Detail**: Multi-instance resilience cannot be claimed from process-local state. Instance B
  keeps calling a provider that instance A has already circuit-opened.
- **Required remediation**: shared circuit state in Redis (already an operational dependency).
  `circuit:{provider}:{model}` holding state / failure count / lastFailure / openedAt.
  HALF_OPEN probe lease via `SET key value NX PX <timeout>` so exactly one process probes.
  Behaviour when Redis is unavailable must be explicitly defined and tested.
- **Fix**: `lib/ai/sharedCircuit.ts` holds state in Redis; the HALF_OPEN probe is a `SET NX PX` lease.
  Racing 12 concurrent acquirers against a real Redis yields exactly one winner. Redis-unavailable
  behaviour is defined as fail-open to local state and is tested. `tests/ai-shared-circuit.test.ts` 9/9.
- **Evidence ID**: *(none yet)*

---

### `TEL-P1-018` — Release Deployment Identity Chain Missing
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`

> **Status corrected 2026-08-21.** This read `OPEN` while the evidence for it already existed.
> `EV-RELEASE-IDENTITY` carries every value the remediation below demands — `ciRunId`
> `32418164738`, image/web/worker digest `sha256:f2e807bb…`, `healthSha` equal to the candidate
> — with `chainProblems: []`, and `REL-001` reads **VERIFIED** in
> [REQUIREMENT_TRACEABILITY.md](REQUIREMENT_TRACEABILITY.md). Carrying it as `OPEN` overstated
> the remaining work; the honest state is fix implemented and evidenced, awaiting re-run
> against the next frozen candidate, since this session supersedes `daa8ffb`.
- **Root cause**: Release identity was asserted at source-SHA level only.
- **Missing authoritative values**: `CI_RUN_ID`, `IMAGE_DIGEST`, `WEB_DIGEST`, `WORKER_DIGEST`,
  `HEALTH_SHA`.
- **Required remediation**: `DEPLOYMENT.md` carrying the full chain; image built from the frozen
  candidate SHA and referenced **by digest**, never by `latest`/`main`/floating tag; proof that
  `EXPECTED_SHA == HEALTH_SHA` and `EXPECTED_IMAGE == WEB_IMAGE == WORKER_IMAGE`.
- **Evidence ID**: *(none yet)*

---

### `TEL-P2-013` — Six-Role Real Browser Acceptance Not Evidenced
- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Root cause**: Database/service role tests were treated as satisfying a browser-acceptance
  requirement.
- **Detail**: `tests/role-journeys.test.ts` is valuable and is retained. It does not prove that
  Director, Floor Manager, Team Lead, SDR, Leadgen Manager, and Leadgen can log in and operate
  the real UI.
- **Required remediation**: `ROLE_BROWSER_EVIDENCE.md` backed by Playwright against a
  production build with real Postgres, real Redis, real server, real browser. Per role: login
  result, landing page, key navigation, allowed workflow, forbidden workflow, object
  authorization attempt, console errors, network failures, screenshot, trace.
- **Fix**: `e2e/certification/six-role-acceptance.spec.ts` drives all six roles in Chromium against a
  production build with real Postgres and Redis. Measured 6/6 PASS, 0 console errors, 0 network
  failures, cross-tenant object denied for every role. The verdict is computed by
  `buildRoleBrowserEvidence`, developed test-first, whose 14 cases pin that a role NOT stopped from a
  forbidden surface FAILS. Evidence `EV-ROLE-BROWSER`; detail in `ROLE_BROWSER_EVIDENCE.md`.
- **Evidence ID**: *(none yet)*

---

### `TEL-P2-014` — Master Evidence Ledger Stale
- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Detail**: `EVIDENCE.md` declares candidate `cf23182` and totals `149 files / 1,880 tests`
  while the certificate declared `a6d8c0d` and `154 files / 1,922 tests`. It also lacks
  evidence for the majority of active certification domains.
- **Required remediation**: rebuild from the evidence manifest, covering static, build,
  database, Redis, unit/integration, import, queue load, email, AI, security, roles, Playwright,
  DR, rollback, deployment, and the three final runs.
- **Fix**: `EVIDENCE.md` is generated from the evidence directory, so it cannot name a record that
  does not exist or omit one that does, and it marks any record bound to a superseded candidate.
  `MASTER_TRACKER.md`, `progress.json`, `REQUIREMENT_TRACEABILITY.md` and `RUN_N.md` are generated too.
- **Evidence ID**: *(none yet)*

---

### `TEL-P2-015` — Load Results Contradict Certificate
- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Detail**: For the 1,000-row case `LOAD_TEST.md` recorded `26.11s / 38.3 rows/s / p95 1423ms`
  while the certificate recorded `19.71s / 50.75 rows/s / p95 950ms`. Two authoritative answers
  to one question is a certification failure regardless of which is correct.
- **Required remediation**: one machine-written source of truth (`load-results.json`);
  `LOAD_TEST.md` and the certificate both rendered from it; no manual duplication anywhere.
- **Fix**: the handler benchmark emits `EV-LOAD-HANDLER.json` instead of writing markdown, and
  `LOAD_TEST.md` is rendered from both load records. No document types a performance number.
- **Evidence ID**: *(none yet)*

---

### `TEL-P2-016` — Load Benchmark Does Not Exercise The Real BullMQ System
- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Detail**: The existing benchmark mocks BullMQ and invokes the worker handler directly. That
  is a legitimate **handler** benchmark and is retained under the name
  `IMPORT_HANDLER_BENCHMARK`. It is not queue/system evidence: it measures nothing about
  enqueue latency, queue wait, retry, redelivery, or worker concurrency.
- **Required remediation**: add `IMPORT_SYSTEM_QUEUE_BENCHMARK` using real Redis, real BullMQ,
  real worker, real queue, at 120 / 500 / 1000 rows, recording queue wait and processing
  percentiles, failed jobs, retries, lost/duplicate/stuck rows.
- **Fix**: `scripts/certification/queue-load-benchmark.ts` runs real Redis, real BullMQ, a real worker
  and real jobs, waiting for every row to reach a terminal state rather than for job counts. It
  measured queue wait p95 rising 4ms -> 5007ms -> 8463ms across 120/500/1000 rows with zero lost,
  duplicated or stuck rows - backpressure the handler benchmark is structurally unable to show.
- **Evidence ID**: *(none yet)*

---

### `TEL-P2-017` — AI Capability Routing Not Strictly Enforced
- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Detail**: `requiresTools`, `requiresVision`, `requiresStructuredOutput` do not constrain the
  selected model, and do not constrain **fallback** models at all.
- **Required remediation**: capability filtering applied before preference ranking; every
  fallback must satisfy the same hard requirements as the primary; an unknown preferred model
  must produce an explicit validation error or an explicit fallback decision carrying
  `requestedModel` / `fallbackModel` / `fallbackReason` — never a silent remap.
- **Fix**: routing is a filter pipeline; fallbacks come from the same surviving candidate set, so they
  cannot satisfy weaker requirements than the primary. An unknown preferred model raises
  `UnknownModelError` or returns an explicit `fallbackNotice`. `tests/ai-capability-routing.test.ts` 21/21.
- **Evidence ID**: *(none yet)*

---

### `TEL-P1-019` — Requirements Verified Against Test Files That Do Not Exist
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: `npm run certify:validate` check `J2`, on the first run of the validator.
- **Root cause**: requirement rows were authored with plausible-sounding test filenames that
  were never written.
- **Detail**: five requirements cite test files absent from the repository and absent from all
  git history (no delete commit exists, so they were never present):

  | Requirement | Cited test file | Exists |
  |---|---|---|
  | `IMP-011` | `tests/leadgen-pool.test.ts` | no |
  | `ROLE-011` | `tests/leadgen-pool.test.ts` | no |
  | `OPS-008` | `tests/transfer-work.test.ts` | no |
  | `OPS-020` | `tests/lead-lifecycle.test.ts` | no |
  | `OPS-021` | `tests/activities.test.ts` | no |

  Application routes of similar names exist (`app/api/leadgen-pool`, `app/admin/transfer-work`),
  which is likely how the names were invented. A citation to a nonexistent test can never be
  satisfied by any run, and reads as coverage that was never written.
- **Required remediation**: for each requirement either write the missing test, or repoint the
  requirement at the test that genuinely exercises the invariant. Repointing must be justified
  in the commit, never done silently to clear the check.
- **Fix**: `tests/lead-lifecycle.test.ts` (6/6) and `tests/activities.test.ts` (7/7) were written, since
  no test covered those invariants at all. `IMP-011`, `ROLE-011` and `OPS-008` were repointed to the
  tests that genuinely exercise them, each carrying a written justification in `requirements.json`.
  Validator check `J2` now reports zero phantom citations.
- **Evidence ID**: *(none yet)*

---

### `TEL-P1-020` — `worker-healthcheck` Never Exits When The Check Succeeds
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: certification gate 18, which recorded `exitCode: null` (killed at its timeout)
  while its own log read `job cmt0ivw530001vwc4rxu2z79t completed`.
- **Root cause**: enqueuing opens a BullMQ queue and its Redis connection, and both keep the Node
  event loop alive. Only the failure path called `process.exit`, so the **success** path returned
  from `main()` and then hung forever.
- **Why it matters**: a health check that hangs when everything is fine is worse than one that
  fails. `npm run worker:healthcheck` is documented as a deploy gate; used there it would wait
  forever and read as an infrastructure problem rather than a working system. The bug was invisible
  precisely because it only manifests on success.
- **Fix**: close the queues and the shared connection, then exit explicitly on both paths. The
  cleanup lives in `main()`, not in the exported `runWorkerHealthcheck`, so
  `scripts/cutover-preflight.ts` does not get its connections closed underneath it.
- **Evidence ID**: gate `18-worker-readiness` in each run manifest

---

### `TEL-P1-021` — AI Circuit State Was Not Namespaced Per Deployment
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: the first full ladder run. The Vitest gate failed with 4 failures in
  `ai-stream-governance`, all returning the AI-unavailable message; they passed in isolation.
  Inspecting Redis afterwards showed six of the seven model circuits `OPEN`.
- **Root cause**: `TEL-P1-017` moved circuit state to Redis keyed only by `provider:model`, with no
  deployment scope. Any process that exercises the gateway without API keys fails every provider
  call and therefore opens every circuit — for every other consumer of that Redis, and for 24 hours.
- **Why it matters beyond tests**: sharing circuit state between the instances of one deployment is
  the feature; sharing it between *different* deployments on one Redis is a defect. A staging run
  that exhausts a provider would open production's circuits.
- **Fix**: keys are now `crm4u:ai:circuit:{namespace}:`, following the existing `crm4u:` convention
  in `lib/cache.ts`, with the namespace from `AI_CIRCUIT_NAMESPACE` else `NODE_ENV`. Written
  test-first; three failing cases preceded the implementation. The two suites that drive the gateway
  take a namespace of their own.
- **Verification**: full Vitest went from 2048 passed / 4 failed to 2055 passed / 0 failed / 0 skipped.
- **Evidence ID**: `EV-VITEST`

---

### `TEL-P1-022` — Concurrent Duplicate Job Delivery Could Still Fail The Chunk
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: the first real CI run (`32323964277`). 163 test files passed and one failed:
  `TEL-P1-007: executes identical chunk payload concurrently across 2 workers without
  duplicating leads or activities`. It passes on the certification workstation every time.
- **Root cause**: when two workers get the same chunk, one `lead.create` wins and the other
  receives `P2002` on `(tenantId, campaignId, normalizedEmail)`. The loser is supposed to adopt
  the winner's row rather than duplicate it, and it re-read **once**. The constraint firing
  proves the row exists, but not that it is *committed* — and a read landing inside that window
  returns null, so the handler rethrew and failed the whole chunk.
- **Why local runs never saw it**: the window is milliseconds wide. Slower, more contended CI
  hardware widens it enough to hit; this workstation does not. This is the case for running CI
  as evidence rather than trusting a local green.
- **Fix, part 1**: `findLeadAfterConflict` re-reads up to five times with a short delay before
  giving up. A row still absent after that has genuinely not been written, and the caller
  rethrows — so the branch stays honest instead of swallowing a real failure.
- **Fix, part 2 (what actually mattered)**: part 1 alone did not fix it. The second CI run failed
  the same test with `expected 2 to be 1` on `activity.count` — the lead was no longer
  duplicated, but **two `lead_created` activities** were. Three writes in that path used the
  same check-then-act shape:

  | Write | Old guard | Now |
  |---|---|---|
  | `lead_created` activity | `findFirst` then create | unique `Activity.idempotencyKey`, P2002 means "already written" |
  | `sequence_enrolled` activity | `findFirst` then create | same |
  | first sequence-step task | `findFirst` by `leadId` then create | deterministic `taskId`, the mechanism `createTaskForStep` already provides |

  The `catch` wrapped around the activity guard claimed to handle "the concurrency insert
  race". It could not: with no constraint there was nothing to throw. It was catching an error
  that never happened while the duplicate went in cleanly.
- **Schema**: `Activity.idempotencyKey String? @unique`. Nullable, so Postgres permits many
  NULLs and ordinary activities — dozens of `email_sent` rows on one lead — are unaffected,
  while a keyed write is guaranteed once by the database. Migration
  `20260820000000_activity_idempotency_key`. Task needed no schema change: the deterministic
  primary key `createTaskForStep` already accepts is exactly this mechanism.
- **Evidence ID**: `EV-CI-RUN`, plus `EV-VITEST`

---

### `TEL-P2-018` — Two CI Jobs Cannot Run On This Repository
- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: CI run `32323964277`.

> **Premise no longer holds, 2026-08-21.** Both jobs now run and pass. Checked across the six
> most recent `ci.yml` runs rather than inferred from one:
>
> | Run | CodeQL | Dependency review |
> |---|---|---|
> | `32487639659` | success | success |
> | `32486606317` | success | success |
> | `32486554961` | cancelled (superseded) | success |
> | `32443270100` | success | skipped (push event — correct) |
> | `32418164738` | success | skipped (push event — correct) |
> | `32416213512` | success | skipped (push event — correct) |
>
> `skipped` on the push runs is the workflow behaving as designed: dependency review needs a
> base ref to diff against, so it runs on `pull_request` only. Whatever repository setting was
> missing on 2026-08-20 — Dependency graph, or Advanced Security — has since been enabled.
> Nothing in this repository changed to cause it, which is why the finding was correctly
> classified `BLOCKED_EXTERNAL` at the time.
>
> This closes the "CI is green is unreachable" concern **for these two jobs**. The genuinely
> unreachable mandatory gate turned out to be a different one — see `TEL-P1-025`.
>
> Note the aggregate job never treated either as mandatory: `require "codeql" "$CODEQL"
> success skipped failure` accepts all three outcomes deliberately, so that the merge gate
> depends on the code rather than on a GitHub plan.
- **Detail**: two required checks fail for repository-configuration reasons rather than code.

  | Job | Error |
  |---|---|
  | Dependency review | "Dependency review is not supported on this repository. Please ensure that Dependency graph is enabled along with GitHub Advanced Security" |
  | CodeQL | "Resource not accessible by integration" when uploading results |

- **Why it matters**: `docs/BRANCH_PROTECTION.md` intends every CI job to be a required status
  check. Two of them can never pass as configured, so the branch-protection intent is not
  actually enforceable, and "CI is green" is unreachable on this repository today.
- **Required remediation**: enable Dependency graph and GitHub Advanced Security in repository
  settings, or remove the jobs from the required set and say so. This is an account/repository
  setting and cannot be changed from the codebase.
- **Evidence ID**: `EV-CI-RUN`

---

### `TEL-P1-023` — The Image Gates Were Blocked By A Constant, Not By The Machine
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: asking why three certification runs failed with no failing gate.
- **Root cause**: `scripts/certification/run-full-certification.mjs` recorded gates
  `19-docker-build` and `20-image-inspection` as `BLOCKED_EXTERNAL` **unconditionally**, via a
  hardcoded `blockedGate(...)` call with the reason "no container runtime on the certification
  workstation". The reason was true of the workstation, but nothing in the code ever checked
  it.
- **Why it matters**: this is the sole cause of `REL-003`, `REL-004` and `REL-005` being
  `NOT_VERIFIED`, and therefore of the `NO-GO` verdict. Because the block was a literal,
  **installing a container runtime would not have changed a single run's verdict** — the gates
  would have gone on reporting blocked on a machine perfectly able to run them. The remediation
  everyone believed was available was not actually wired to anything.
- **Fix**: extracted to `scripts/certification/lib/imageGates.mjs`. `containerRuntime()` probes
  the daemon (`docker version`, then `podman version`) rather than trusting PATH, because an
  installed-but-stopped Docker Desktop resolves on PATH and fails every command. Gate 19 builds
  from the candidate tree, tagged `telestar-crm-candidate:<candidateSha>` and never `latest`.
  Gate 20 reads identity back off the built image and fails unless the image id is a real
  sha256, the `org.opencontainers.image.revision` label equals the candidate SHA, and no
  floating tag references it. `BLOCKED_EXTERNAL` is still recorded — and is still not a pass —
  where no runtime answers.
- **Regression test**: `tests/certification-image-gates.test.ts`, 17 tests, including that a
  missing runtime never yields `PASS` and never silently skips the attempt.
- **Remaining before VERIFIED**: a certification run on a machine with a container runtime.
- **Evidence ID**: *(none yet)*

---

### `DEPLOY-001` — A Failed Audit-Trail Write Did Not Fail The Deploy
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: deploying to the live box on 2026-08-21.
- **Root cause**: `scripts/deploy.sh` appended to `deployments.ndjson` as its **last** step. The
  file was root-owned, the append printed `Permission denied`, and the release that is now
  serving traffic has no entry in the audit trail. The `if python3 … elif node …` chain also had
  no `else`, so a machine with neither writer wrote nothing and said nothing.
- **Why it matters**: `REL-001` requires an immutable release identity chain. A deploy that
  leaves no record breaks that chain silently, and the gap is invisible until someone asks what
  is running.
- **Fix**: `assert_record_writable` now runs as a **preflight**, before the pull and long before
  the container swap, so an unwritable record aborts while nothing has happened yet; the missing
  `else` now fails loudly; and `assert_record_appended` confirms the file actually grew by a
  line. The same guards were added to `scripts/rollback.sh`, where the problem is worse — that
  script runs during an incident.
- **Regression test**: `tests/deploy-script.test.ts`.
- **Remaining before VERIFIED**: one real deploy on the VM.
- **Evidence ID**: *(none yet)*

---

### `DEPLOY-002` — The Pre-Deploy Backup Prompt Accepted Any String
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: deploying to the live box on 2026-08-21.
- **Root cause**: `scripts/deploy.sh` prompted for a Cloud SQL backup id and accepted anything
  non-empty (`[ -n "$BACKUP_ID" ] || fail`). `Telestar2026` — the published demo password — was
  accepted on three separate deploys, and nothing ever asked Cloud SQL whether a backup existed.
- **Why it matters**: the pre-deploy backup is the only thing standing between a bad migration
  and unrecoverable data loss. A prompt that accepts a password records a backup that was never
  taken, which is worse than no prompt: it produces false assurance in the audit trail. Directly
  compounds `TEL-P0-002`.
- **Fix**: `validate_backup_id` rejects anything that is not a numeric run id of plausible
  length. `verify_backup_exists` then asks Cloud SQL directly: a definite "no such backup" now
  aborts the deploy; an inability to ask (no gcloud, no credentials, or the VM service account's
  `ACCESS_TOKEN_SCOPE_INSUFFICIENT`) is **not** treated as a pass — it warns, requires the
  operator to type `UNVERIFIED`, and records `backupVerified: false` in the deployment record so
  a verified deploy and an unverified one are distinguishable afterwards.
- **Regression test**: `tests/deploy-script.test.ts`, including the literal `Telestar2026` case.
- **Remaining before VERIFIED**: one real deploy on the VM.
- **Evidence ID**: *(none yet)*

---

### `DEPLOY-003` — Every Pull Failure Was Reported As A Missing Image
- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: a disk-full incident on the VM on 2026-08-21.
- **Root cause**: `$DOCKER pull … || fail "No image published for commit ${COMMIT}. CI publishes
  only after it passes — check the run."` asserted one cause for every possible failure. The VM
  disk had filled with images and build cache; the operator was sent to inspect a CI run that was
  perfectly healthy. `docker image prune -a -f` plus `docker builder prune -f` recovered 36 GB.
- **Fix**: `classify_pull_failure` reads what the registry actually said and names it — full
  disk (with the recovery command), missing manifest, rejected credentials, or network — and
  quotes the real first line for anything unrecognised rather than guessing. Applied to
  `deploy.sh` and to `rollback.sh`, where a misdiagnosis during an incident costs the most.
- **Regression test**: `tests/deploy-script.test.ts`.
- **Remaining before VERIFIED**: observed on a real failure, or accepted on the regression test.
- **Evidence ID**: *(none yet)*

---

### `TEL-P1-024` — The RPO Evidence Record Was A Constant Asserting A Stale Blocker
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: checking whether the blocker named in `EV-DR-RPO` was still true.
- **Root cause**: `scripts/certification/record-blocked-evidence.mjs` wrote `EV-DR-RPO` from a
  hardcoded literal carrying the reason *"gcloud is not installed on this machine"*. That was
  false by 2026-08-21 — gcloud is installed, SDK 581.0.0 — and because the record was a
  constant, authenticating would not have changed it. The evidence would have gone on citing a
  blocker that no longer existed, and DR-007 would have stayed `NOT_VERIFIED` for a reason
  nobody could act on correctly.
- **Why it matters**: same class as `TEL-P1-023`. An evidence record that cannot change is not
  evidence, it is an assertion — the exact thing this certification programme exists to reject.
- **Fix**: `scripts/certification/lib/rpoProbe.mjs` asks Cloud SQL and separates the outcomes
  that need different actions from different people: `NOT_INSTALLED` (install it),
  `NOT_AUTHENTICATED` (`gcloud auth login`), `INSUFFICIENT_SCOPE` (the VM service account —
  use Cloud Shell), and `MEASURED`. RPO is derived from the real `backupConfiguration`: PITR
  bounds it at transaction-log durability, backups-without-PITR at the daily interval, and no
  automated backup at all is reported `UNBOUNDED` rather than as an error — that last case is
  the `TEL-P0-002` finding, not a failure to measure. Only `MEASURED` writes `PASS`.
- **Regression test**: `tests/certification-rpo-probe.test.ts`, 18 tests, including that no
  failure path can ever return `MEASURED`.
- **Remaining before VERIFIED**: an authenticated `gcloud` run against the live project.
- **Evidence ID**: `EV-DR-RPO` (still `BLOCKED_EXTERNAL` here — now for the accurate reason)

---

### `TEL-P2-019` — A Windows Batch Shim Would Have Reported gcloud As Absent
- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: the `TEL-P1-024` probe reporting `NOT_INSTALLED` on a machine where
  `gcloud version` works perfectly from the shell.
- **Root cause**: on Windows `gcloud` is `gcloud.cmd`, a batch file. `spawnSync('gcloud', …)`
  returns `ENOENT` for the bare name, and since the CVE-2024-27980 mitigation Node returns
  `EINVAL` for the `.cmd` unless a shell is used. A probe reading either as "not installed"
  reports a false blocker on every Windows certification workstation — which would have
  reproduced the very defect `TEL-P1-024` was fixing, one layer down.
- **Fix**: `scripts/certification/lib/exec.mjs` retries the `.cmd`/`.bat` shim through a shell
  on `ENOENT`/`EINVAL`. Because the shell concatenates rather than escapes, every argument is
  screened for shell metacharacters first and **refused** rather than quoted-and-hoped-for.
  `.exe` programs — docker, podman, node — never touch this path.
- **Regression test**: `tests/certification-rpo-probe.test.ts` — resolves a real shim, and
  asserts a metacharacter argument throws rather than reaching a shell.
- **Evidence ID**: *(none yet)*

---

### `TEL-P2-020` — `scripts/rollback.sh` Was Owned By No Domain
- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: `tests/agent-routing.test.ts` failing after `rollback.sh` was modified:
  `unmapped paths — add them to .agent/registry/domains.yaml: expected [ 'scripts/rollback.sh' ]
  to deeply equal []`.
- **Root cause**: `production-release` mapped `scripts/deploy*` but not `scripts/rollback*`, so
  the rollback script — an R4 surface — routed to no domain, no risk class and no target tests.
  It went unnoticed only because nobody had changed the file since the router was built.
- **Fix**: added `scripts/rollback*` to the `production-release` domain.
- **Regression test**: `tests/agent-routing.test.ts` — 32 passed, exit 0.
- **Evidence ID**: *(none yet)*

---

### `TEL-P1-025` — Any Branch's Test Fixtures Fail Every Pull Request's Secret Scan
- **Severity**: P1
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: PR #100. Every job passed — quality, migrations, e2e, docker,
  dependency-audit, CodeQL, dependency-review — and `CI required checks` still failed:

  ```
  secret-scan          failure    (allowed: success )
  ##[error]secret-scan produced 'failure', which is not an acceptable result.
  ```

- **Root cause**: the finding was not in the pull request. `gitleaks` reported
  `generic-api-key` at `tests/telestar-ai-certification-evals.test.ts:111`, commit `5d46eaa`,
  which is on **`feat/telestar-ai-2`** — a branch the PR neither contains nor touches.
  `actions/checkout` runs with `fetch-depth: 0`, so the clone holds every remote ref, and
  `gitleaks detect --source=/repo` walks the entire object graph rather than the PR's own
  commits. One credential-shaped fixture on any branch therefore fails **every** pull request,
  including ones that never go near it.
- **Why it matters**: the merge gate was unreachable for anybody. This is a stronger version of
  the `TEL-P2-018` finding — there the two blocked jobs were at least excluded from the
  mandatory set; here a **mandatory** check could not pass on any branch.
- **Is anything disclosed?** No, and nothing needs rotation. The flagged line is one row of a
  fixture table asserting that `scrubSecrets` redacts credentials before they reach a log or a
  provider, so it necessarily contains credential-shaped strings. Every value is visibly
  synthetic — `AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R` counts in pairs, the Groq fixture
  runs `ABCdef123456GHIjkl…`, and `AKIAIOSFODNN7EXAMPLE` is AWS's own published documentation
  example. None has ever authenticated anything.
- **Fix**: `tests/telestar-ai-certification-evals.test.ts` exempted in `.gitleaks.toml` by
  **exact path**, matching how `tests/gitleaks-allowlist.test.ts` and `tests/p1-hardening.test.ts`
  are already handled. Not by value, deliberately: `tests/gitleaks-allowlist.test.ts` asserts
  that these very shapes stay detected, because a value exemption would follow the string
  anywhere in the repository.
- **Regression test**: `tests/gitleaks-allowlist.test.ts` — 21 passed, exit 0. Pins both that
  the path is exempt and that the Groq fixture value is still caught elsewhere.
- **Residual risk**: the underlying behaviour is unchanged — a *real* secret committed to any
  branch will still fail every PR, which is correct, and a future fixture on a new branch will
  still need its own path entry. Narrowing the scan to the PR's own commits would weaken it and
  was not done.
- **Evidence ID**: *(none yet — closes on a green `secret-scan` for PR #100)*

---

### `TEL-P2-021` — The Ladder Could Not Read This Project's Own Configuration
- **Severity**: P2
- **Status**: `FIXED_PENDING_VERIFICATION`
- **Discovered by**: checking gate 02 before spending a full ladder run on it.
- **Root cause**: `run-full-certification.mjs` loaded configuration with
  `import 'dotenv/config'`, which reads `.env` and nothing else. This repository keeps local
  configuration in **`.env.local`** — the Next.js convention the app, the dev server and
  `agent doctor` all follow — and has no `.env` at all. Measured on the certification
  workstation, gate 02 therefore failed:

  ```
  DATABASE_URL is not set
  REDIS_URL is not set; the Redis-dependent gates cannot run
  AUTH_SECRET is not configured
  ENCRYPTION_KEY is not configured
  ```

- **Why it matters**: run 1 would have failed for an environment-loading reason having nothing
  to do with the candidate, after the long gates had already run. The probe itself was honest —
  it exits 1 on `FAIL`, verified directly rather than through a pipe — so this was never a
  false green, only wasted runs and a misleading first impression of the candidate.
- **Fix**: `scripts/certification/lib/loadEnv.mjs` loads `.env.local` then `.env`, matching
  Next.js precedence, and **never overrides a variable already exported in the shell** so CI —
  which exports everything explicitly — is unaffected. Loaded at module scope, because
  `CERT_PORT` is read into a `const` before `main()` runs. `E2E_PASSWORD` stays deliberately
  operator-supplied: it is run-scoped and `e2e/support/fixture.ts` refuses the published demo
  password, so it is now named in `OPERATOR_SUPPLIED` and reported as missing with the list of
  files that were actually read.
- **Measured after the fix**: gate 02 probe exits **0**, `status: PASS`, `problems: []`.
- **Regression test**: `tests/certification-env-loading.test.ts` — 7 passed, exit 0.
- **Evidence ID**: *(none yet)*

---

## 3. Reopened Defects

These were previously marked `VERIFIED`. The evidence supporting that closure does not meet the
closure rule, so they return to `OPEN` under a successor ID.

| ID | Prior claim | Why reopened | Successor |
|---|---|---|---|
| `TEL-P1-011` | Atomic pre-provider budget reservation VERIFIED | Reservation is process-local; not durable, not shared | `TEL-P1-015` |
| `TEL-P1-012` | Streaming attribution + single-probe breaker VERIFIED | Breaker state is process-local; streaming lacks budget/timeout/reconciliation parity | `TEL-P1-016`, `TEL-P1-017` |
| `TEL-P1-013` | End-to-end release identity chain VERIFIED | No image/web/worker/health digest chain exists | `TEL-P1-018` |
| `TEL-P1-009` | Certification source code freeze VERIFIED | Candidate `a6d8c0d` invalidated; re-freeze required after remediation | *(re-freeze)* |
| `TEL-P2-008` | Six-role operational journeys VERIFIED | Browser layer never executed | `TEL-P2-013` |
| `TEL-P2-009` | Backup / restore / rollback drill VERIFIED | Empty-file checksum; nonexistent verification script | `TEL-P0-001` |
| `TEL-P2-010` | Test counts reconciled VERIFIED | Two conflicting authoritative totals in tree | `TEL-P2-014` |
| `TEL-P2-012` | 1,000-row load benchmark VERIFIED | Contradictory published results; handler-only scope | `TEL-P2-015`, `TEL-P2-016` |

---

## 4. Retained Verified Defects

These closures are supported by tests that genuinely exercise the invariant. They are retained
and must be re-confirmed against the **new** candidate SHA once it is frozen (a pass on an
earlier SHA does not certify later behaviour-changing code).

| ID | Description | Verifying test |
|---|---|---|
| `TEL-P1-001` | Import partial-write & crash convergence | `tests/import-fault-injection.test.ts` |
| `TEL-P1-002` | 120-row import concurrency, zero lost rows | `tests/import-race-stress.test.ts` |
| `TEL-P1-003` | Demo tenant live-email transport barrier | `tests/demo-email-barrier.test.ts` |
| `TEL-P1-004` | Production demo seed password guard | `tests/seed-guard.test.ts` |
| `TEL-P1-005` | Eventual batch commit completion | `tests/import-fault-injection.test.ts` |
| `TEL-P1-006` | Import true failure convergence | `tests/import-fault-injection.test.ts` |
| `TEL-P1-007` | Concurrent duplicate job delivery idempotency | `tests/import-fault-injection.test.ts` |
| `TEL-P1-008` | Release candidate identity separation | `MASTER_TRACKER.md` |
| `TEL-P1-010` | AI structured output runtime Zod validation | `tests/ai-structured-budget.test.ts` |
| `TEL-P2-001`–`TEL-P2-007` | CSV formula injection, email sanitisation, RLS audit, role permissions, traceability mapping, doc synchronisation, ISO-8601 timestamps | see `EVIDENCE.md` |
| `TEL-P2-011` | Import durable-write failpoint matrix | `tests/import-fault-injection.test.ts` |
