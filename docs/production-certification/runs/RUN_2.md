# Telestar CRM — Certification Run 2

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/runs/manifests/run-2.json
  Regenerate: node scripts/certification/render-runs.mjs
-->

**Verdict**: **PASS**
**Candidate SHA**: `c7bf639ef988a6ba9fffba3c88761dad245ef7a3`
**Release tag**: `telestar-internal-rc-2026-08-22`
**Environment**: win32 / node 24.16.0 / postgres 16 / redis real
**Ran**: 2026-08-24T09:36:00.000Z → 2026-08-24T09:38:00.000Z (16.8 min)

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
| `03-typecheck` | **PASS** | 0 | 52.4s | — |
| `04-lint` | **PASS** | 0 | 57.4s | — |
| `05-test-discipline` | **PASS** | 0 | 0.4s | — |
| `06-migration-validation` | **PASS** | 0 | 0.2s | — |
| `07-database-integrity` | **PASS** | 0 | 5.4s | — |
| `08-vitest` | **PASS** | 0 | 178.9s | — |
| `09-redis-integration` | **PASS** | 0 | 3.7s | — |
| `10-ai-certification` | **PASS** | 0 | 8.2s | — |
| `11-email-safety` | **PASS** | 0 | 2.2s | — |
| `12-import-fault-matrix` | **PASS** | 0 | 8.3s | — |
| `13-queue-load` | **PASS** | 0 | 24.1s | — |
| `14-security-suite` | **PASS** | 0 | 4.1s | — |
| `15-production-build` | **PASS** | 0 | 76.1s | — |
| `16-playwright-roles` | **PASS** | 0 | 32.0s | — |
| `16-playwright-roles-evidence` | **PASS** | 0 | 0.3s | — |
| `17-golden-browser-journey` | **PASS** | 0 | 16.2s | — |
| `18-worker-readiness` | **PASS** | 0 | 3.5s | — |
| `22-health-smoke` | **PASS** | 0 | 0.0s | — |
| `19-docker-build` | **PASS** | 0 | 514.5s | — |
| `20-image-inspection` | **PASS** | 0 | 0.2s | — |
| `21-compose-validation` | **PASS** | 0 | 3.1s | — |
| `23-validator-selftest` | **PASS** | 0 | 2.6s | — |

## 3. Test execution

| Measure | Value |
|---|---:|
| Test files | 196 |
| Test files passed | 196 |
| Tests passed | 2812 |
| Tests failed | 0 |
| Tests skipped | 0 |

Counts come from Vitest's JSON reporter. None is typed by hand.

## 4. Raw output

Every gate's stdout and stderr was captured while it ran, under
`evidence/raw/run2-*.log` and `evidence/raw/gate-*.log`, and each file
is hash-verified by `npm run certify:validate`.
