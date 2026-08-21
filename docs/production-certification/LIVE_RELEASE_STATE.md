---
classification: CURRENT_CANONICAL
note: Agent working memory for the final certification push. Compact by design.
---

# LIVE RELEASE STATE

CANDIDATE_SHA=daa8ffb679b7bee87a907d4913123318b697eab6
HEAD_SHA=4e8145c64094803074d7c2aabd38d89fcb45fa6b
IMAGE_DIGEST=sha256:f2e807bb7812287bb733b4d5bed9e8c1d1cba10007cc926a896950dac584ce49
DEPLOYED_SHA=daa8ffb679b7bee87a907d4913123318b697eab6
CURRENT_PHASE=1 complete, PR #100 green on CI required checks — awaiting container runtime
CURRENT_BLOCKER=docker absent (DR-003, REL-003/4/5) + gcloud unauthenticated (DR-007, TEL-P0-002)
P0_OPEN=2
P1_OPEN=17 (new: TEL-P1-023, TEL-P1-024, DEPLOY-001, DEPLOY-002 — all FIXED_PENDING_VERIFICATION)
REQUIREMENTS_VERIFIED=103/108
LAST_FULL_CI=CI_RUN_ID 32418164738 (candidate daa8ffb)
CERT_RUN_1=FAIL (only: gates 19-docker-build, 20-image-inspection BLOCKED_EXTERNAL)
CERT_RUN_2=FAIL (same)
CERT_RUN_3=FAIL (same)
ROLLBACK=NOT_EXECUTED (needs docker)
BACKUP_RESTORE=PASS (RTO 4.77s, checksum verified, restore integrity true)
NEXT_ACTION=operator installing Docker Desktop; then re-freeze candidate and run certify:full x3

## Machine capability (measured 2026-08-21, `npm run agent -- doctor`)

| Capability | State |
|---|---|
| node / npm / playwright | ok |
| postgres :5432 · redis :6379 | ok, listening |
| AI providers | OPENAI/GEMINI/GROQ keys SET |
| **docker** | **ABSENT** — blocks 2 CI gates, DR-003 |
| **gcloud** | **INSTALLED (SDK 581.0.0), NO CREDENTIALED ACCOUNTS** |

> Correction to the ledger: `TEL-P0-002` and `EV-DR-RPO` both state "gcloud is not installed on
> the certification machine". That is false as of 2026-08-21. gcloud is installed; it has no
> authenticated account. The blocker is `gcloud auth login`, an operator action — not an install.

## Ledger

| ID | Sev | State | Owner | Verification |
|---|---|---|---|---|
| TEL-P0-001 | P0 | FIXED_PENDING_VERIFICATION | agent | re-run DR drill on frozen candidate SHA |
| TEL-P0-002 | P0 | BLOCKED_EXTERNAL | operator | `gcloud auth login` then `sql instances describe` |
| TEL-P1-014..017 | P1 | FIXED_PENDING_VERIFICATION | agent | cert run flip |
| TEL-P1-018 | P1 | OPEN | agent | DEPLOYMENT.md digest chain |
| TEL-P1-019..022 | P1 | FIXED_PENDING_VERIFICATION | agent | cert run flip |
| TEL-P2-013..017 | P2 | FIXED_PENDING_VERIFICATION | agent | cert run flip |
| TEL-P2-018 | P2 | BLOCKED_EXTERNAL | operator | needs docker |
| DEPLOY-001 | P1 | FIXED_PENDING_VERIFICATION | agent | tests/deploy-script.test.ts — needs one real deploy |
| DEPLOY-002 | P1 | FIXED_PENDING_VERIFICATION | agent | tests/deploy-script.test.ts — needs one real deploy |
| DEPLOY-003 | P2 | FIXED_PENDING_VERIFICATION | agent | tests/deploy-script.test.ts |
| TEL-P1-023 | P1 | FIXED_PENDING_VERIFICATION | agent | tests/certification-image-gates.test.ts — needs a run with docker |
| TEL-P1-024 | P1 | FIXED_PENDING_VERIFICATION | agent | tests/certification-rpo-probe.test.ts — needs authenticated gcloud |
| TEL-P2-019 | P2 | FIXED_PENDING_VERIFICATION | agent | Windows batch-shim exec, tests/certification-rpo-probe.test.ts |
| TEL-P2-020 | P2 | FIXED_PENDING_VERIFICATION | agent | rollback.sh domain mapping, tests/agent-routing.test.ts |
| TEL-P1-025 | P1 | FIXED_PENDING_VERIFICATION | agent | gitleaks path exemption; secret-scan now PASS on PR #100 |
| TEL-P2-021 | P2 | FIXED_PENDING_VERIFICATION | agent | ladder reads .env.local; gate 02 probe now exits 0 |
| TEL-P2-018 | P2 | FIXED_PENDING_VERIFICATION | external | premise dead: CodeQL + Dependency review pass across 6 runs |

