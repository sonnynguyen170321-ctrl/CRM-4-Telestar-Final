# Telestar CRM — Certification Run 1

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/runs/manifests/run-1.json
  Regenerate: node scripts/certification/render-runs.mjs
-->

**Verdict**: **FAIL**
**Candidate SHA**: `9fa36d3bcac6532f0c6f07af9045825a9d97844f`
**Release tag**: `telestar-internal-rc-2026-08-22`
**Environment**: win32 / node 24.16.0 / postgres 16 / redis real
**Ran**: 2026-08-22T07:43:52.652Z → 2026-08-22T07:52:26.734Z (8.6 min)

---

## 1. Scope

This run executed **24 gates**: 21 passed, 1 failed, 2 blocked externally.
Mandatory skips: **0**.

No mandatory gate was omitted.

## 2. Gates

| Gate | Status | Exit | Duration | Notes |
|---|---|---:|---:|---|
| `01-source-identity` | **PASS** | 0 | 0.0s | — |
| `02-environment` | **PASS** | 0 | 0.3s | — |
| `03-typecheck` | **PASS** | 0 | 28.1s | — |
| `04-lint` | **PASS** | 0 | 49.3s | — |
| `05-test-discipline` | **PASS** | 0 | 0.5s | — |
| `06-migration-validation` | **PASS** | 0 | 0.1s | — |
| `07-database-integrity` | **PASS** | 0 | 9.2s | — |
| `08-vitest` | **PASS** | 0 | 158.3s | — |
| `09-redis-integration` | **PASS** | 0 | 3.4s | — |
| `10-ai-certification` | **PASS** | 0 | 7.5s | — |
| `11-email-safety` | **PASS** | 0 | 2.2s | — |
| `12-import-fault-matrix` | **PASS** | 0 | 9.0s | — |
| `13-queue-load` | **PASS** | 0 | 37.4s | — |
| `14-security-suite` | **PASS** | 0 | 3.9s | — |
| `15-production-build` | **PASS** | 0 | 140.5s | — |
| `16-playwright-roles` | **PASS** | 0 | 32.2s | — |
| `16-playwright-roles-evidence` | **PASS** | 0 | 0.1s | — |
| `17-golden-browser-journey` | **PASS** | 0 | 15.6s | — |
| `18-worker-readiness` | **PASS** | 0 | 3.5s | — |
| `22-health-smoke` | **FAIL** | 1 | 0.0s | — |
| `19-docker-build` | BLOCKED_EXTERNAL | 127 | 0.0s | no container runtime answers on this machine (docker/podman); install one and re-run |
| `20-image-inspection` | BLOCKED_EXTERNAL | 127 | 0.0s | no container runtime answers on this machine, so no image exists to inspect |
| `21-compose-validation` | **PASS** | 0 | 0.5s | — |
| `23-validator-selftest` | **PASS** | 0 | 0.9s | — |

## 3. Test execution

| Measure | Value |
|---|---:|
| Test files | 186 |
| Test files passed | 186 |
| Tests passed | 2629 |
| Tests failed | 0 |
| Tests skipped | 0 |

Counts come from Vitest's JSON reporter. None is typed by hand.

## 4. Raw output

Every gate's stdout and stderr was captured while it ran, under
`evidence/raw/run1-*.log` and `evidence/raw/gate-*.log`, and each file
is hash-verified by `npm run certify:validate`.
