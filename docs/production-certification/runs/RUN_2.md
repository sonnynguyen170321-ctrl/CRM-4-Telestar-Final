# Telestar CRM — Certification Run 2

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/runs/manifests/run-2.json
  Regenerate: node scripts/certification/render-runs.mjs
-->

**Verdict**: **PASS**
**Candidate SHA**: `396d3652c619c25f8f26005127e9b7291cdaeedf`
**Release tag**: `telestar-internal-rc-2026-08-22`
**Environment**: win32 / node 24.16.0 / postgres 16 / redis real
**Ran**: 2026-08-27T20:09:35.551Z → 2026-08-27T20:25:44.102Z (16.1 min)

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
| `03-typecheck` | **PASS** | 0 | 98.5s | — |
| `04-lint` | **PASS** | 0 | 54.2s | — |
| `05-test-discipline` | **PASS** | 0 | 0.4s | — |
| `06-migration-validation` | **PASS** | 0 | 0.2s | — |
| `07-database-integrity` | **PASS** | 0 | 3.2s | — |
| `08-vitest` | **PASS** | 0 | 165.9s | — |
| `09-redis-integration` | **PASS** | 0 | 3.4s | — |
| `10-ai-certification` | **PASS** | 0 | 7.6s | — |
| `11-email-safety` | **PASS** | 0 | 2.2s | — |
| `12-import-fault-matrix` | **PASS** | 0 | 6.6s | — |
| `13-queue-load` | **PASS** | 0 | 43.8s | — |
| `14-security-suite` | **PASS** | 0 | 3.8s | — |
| `15-production-build` | **PASS** | 0 | 70.3s | — |
| `16-playwright-roles` | **PASS** | 0 | 26.4s | — |
| `16-playwright-roles-evidence` | **PASS** | 0 | 0.2s | — |
| `17-golden-browser-journey` | **PASS** | 0 | 15.5s | — |
| `18-worker-readiness` | **PASS** | 0 | 3.4s | — |
| `22-health-smoke` | **PASS** | 0 | 0.0s | — |
| `19-docker-build` | **PASS** | 0 | 440.5s | — |
| `20-image-inspection` | **PASS** | 0 | 0.3s | — |
| `21-compose-validation` | **PASS** | 0 | 2.3s | — |
| `23-validator-selftest` | **PASS** | 0 | 6.8s | — |

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
`evidence/raw/run2-*.log` and `evidence/raw/gate-*.log`, and each file
is hash-verified by `npm run certify:validate`.
