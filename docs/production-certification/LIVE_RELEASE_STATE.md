---
classification: CURRENT_CANONICAL
note: Agent working memory for the final certification push. Compact by design.
---

# LIVE RELEASE STATE

CANDIDATE_SHA=12ea8ae4791ad0c79fb6a1403475015dc6acb399 (frozen cee77c5; f966d0d landed after — check N)
IMAGE_DIGEST=sha256:f2e807bb7812287bb733b4d5bed9e8c1d1cba10007cc926a896950dac584ce49 (built from daa8ffb — STALE, predates candidate)
DEPLOYED_SHA=9fa36d3 (health endpoint — behind candidate, check S)
BRANCH=main
CURRENT_PHASE=DR/RPO measured; candidate re-freeze invalidated all prior evidence
CURRENT_BLOCKER=no container runtime · E2E_PASSWORD not supplied · full cert suite not yet re-run against 12ea8ae
P0_OPEN=1 (TEL-P0-002 RESOLVED 2026-08-23 by live measurement)
P1_OPEN=19
REQUIREMENTS_VERIFIED=4/108 (was 103/108 against fa3a54b; the re-freeze reset it — evidence is candidate-scoped)
CERT_RUN_1/2/3=STALE (all carry fa3a54b, not the candidate)
ROLLBACK=NOT_EXECUTED (no drill exists — TEL-P1-026)
BACKUP_RESTORE=PASS (RTO 4.77s, checksum verified, restore integrity true)
DR_RPO=PASS — MEASURED against live telestar-db: PITR enabled, 7-day log retention, rpoSeconds 300
VALIDATOR=135 failures, exit 1, NO-GO (01:1 · A:26 · L:2 · S:1 · N:1 · REQ:104)
NEXT_ACTION=operator: container runtime + E2E_PASSWORD; then re-freeze and run certify:full x3 against the new candidate

> **Why 135 and not 17.** The 17-failure reading was taken while the candidate was `fa3a54b`.
> Freezing `12ea8ae` invalidated every evidence file written against the old SHA: checks `A` (26)
> and `REQ` (104) are one cause counted twice — evidence is candidate-scoped by design. `EV-DR-RPO`
> is currently the only evidence in the repository carrying the candidate SHA.

## Open security finding — not part of TEL-P0-002

The live `telestar-db` describe output reports `requireSsl: false` and
`sslMode: ALLOW_UNENCRYPTED_AND_ENCRYPTED`: production Postgres accepts unencrypted connections.
`authorizedNetworks` is a single `/32`, which bounds exposure but does not remove it. Found
2026-08-23 while measuring RPO; **no defect ID assigned yet**, and it is not covered by any
existing requirement.

## Evidence redaction note

This repository is **public**. `evidence/raw/dr-rpo-gcloud.log` is an allowlist redaction of the
raw `gcloud sql instances describe` output — endpoint IPs, server CA certificate, managed
service-account address (carries the GCP project number), etag and the authorized-network ACL
were removed. `backupConfiguration` is retained verbatim, which is what `EV-DR-RPO.closesWhen`
requires. The redaction is self-declared in the artifact's `_redaction` key.

## Machine capability (measured, `npm run agent -- doctor`)

| Capability | State |
|---|---|
| node · npm · playwright | ok |
| postgres :5432 · redis :6379 | ok, listening |
| AI providers | OPENAI / GEMINI / GROQ keys SET |
| **container runtime** | **ABSENT** — docker and podman both unresolved |
| **gcloud** | **INSTALLED (SDK 581.0.0), AUTHENTICATED** — active account `sonnynguyenofficial@gmail.com`; probe returned exit 0 on 2026-08-23 |

> `TEL-P0-002` and `EV-DR-RPO` both said "gcloud is not installed on the certification machine".
> False on both counts, and the correction took two rounds. It was installed and merely
> unauthenticated (`TEL-P1-024`: the evidence was a hardcoded constant, so authenticating alone
> would not have changed it). After authenticating, the probe still failed — with a real HTTP 404,
> because the configured instance name `telestar-crm-db` does not exist. The instance is
> `telestar-db`. Corrected 2026-08-23 in `record-blocked-evidence.mjs` and in
> `tests/certification-rpo-probe.test.ts`, which had asserted the non-existent name and so held
> the defect in place.

## What each operator action is worth

| Action | Unblocks | Reaches |
|---|---|---|
| container runtime | gates 19/20 → REL-003/004/005 | 106/108 |
| ↳ then finish the DR-003 drill | DR-003 | 107/108 |
| ~~`gcloud auth login`~~ | ~~DR-007 + settles `TEL-P0-002`~~ | **DONE 2026-08-23** — both closed |

Both "Reaches" figures above are **stale**: they were computed against candidate `fa3a54b`.
The re-freeze to `12ea8ae` reset verified requirements to 4/108, because evidence is
candidate-scoped. Reaching 108/108 now requires re-running the full suite against the
candidate, not just the two operator actions listed.

