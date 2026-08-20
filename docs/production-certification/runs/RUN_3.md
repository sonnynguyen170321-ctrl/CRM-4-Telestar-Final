# Telestar CRM — Certification Run 3

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/runs/manifests/run-3.json
  Regenerate: node scripts/certification/render-runs.mjs
-->

**Verdict**: **PASS**
**Candidate SHA**: `3672f9759f06fc4cf21d88ffc9d65bb5d42ffa32`
**Release tag**: `telestar-internal-rc-2026-08-20`
**Environment**: win32 / node 24.16.0 / postgres 16 / redis real
**Ran**: 2026-08-20T03:19:13.205Z → 2026-08-20T03:26:31.654Z (7.3 min)

---

## 1. Scope

This run executed **24 gates**: 22 passed, 0 failed, 2 blocked externally.
Mandatory skips: **0**.

No mandatory gate was omitted.

## 2. Gates

| Gate | Status | Exit | Duration | Notes |
|---|---|---:|---:|---|
| `01-source-identity` | **PASS** | 0 | 0.0s | — |
| `02-environment` | **PASS** | 0 | 0.6s | — |
| `03-typecheck` | **PASS** | 0 | 25.9s | — |
| `04-lint` | **PASS** | 0 | 55.2s | — |
| `05-test-discipline` | **PASS** | 0 | 0.6s | — |
| `06-migration-validation` | **PASS** | 0 | 0.1s | — |
| `07-database-integrity` | **PASS** | 0 | 9.2s | — |
| `08-vitest` | **PASS** | 0 | 145.4s | — |
| `09-redis-integration` | **PASS** | 0 | 3.6s | — |
| `10-ai-certification` | **PASS** | 0 | 7.7s | — |
| `11-email-safety` | **PASS** | 0 | 2.3s | — |
| `12-import-fault-matrix` | **PASS** | 0 | 8.6s | — |
| `13-queue-load` | **PASS** | 0 | 39.5s | — |
| `14-security-suite` | **PASS** | 0 | 6.4s | — |
| `15-production-build` | **PASS** | 0 | 73.2s | — |
| `16-playwright-roles` | **PASS** | 0 | 28.1s | — |
| `16-playwright-roles-evidence` | **PASS** | 0 | 0.1s | — |
| `17-golden-browser-journey` | **PASS** | 0 | 15.6s | — |
| `18-worker-readiness` | **PASS** | 0 | 3.4s | — |
| `22-health-smoke` | **PASS** | 0 | 0.0s | — |
| `19-docker-build` | BLOCKED_EXTERNAL | 127 | 0.0s | no container runtime on the certification workstation; see TEL-P1-018 |
| `20-image-inspection` | BLOCKED_EXTERNAL | 127 | 0.0s | no image exists to inspect; see TEL-P1-018 |
| `21-compose-validation` | **PASS** | 0 | 0.4s | — |
| `23-validator-selftest` | **PASS** | 0 | 0.8s | — |

## 3. Test execution

| Measure | Value |
|---|---:|
| Test files | 164 |
| Test files passed | 164 |
| Tests passed | 2059 |
| Tests failed | 0 |
| Tests skipped | 0 |

Counts come from Vitest's JSON reporter. None is typed by hand.

## 4. Raw output

Every gate's stdout and stderr was captured while it ran, under
`evidence/raw/run3-*.log` and `evidence/raw/gate-*.log`, and each file
is hash-verified by `npm run certify:validate`.
