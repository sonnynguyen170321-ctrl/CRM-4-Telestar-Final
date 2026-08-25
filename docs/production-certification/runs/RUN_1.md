# Telestar CRM — Certification Run 1

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/runs/manifests/run-1.json
  Regenerate: node scripts/certification/render-runs.mjs
-->

**Verdict**: **FAIL**
**Candidate SHA**: `949eefe3a474ab76db1064cb3bb597715d9599bf`
**Release tag**: `telestar-internal-rc-2026-08-22`
**Environment**: win32 / node 24.16.0 / postgres 16 / redis real
**Ran**: 2026-08-25T11:03:36.146Z → 2026-08-25T11:23:34.794Z (20.0 min)

---

## 1. Scope

This run executed **24 gates**: 22 passed, 1 failed, 1 blocked externally.
Mandatory skips: **0**.

No mandatory gate was omitted.

## 2. Gates

| Gate | Status | Exit | Duration | Notes |
|---|---|---:|---:|---|
| `01-source-identity` | **PASS** | 0 | 0.0s | — |
| `02-environment` | **PASS** | 0 | 0.4s | — |
| `03-typecheck` | **PASS** | 0 | 35.5s | — |
| `04-lint` | **PASS** | 0 | 101.8s | — |
| `05-test-discipline` | **PASS** | 0 | 1.2s | — |
| `06-migration-validation` | **PASS** | 0 | 1.2s | — |
| `07-database-integrity` | **PASS** | 0 | 7.4s | — |
| `08-vitest` | **PASS** | 0 | 468.4s | — |
| `09-redis-integration` | **PASS** | 0 | 5.8s | — |
| `10-ai-certification` | **PASS** | 0 | 15.8s | — |
| `11-email-safety` | **PASS** | 0 | 5.1s | — |
| `12-import-fault-matrix` | **PASS** | 0 | 12.2s | — |
| `13-queue-load` | **PASS** | 0 | 60.4s | — |
| `14-security-suite` | **PASS** | 0 | 8.1s | — |
| `15-production-build` | **PASS** | 0 | 91.0s | — |
| `16-playwright-roles` | **PASS** | 0 | 50.5s | — |
| `16-playwright-roles-evidence` | **PASS** | 0 | 0.3s | — |
| `17-golden-browser-journey` | **PASS** | 0 | 23.2s | — |
| `18-worker-readiness` | **PASS** | 0 | 3.7s | — |
| `22-health-smoke` | **PASS** | 0 | 0.0s | — |
| `19-docker-build` | **FAIL** | 1 | 286.5s | — |
| `20-image-inspection` | BLOCKED_EXTERNAL | 127 | 0.0s | gate 19 did not produce an image, so there is nothing to inspect |
| `21-compose-validation` | **PASS** | 0 | 1.9s | — |
| `23-validator-selftest` | **PASS** | 0 | 5.1s | — |

## 3. Test execution

| Measure | Value |
|---|---:|
| Test files | 197 |
| Test files passed | 197 |
| Tests passed | 2847 |
| Tests failed | 0 |
| Tests skipped | 0 |

Counts come from Vitest's JSON reporter. None is typed by hand.

## 4. Raw output

Every gate's stdout and stderr was captured while it ran, under
`evidence/raw/run1-*.log` and `evidence/raw/gate-*.log`, and each file
is hash-verified by `npm run certify:validate`.
