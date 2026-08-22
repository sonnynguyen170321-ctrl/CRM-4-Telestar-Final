# Telestar CRM — Production Readiness Certificate

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/evidence/ + certification.config.json
  Regenerate: npm run certify:generate
  Eligibility is computed by npm run certify:validate. Nobody types the verdict.
-->

**Verdict**: **NO-GO — BLOCKERS REMAIN**
**Generated**: 2026-08-22T06:38:54.447Z
**Candidate SHA**: `9fa36d3bcac6532f0c6f07af9045825a9d97844f`
**Release tag**: `telestar-internal-rc-2026-08-22`
**Evidence records**: 23

---

## 1. Release identity

| Field | Value |
|---|---|
| APPLICATION_SOURCE_SHA | `9fa36d3bcac6532f0c6f07af9045825a9d97844f` |
| CI_RUN_ID | `32524242612` |
| IMAGE_DIGEST | `sha256:f4b2b741d167a3cf865859025f5a056311fdc0f2daa7bac2118bf4f6ab2421b8` |
| WEB_DIGEST | `sha256:f4b2b741d167a3cf865859025f5a056311fdc0f2daa7bac2118bf4f6ab2421b8` |
| WORKER_DIGEST | `sha256:f4b2b741d167a3cf865859025f5a056311fdc0f2daa7bac2118bf4f6ab2421b8` |
| HEALTH_SHA | `9fa36d3bcac6532f0c6f07af9045825a9d97844f` |

## 2. Test execution

| Measure | Value | Source |
|---|---|---|
| Vitest files passed | 175 / 175 | `EV-VITEST` |
| Vitest tests passed | 2340 | `EV-VITEST` |
| Vitest tests failed | 0 | `EV-VITEST` |
| Vitest tests skipped | 0 | `EV-VITEST` |
| Redis integration executed | true | `EV-REDIS-INTEGRATION` |
| Redis integration skips | 0 | `EV-REDIS-INTEGRATION` |

All counts are machine-derived from the Vitest JSON reporter. None is typed.

## 3. Six-role browser acceptance

Status **PASS** — 6/6 roles observed, 0 failing.

| Role | Verdict | Console errors | Network failures |
|---|---|---:|---:|
| `director` | PASS | 0 | 0 |
| `floor_manager` | PASS | 0 | 0 |
| `leadgen` | PASS | 0 | 0 |
| `leadgen_manager` | PASS | 0 | 0 |
| `sdr` | PASS | 0 | 0 |
| `team_lead` | PASS | 0 | 0 |

Detail: [ROLE_BROWSER_EVIDENCE.md](ROLE_BROWSER_EVIDENCE.md).

## 4. Import load

Two benchmarks, named for what they exercise. Detail: [LOAD_TEST.md](LOAD_TEST.md).

| Benchmark | Scales | Lost rows | Duplicate rows |
|---|---|---:|---:|
| `IMPORT_HANDLER_BENCHMARK` (BullMQ mocked) | 120, 500, 1000 | 0 | 0 |
| `IMPORT_SYSTEM_QUEUE_BENCHMARK` (real Redis and BullMQ) | 120, 500, 1000 | 0 | 0 |

## 5. Disaster recovery

| Measure | Value |
|---|---|
| Backup artifact size | 1911816 bytes |
| Backup SHA-256 | `b1e332498f272cec5cab4bcb2fb8c3dc58c6cf1524a003f2148e7a7070c47512` |
| Checksum verified | true |
| Restore integrity | true |
| Measured RTO | 4.77 s |
| RPO | BLOCKED_EXTERNAL — gcloud is not installed on this machine, so the live Cloud SQL backup configuration cannot be inspected. |
| Rollback drill | NOT_EXECUTED — docker is not installed on this machine, so no image has been built and no digest exists to roll between. |

Detail: [BACKUP_RESTORE.md](BACKUP_RESTORE.md).

## 6. Requirements

**1 of 108 verified.**

| Domain | Verified | Total |
|---|---:|---:|
| `IMP` | 0 | 13 |
| `MAIL` | 0 | 12 |
| `SEC` | 0 | 15 |
| `ROLE` | 0 | 12 |
| `AI` | 0 | 14 |
| `DR` | 0 | 10 |
| `REL` | 1 | 8 |
| `OPS` | 0 | 24 |

Status is computed per requirement from the evidence manifest, never asserted. Detail:
[REQUIREMENT_TRACEABILITY.md](REQUIREMENT_TRACEABILITY.md).

## 7. Multi-run qualification

| Run | Status | Failed gates | Missing gates | Mandatory skips |
|---|---|---|---|---:|
| 1 | FAIL | none | none | 0 |
| 2 | FAIL | none | none | 0 |
| 3 | FAIL | none | none | 0 |

## 8. Open defects

| Severity | Open |
|---|---:|
| P0 | 5 |
| P1 | 25 |
| P2 | 15 |
| P3 | 0 |

