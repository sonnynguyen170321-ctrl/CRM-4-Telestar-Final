# Telestar CRM — Certification Run 3

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/runs/manifests/run-3.json
  Regenerate: node scripts/certification/render-runs.mjs
-->

**Verdict**: **PASS**
**Candidate SHA**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
**Release tag**: `telestar-internal-rc-2026-08-22`
**Environment**: win32 / node 24.16.0 / postgres 16 / redis real
**Ran**: 2026-08-27T22:27:56.530Z → 2026-08-27T22:46:00.544Z (18.1 min)

---

## 1. Scope

This run executed **24 gates**: 24 passed, 0 failed, 0 blocked externally.
Mandatory skips: **0**.

No mandatory gate was omitted.

## 2. Gates

| Gate | Status | Exit | Duration | Notes |
|---|---|---:|---:|---|
| `01-source-identity` | **PASS** | 0 | 0.0s | — |
| `02-environment` | **PASS** | 0 | 0.3s | — |
| `03-typecheck` | **PASS** | 0 | 52.2s | — |
| `04-lint` | **PASS** | 0 | 55.5s | — |
| `05-test-discipline` | **PASS** | 0 | 0.3s | — |
| `06-migration-validation` | **PASS** | 0 | 0.1s | — |
| `07-database-integrity` | **PASS** | 0 | 2.6s | — |
| `08-vitest` | **PASS** | 0 | 250.8s | — |
| `09-redis-integration` | **PASS** | 0 | 3.5s | — |
| `10-ai-certification` | **PASS** | 0 | 7.8s | — |
| `11-email-safety` | **PASS** | 0 | 2.2s | — |
| `12-import-fault-matrix` | **PASS** | 0 | 8.5s | — |
| `13-queue-load` | **PASS** | 0 | 70.4s | — |
| `14-security-suite` | **PASS** | 0 | 3.7s | — |
| `15-production-build` | **PASS** | 0 | 75.7s | — |
| `16-playwright-roles` | **PASS** | 0 | 26.0s | — |
| `16-playwright-roles-evidence` | **PASS** | 0 | 0.1s | — |
| `17-golden-browser-journey` | **PASS** | 0 | 15.9s | — |
| `18-worker-readiness` | **PASS** | 0 | 3.3s | — |
| `22-health-smoke` | **PASS** | 0 | 0.0s | — |
| `19-docker-build` | **PASS** | 0 | 480.8s | — |
| `20-image-inspection` | **PASS** | 0 | 0.5s | — |
| `21-compose-validation` | **PASS** | 0 | 4.1s | — |
| `23-validator-selftest` | **PASS** | 0 | 7.9s | — |

## 3. Test execution

| Measure | Value |
|---|---:|
| Test files | 216 |
| Test files passed | 216 |
| Tests passed | 3099 |
| Tests failed | 0 |
| Tests skipped | 0 |

Counts come from Vitest's JSON reporter. None is typed by hand.

## 4. Raw output

Every gate's stdout and stderr was captured while it ran, under
`evidence/raw/run3-*.log` and `evidence/raw/gate-*.log`, and each file
is hash-verified by `npm run certify:validate`.
