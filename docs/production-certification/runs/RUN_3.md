# Telestar CRM — Certification Run 3

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/runs/manifests/run-3.json
  Regenerate: node scripts/certification/render-runs.mjs
-->

**Verdict**: **PASS**
**Candidate SHA**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
**Release tag**: `telestar-internal-rc-2026-08-22`
**Environment**: win32 / node 24.16.0 / postgres 16 / redis real
**Ran**: 2026-08-23T19:28:43.915Z → 2026-08-23T19:44:19.223Z (15.6 min)

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
| `03-typecheck` | **PASS** | 0 | 51.8s | — |
| `04-lint` | **PASS** | 0 | 52.7s | — |
| `05-test-discipline` | **PASS** | 0 | 0.4s | — |
| `06-migration-validation` | **PASS** | 0 | 0.1s | — |
| `07-database-integrity` | **PASS** | 0 | 5.2s | — |
| `08-vitest` | **PASS** | 0 | 163.4s | — |
| `09-redis-integration` | **PASS** | 0 | 3.5s | — |
| `10-ai-certification` | **PASS** | 0 | 7.9s | — |
| `11-email-safety` | **PASS** | 0 | 2.2s | — |
| `12-import-fault-matrix` | **PASS** | 0 | 7.6s | — |
| `13-queue-load` | **PASS** | 0 | 22.7s | — |
| `14-security-suite` | **PASS** | 0 | 3.9s | — |
| `15-production-build` | **PASS** | 0 | 74.2s | — |
| `16-playwright-roles` | **PASS** | 0 | 30.6s | — |
| `16-playwright-roles-evidence` | **PASS** | 0 | 0.2s | — |
| `17-golden-browser-journey` | **PASS** | 0 | 14.7s | — |
| `18-worker-readiness` | **PASS** | 0 | 3.4s | — |
| `22-health-smoke` | **PASS** | 0 | 0.0s | — |
| `19-docker-build` | **PASS** | 0 | 469.9s | — |
| `20-image-inspection` | **PASS** | 0 | 0.6s | — |
| `21-compose-validation` | **PASS** | 0 | 3.8s | — |
| `23-validator-selftest` | **PASS** | 0 | 4.4s | — |

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
`evidence/raw/run3-*.log` and `evidence/raw/gate-*.log`, and each file
is hash-verified by `npm run certify:validate`.