- `TEL-P2-024` — FIXED_PENDING_VERIFICATION
- `TEL-P2-023` — FIXED_PENDING_VERIFICATION
- `TEL-P1-037` — FIXED_PENDING_VERIFICATION
- `TEL-P1-034` — FIXED_PENDING_VERIFICATION
- `TEL-P1-035` — FIXED_PENDING_VERIFICATION
- `TEL-P1-036` — FIXED_PENDING_VERIFICATION
- `TEL-P1-033` — FIXED_PENDING_VERIFICATION
- `TEL-P2-022` — FIXED_PENDING_VERIFICATION
- `TEL-P0-005` — FIXED_PENDING_VERIFICATION
- `TEL-P1-029` — FIXED_PENDING_VERIFICATION
- `TEL-P1-030` — FIXED_PENDING_VERIFICATION
- `TEL-P1-031` — FIXED_PENDING_VERIFICATION
- `TEL-P1-032` — OPEN
- `TEL-P0-006` — FIXED_PENDING_VERIFICATION
- `TEL-P0-004` — FIXED_PENDING_VERIFICATION
- `TEL-P1-038` — OPEN
- `TEL-P2-026` — OPEN
- `TEL-P2-027` — RESOLVED
- `TEL-P2-025` — FIXED_PENDING_VERIFICATION
- `TEL-P0-001` — FIXED_PENDING_VERIFICATION
- `TEL-P0-002` — RESOLVED
- `TEL-P1-014` — FIXED_PENDING_VERIFICATION
- `TEL-P1-015` — FIXED_PENDING_VERIFICATION
- `TEL-P1-016` — FIXED_PENDING_VERIFICATION
- `TEL-P1-017` — FIXED_PENDING_VERIFICATION
- `TEL-P1-018` — FIXED_PENDING_VERIFICATION
- `TEL-P2-013` — FIXED_PENDING_VERIFICATION
- `TEL-P2-014` — FIXED_PENDING_VERIFICATION
- `TEL-P2-015` — FIXED_PENDING_VERIFICATION
- `TEL-P2-016` — FIXED_PENDING_VERIFICATION
- `TEL-P2-017` — FIXED_PENDING_VERIFICATION
- `TEL-P1-019` — FIXED_PENDING_VERIFICATION
- `TEL-P1-020` — FIXED_PENDING_VERIFICATION
- `TEL-P1-021` — FIXED_PENDING_VERIFICATION
- `TEL-P1-022` — FIXED_PENDING_VERIFICATION
- `TEL-P2-018` — FIXED_PENDING_VERIFICATION
- `TEL-P1-023` — FIXED_PENDING_VERIFICATION
- `TEL-P1-024` — FIXED_PENDING_VERIFICATION
- `TEL-P2-019` — FIXED_PENDING_VERIFICATION
- `TEL-P2-020` — FIXED_PENDING_VERIFICATION
- `TEL-P1-025` — FIXED_PENDING_VERIFICATION
- `TEL-P2-021` — FIXED_PENDING_VERIFICATION
- `TEL-P1-026` — OPEN
- `TEL-P1-027` — OPEN
- `TEL-P1-028` — OPEN

Detail: [DEFECTS.md](DEFECTS.md).

## 9. What stands between this and GO

**Check `A`** — 2 finding(s)
  - docs/production-certification/EVIDENCE.md still references non-candidate SHA daa8ffb (candidate is 9fa36d3)
  - docs/production-certification/FINAL_CERTIFICATE.md still references non-candidate SHA daa8ffb (candidate is 9fa36d3)

**Check `L`** — 6 finding(s)
  - run 1 gate "19-docker-build" is BLOCKED_EXTERNAL
  - run 1 gate "20-image-inspection" is BLOCKED_EXTERNAL
  - run 2 gate "19-docker-build" is BLOCKED_EXTERNAL
  - run 2 gate "20-image-inspection" is BLOCKED_EXTERNAL
  - run 3 gate "19-docker-build" is BLOCKED_EXTERNAL
  - run 3 gate "20-image-inspection" is BLOCKED_EXTERNAL

**Check `REQ`** — 107 finding(s)
  - IMP-001 is not VERIFIED: evidence of kind "vitest" exists but none is for candidate 9fa36d3
  - IMP-002 is not VERIFIED: evidence of kind "vitest" exists but none is for candidate 9fa36d3
  - IMP-003 is not VERIFIED: evidence of kind "vitest" exists but none is for candidate 9fa36d3
  - IMP-004 is not VERIFIED: evidence of kind "vitest" exists but none is for candidate 9fa36d3
  - IMP-005 is not VERIFIED: evidence of kind "vitest" exists but none is for candidate 9fa36d3
  - IMP-006 is not VERIFIED: evidence of kind "vitest" exists but none is for candidate 9fa36d3
  - …and 101 more

---

## 10. Scope of these claims

Every figure above was produced by a command whose raw output is stored under
`evidence/raw/` and whose artifacts are hash-verified on every validation run. Where a thing
was not done, this document says it was not done rather than omitting it.

Specifically: no claim is made about behaviour under production traffic, about infrastructure
this workstation cannot reach, or about any scenario not listed in
[REQUIREMENT_TRACEABILITY.md](REQUIREMENT_TRACEABILITY.md). Security findings are scoped to
the specific tests named there — "no cross-tenant access was observed in the cases tested" is
what the evidence supports, and is not the same claim as "the system is secure".

**Verdict: NO-GO — BLOCKERS REMAIN**
