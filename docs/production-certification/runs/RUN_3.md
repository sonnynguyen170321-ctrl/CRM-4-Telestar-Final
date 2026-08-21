# Telestar CRM — Certification Run 3

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/runs/manifests/run-3.json
  Regenerate: node scripts/certification/render-runs.mjs
-->

**Verdict**: **PASS**
**Candidate SHA**: `daa8ffb679b7bee87a907d4913123318b697eab6`
**Release tag**: `telestar-internal-rc-2026-08-21`
**Environment**: win32 / node 24.16.0 / postgres 16 / redis real
**Ran**: 2026-08-21T02:56:50.536Z → 2026-08-21T03:03:30.823Z (6.7 min)

---

## 1. Scope

This run executed **24 gates**: 22 passed, 0 failed, 2 blocked externally.
Mandatory skips: **0**.

No mandatory gate was omitted.

## 2. Gates

| Gate | Status | Exit | Duration | Notes |
|---|---|---:|---:|---|
| `01-source-identity` | **PASS** | 0 | 0.0s | — |
| `02-environment` | **PASS** | 0 | 0.3s | — |
| `03-typecheck` | **PASS** | 0 | 27.8s | — |
| `04-lint` | **PASS** | 0 | 52.1s | — |
| `05-test-discipline` | **PASS** | 0 | 0.3s | — |
| `06-migration-validation` | **PASS** | 0 | 0.1s | — |
| `07-database-integrity` | **PASS** | 0 | 2.0s | — |
| `08-vitest` | **PASS** | 0 | 134.1s | — |
| `09-redis-integration` | **PASS** | 0 | 3.5s | — |
| `10-ai-certification` | **PASS** | 0 | 7.8s | — |
| `11-email-safety` | **PASS** | 0 | 2.2s | — |
| `12-import-fault-matrix` | **PASS** | 0 | 5.7s | — |
| `13-queue-load` | **PASS** | 0 | 20.7s | — |
| `14-security-suite` | **PASS** | 0 | 3.7s | — |
| `15-production-build` | **PASS** | 0 | 79.6s | — |
| `16-playwright-roles` | **PASS** | 0 | 29.1s | — |
| `16-playwright-roles-evidence` | **PASS** | 0 | 0.1s | — |
| `17-golden-browser-journey` | **PASS** | 0 | 14.7s | — |
| `18-worker-readiness` | **PASS** | 0 | 3.4s | — |
| `22-health-smoke` | **PASS** | 0 | 0.0s | — |
| `19-docker-build` | BLOCKED_EXTERNAL | 127 | 0.0s | no container runtime on the certification workstation; see TEL-P1-018 |
| `20-image-inspection` | BLOCKED_EXTERNAL | 127 | 0.0s | no image exists to inspect; see TEL-P1-018 |
| `21-compose-validation` | **PASS** | 0 | 0.5s | — |
| `23-validator-selftest` | **PASS** | 0 | 0.8s | — |

## 3. Test execution

| Measure | Value |
|---|---:|
| Test files | 175 |
| Test files passed | 175 |
| Tests passed | 2340 |
| Tests failed | 0 |
| Tests skipped | 0 |

Counts come from Vitest's JSON reporter. None is typed by hand.

## 4. Raw output

Every gate's stdout and stderr was captured while it ran, under
`evidence/raw/run3-*.log` and `evidence/raw/gate-*.log`, and each file
is hash-verified by `npm run certify:validate`.
