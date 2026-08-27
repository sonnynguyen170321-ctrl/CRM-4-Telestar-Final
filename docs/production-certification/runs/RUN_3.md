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
**Ran**: 2026-08-27T20:26:15.439Z → 2026-08-27T20:43:32.563Z (17.3 min)

---

## 1. Scope

This run executed **24 gates**: 24 passed, 0 failed, 0 blocked externally.
Mandatory skips: **0**.

No mandatory gate was omitted.

## 2. Gates

| Gate | Status | Exit | Duration | Notes |
|---|---|---:|---:|---|
| `01-source-identity` | **PASS** | 0 | 0.0s | — |
| `02-environment` | **PASS** | 0 | 0.4s | — |
| `03-typecheck` | **PASS** | 0 | 38.9s | — |
| `04-lint` | **PASS** | 0 | 54.3s | — |
| `05-test-discipline` | **PASS** | 0 | 0.3s | — |
| `06-migration-validation` | **PASS** | 0 | 0.2s | — |
| `07-database-integrity` | **PASS** | 0 | 2.4s | — |
| `08-vitest` | **PASS** | 0 | 223.3s | — |
| `09-redis-integration` | **PASS** | 0 | 3.3s | — |
| `10-ai-certification` | **PASS** | 0 | 7.7s | — |
| `11-email-safety` | **PASS** | 0 | 2.2s | — |
| `12-import-fault-matrix` | **PASS** | 0 | 9.4s | — |
| `13-queue-load` | **PASS** | 0 | 52.8s | — |
| `14-security-suite` | **PASS** | 0 | 3.6s | — |
| `15-production-build` | **PASS** | 0 | 85.0s | — |
| `16-playwright-roles` | **PASS** | 0 | 26.5s | — |
| `16-playwright-roles-evidence` | **PASS** | 0 | 0.3s | — |
| `17-golden-browser-journey` | **PASS** | 0 | 18.5s | — |
| `18-worker-readiness` | **PASS** | 0 | 3.5s | — |
| `22-health-smoke` | **PASS** | 0 | 0.0s | — |
| `19-docker-build` | **PASS** | 0 | 482.8s | — |
| `20-image-inspection` | **PASS** | 0 | 0.3s | — |
| `21-compose-validation` | **PASS** | 0 | 2.3s | — |
| `23-validator-selftest` | **PASS** | 0 | 6.2s | — |

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
