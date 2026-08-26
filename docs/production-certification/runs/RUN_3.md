# Telestar CRM — Certification Run 3

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/runs/manifests/run-3.json
  Regenerate: node scripts/certification/render-runs.mjs
-->

**Verdict**: **PASS**
**Candidate SHA**: `9b2b44c9f0987139e2f48ee21b14ec36e10690a8`
**Release tag**: `telestar-internal-rc-2026-08-22`
**Environment**: win32 / node 24.16.0 / postgres 16 / redis real
**Ran**: 2026-08-25T21:20:50.756Z → 2026-08-25T21:39:06.254Z (18.3 min)

---

## 1. Scope

This run executed **24 gates**: 24 passed, 0 failed, 0 blocked externally.
Mandatory skips: **0**.

No mandatory gate was omitted.

## 2. Gates

| Gate | Status | Exit | Duration | Notes |
|---|---|---:|---:|---|
| `01-source-identity` | **PASS** | 0 | 0.0s | — |
| `02-environment` | **PASS** | 0 | 2.3s | — |
| `03-typecheck` | **PASS** | 0 | 57.5s | — |
| `04-lint` | **PASS** | 0 | 53.3s | — |
| `05-test-discipline` | **PASS** | 0 | 0.3s | — |
| `06-migration-validation` | **PASS** | 0 | 0.2s | — |
| `07-database-integrity` | **PASS** | 0 | 5.0s | — |
| `08-vitest` | **PASS** | 0 | 284.3s | — |
| `09-redis-integration` | **PASS** | 0 | 5.4s | — |
| `10-ai-certification` | **PASS** | 0 | 15.7s | — |
| `11-email-safety` | **PASS** | 0 | 4.4s | — |
| `12-import-fault-matrix` | **PASS** | 0 | 18.7s | — |
| `13-queue-load` | **PASS** | 0 | 61.6s | — |
| `14-security-suite` | **PASS** | 0 | 9.6s | — |
| `15-production-build` | **PASS** | 0 | 74.3s | — |
| `16-playwright-roles` | **PASS** | 0 | 29.5s | — |
| `16-playwright-roles-evidence` | **PASS** | 0 | 0.2s | — |
| `17-golden-browser-journey` | **PASS** | 0 | 15.7s | — |
| `18-worker-readiness` | **PASS** | 0 | 7.8s | — |
| `22-health-smoke` | **PASS** | 0 | 0.0s | — |
| `19-docker-build` | **PASS** | 0 | 426.6s | — |
| `20-image-inspection` | **PASS** | 0 | 0.5s | — |
| `21-compose-validation` | **PASS** | 0 | 3.2s | — |
| `23-validator-selftest` | **PASS** | 0 | 7.0s | — |

## 3. Test execution

| Measure | Value |
|---|---:|
| Test files | 203 |
| Test files passed | 203 |
| Tests passed | 2965 |
| Tests failed | 0 |
| Tests skipped | 0 |

Counts come from Vitest's JSON reporter. None is typed by hand.

## 4. Raw output

Every gate's stdout and stderr was captured while it ran, under
`evidence/raw/run3-*.log` and `evidence/raw/gate-*.log`, and each file
is hash-verified by `npm run certify:validate`.
