# Telestar CRM — Certification Run 3

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/runs/manifests/run-3.json
  Regenerate: node scripts/certification/render-runs.mjs
-->

**Verdict**: **PASS**
**Candidate SHA**: `1fbd7b00d4a00375ee93f6f46314f10c211535d6`
**Release tag**: `telestar-internal-rc-2026-08-20`
**Environment**: win32 / node 24.16.0 / postgres 16 / redis real
**Ran**: 2026-08-19T20:35:33.030Z → 2026-08-19T20:42:13.685Z (6.7 min)

---

## 1. Scope

This run executed **23 gates**: 21 passed, 0 failed, 2 blocked externally.
Mandatory skips: **0**.

No mandatory gate was omitted.

## 2. Gates

| Gate | Status | Exit | Duration | Notes |
|---|---|---:|---:|---|
| `01-source-identity` | **PASS** | 0 | 0.0s | — |
| `02-environment` | **PASS** | 0 | 0.4s | — |
| `03-typecheck` | **PASS** | 0 | 25.4s | — |
| `04-lint` | **PASS** | 0 | 51.1s | — |
| `05-test-discipline` | **PASS** | 0 | 0.3s | — |
| `06-migration-validation` | **PASS** | 0 | 0.1s | — |
| `07-database-integrity` | **PASS** | 0 | 7.7s | — |
| `08-vitest` | **PASS** | 0 | 128.0s | — |
| `09-redis-integration` | **PASS** | 0 | 3.3s | — |
| `10-ai-certification` | **PASS** | 0 | 7.3s | — |
| `11-email-safety` | **PASS** | 0 | 2.1s | — |
| `12-import-fault-matrix` | **PASS** | 0 | 7.9s | — |
| `13-queue-load` | **PASS** | 0 | 34.4s | — |
| `14-security-suite` | **PASS** | 0 | 3.7s | — |
| `15-production-build` | **PASS** | 0 | 69.3s | — |
| `16-playwright-roles` | **PASS** | 0 | 28.3s | — |
| `16-playwright-roles-evidence` | **PASS** | 0 | 0.1s | — |
| `17-golden-browser-journey` | **PASS** | 0 | 15.9s | — |
| `18-worker-readiness` | **PASS** | 0 | 3.3s | — |
| `22-health-smoke` | **PASS** | 0 | 0.0s | — |
| `19-docker-build` | BLOCKED_EXTERNAL | 127 | 0.0s | no container runtime on the certification workstation; see TEL-P1-018 |
| `20-image-inspection` | BLOCKED_EXTERNAL | 127 | 0.0s | no image exists to inspect; see TEL-P1-018 |
| `21-compose-validation` | **PASS** | 0 | 0.4s | — |

## 3. Test execution

| Measure | Value |
|---|---:|
| Test files | 163 |
| Test files passed | 163 |
| Tests passed | 2055 |
| Tests failed | 0 |
| Tests skipped | 0 |

Counts come from Vitest's JSON reporter. None is typed by hand.

## 4. Raw output

Every gate's stdout and stderr was captured while it ran, under
`evidence/raw/run3-*.log` and `evidence/raw/gate-*.log`, and each file
is hash-verified by `npm run certify:validate`.