## Ceiling with Docker alone — corrected

An earlier version of this file said a container runtime would take verification to 107/108 by
unblocking DR-003 and REL-003/004/005. That was wrong about DR-003. Corrected:

| Requirement | Unblocked by a container runtime? |
|---|---|
| REL-003 / REL-004 / REL-005 | **Yes** — gates 19/20 become real (`TEL-P1-023`) |
| DR-003 | **No.** Nothing in the repository performs a rollback drill; the only writer of `dr-rollback` evidence records `NOT_EXECUTED`. See `TEL-P1-026` |
| DR-007 | **No.** Needs an authenticated `gcloud` |

So a container runtime alone reaches **106/108**. Writing the rollback drill takes it to 107/108.
`gcloud auth login` takes it to 108/108.

The verdict stays **NO-GO** below 108/108 regardless, because `TEL-P0-002` is an open **P0**:
three repository documents disagree about whether production has any automated backup at all,
and nothing in this checkout can settle it.

## Blocked-on-operator (cannot be resolved from this checkout)

1. **Install a container runtime** (Docker Desktop or podman) — unblocks gates 19/20, therefore
   REL-003/004/005, and DR-003 rollback.
2. **`gcloud auth login`** — unblocks DR-007 (RPO) and the TEL-P0-002 backup-posture contradiction.

Without both, the ceiling is 103/108 and the verdict stays NO-GO. Neither is a code defect.

> Until 2026-08-21 item 1 would **not** have worked: the ladder recorded gates 19 and 20 as
> blocked from a hardcoded constant and never probed for a runtime (`TEL-P1-023`). Installing
> Docker before that fix would have changed nothing. It is now wired to a real probe.

## Work completed this session (repo-local, all verifiable here)

| Change | Verification | Exit |
|---|---|---|
| `scripts/deploy-lib.sh` — backup-id validation, pull classification, record guards | `bash -n` | 0 |
| `scripts/deploy.sh` — preflight + classify + verified append | 31 tests | 0 |
| `scripts/rollback.sh` — same guards, incident path | 31 tests | 0 |
| `scripts/certification/lib/imageGates.mjs` — real gates 19/20 | 17 tests | 0 |
| `tsc --noEmit` (own exit code) | whole project | 0 |
| `eslint` on changed files | — | 0 |
| `npm run agent -- check` | 7 project-truth checks | 0 |
| `certify:selftest` | 19 detected, 0 missed | 0 |
| `scripts/certification/lib/rpoProbe.mjs` — real RPO probe | 18 tests | 0 |
| `scripts/certification/lib/exec.mjs` — Windows shim resolution | included above | 0 |
| `.agent/registry/domains.yaml` — `scripts/rollback*` mapped | 32 tests | 0 |
| `.gitleaks.toml` — fixture path exemption (TEL-P1-025) | 21 tests | 0 |
| `scripts/certification/lib/loadEnv.mjs` — ladder reads `.env.local` | 7 tests | 0 |
| full vitest suite (3rd convergence) | 179 files, **2414 passed**, 0 failed, 0 skipped | 0 |
| **PR #100 `CI required checks`** | every mandatory job green | 0 |

## Gate pre-flight on this machine (2026-08-21)

Run ahead of the ladder so a long run does not fail on something knowable in seconds.

| Gate | Result |
|---|---|
| 02-environment | PASS — was FAIL before TEL-P2-021 |
| 05-test-discipline | PASS |
| 06-migration-validation | PASS |
| 07-database-integrity | PASS |
| 21-compose-validation | PASS |
| seed delete order · stale models | PASS |
| 15-production-build | in progress |
| 19/20 image gates | need a container runtime |
| 01-source-identity | fails until the candidate is re-frozen — expected |

## Candidate status

`daa8ffb` is **superseded**. These changes touch application tooling — the certification runner,
the deploy and rollback scripts, the evidence recorder — so evidence bound to `daa8ffb` no longer
describes this tree. A new candidate must be frozen before the next run, and the DR drill re-run
against it. No certification evidence was regenerated in this session, deliberately: writing new
evidence against a superseded candidate would satisfy nothing.