`TEL-P0-002` no longer blocks: the three documents that disagreed about production backups were
settled on 2026-08-23 by inspecting the live instance rather than by choosing which document to
believe. `docs/CLOUD_RUN_DEPLOY.md` was the wrong one — it created the instance with
`--no-backup`.

`E2E_PASSWORD` is additionally required for the browser gates. Run-scoped; the published demo
password is refused by `e2e/support/fixture.ts`.

## Validator state (`npm run certify:validate`, exit 1)

135 failures as of 2026-08-23, in six groups. Nothing unexplained.

| Check | Count | What it is |
|---|---:|---|
| `REQ` | 104 | evidence of the right kind exists but carries `fa3a54b`, not the candidate |
| `A` | 26 | same cause, counted at the file level — evidence and rendered docs still name `fa3a54b` / `daa8ffb` / `9fa36d3` |
| `L` | 2 | gates 19/20 `BLOCKED_EXTERNAL` in run 3. Fixed in code by `TEL-P1-023`; clears when the runs are re-executed with a container runtime |
| `01` | 1 | uncommitted working tree at the time of the run |
| `S` | 1 | deployed health SHA `9fa36d3` is behind candidate `12ea8ae` |
| `N` | 1 | `f966d0d` touches non-certification files after the freeze |

`REQ` and `A` are one cause counted twice: 130 of the 135 failures are the re-freeze
invalidating evidence, not 130 distinct defects. Re-running `certify:full` against `12ea8ae`
clears both — and needs a container runtime.

Check `N` reads as the mechanism working, not as a defect: it caught every commit made here and
refused to let a superseded SHA stand as the candidate.

Check `J` also caught a dead reference in this file and was fixed. `npm run agent -- check`
passed on the same file — the two link checkers differ in scope, so a green `agent check` is
not a substitute for `certify:validate`.

## Defects found and fixed this session

All `FIXED_PENDING_VERIFICATION` unless noted. Full detail in [DEFECTS.md](DEFECTS.md).

| ID | Sev | What it was | Verification |
|---|---|---|---|
| `TEL-P1-023` | P1 | gates 19/20 blocked by a hardcoded constant — the sole cause of the NO-GO | 17 tests |
| `TEL-P1-024` | P1 | `EV-DR-RPO` a constant asserting a stale blocker | 18 tests |
| `TEL-P1-025` | P1 | one branch's fixtures failed **every** PR's secret scan | 21 tests; secret-scan now PASS |
| `TEL-P1-026` | P1 | **OPEN** — DR-003 has no producing script; decision rules written, orchestration not | 27 tests + mutation |
| `DEPLOY-001` | P1 | failed audit-trail write did not fail the deploy | 31 tests + 6 end-to-end paths |
| `DEPLOY-002` | P1 | backup prompt accepted `Telestar2026` | as above; fails closed non-interactively |
| `DEPLOY-003` | P2 | full disk reported as a missing image | as above |
| `TEL-P2-019` | P2 | Windows batch shim read as "gcloud absent" | included in 18 |
| `TEL-P2-020` | P2 | `rollback.sh` owned by no domain | 32 tests |
| `TEL-P2-021` | P2 | ladder could not read `.env.local`; gate 02 failed | 8 tests; probe now exits 0 |
| `TEL-P2-018` | P2 | premise dead — CodeQL and Dependency review pass across 6 runs | external |

`TEL-P1-018` was corrected from `OPEN`: the evidence it demands already exists in
`EV-RELEASE-IDENTITY` with `chainProblems: []`, and `REL-001` reads VERIFIED.

## Verification runs, exit codes captured from the tool itself

| Check | Result | Exit |
|---|---|---|
| full vitest suite | 180 files, **2442 passed**, 0 failed, 0 skipped | 0 |
| `tsc --noEmit` | whole project | 0 |
| `eslint` | changed files | 0 |
| `npm run agent -- check` | 7 project-truth checks | 0 |
| `certify:selftest` | 19 detected, 0 missed | 0 |
| gate 15 production build | run locally | 0 |
| **PR #100 `CI required checks`** | every mandatory job green | 0 |

### Gate pre-flight on this machine

Run ahead of the ladder so a long run cannot fail on something knowable in seconds.

| Gate | Result |
|---|---|
| 02-environment | PASS — was FAIL before `TEL-P2-021` |
| 05 · 06 · 07 · 15 · 21 | PASS |
| 19 / 20 image gates | need a container runtime |
| 01-source-identity | fails until re-freeze — expected |

## Candidate status

`daa8ffb` is **superseded**. This session changed the certification runner, the deploy and
rollback scripts, and the evidence recorder, so evidence bound to it no longer describes this
tree. A new candidate must be frozen on the merge SHA and the DR drill re-run against it. No
certification evidence was regenerated here, deliberately: writing evidence against a superseded
candidate satisfies nothing.
