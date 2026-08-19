# Telestar CRM — Certification Run 2

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/runs/manifests/run-2.json
  Regenerate: node scripts/certification/render-runs.mjs
-->

**Verdict**: **PASS**
**Candidate SHA**: `dfb172f53afaaae5f8304dd22b8f0dd37af69bcb`
**Release tag**: `telestar-internal-rc-2026-08-20`
**Environment**: win32 / node 24.16.0 / postgres 16 / redis real
**Ran**: 2026-08-19T21:01:06.853Z → 2026-08-19T21:10:12.449Z (9.1 min)

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
| `03-typecheck` | **PASS** | 0 | 29.1s | — |
| `04-lint` | **PASS** | 0 | 115.6s | — |
| `05-test-discipline` | **PASS** | 0 | 0.5s | — |
| `06-migration-validation` | **PASS** | 0 | 0.2s | — |
| `07-database-integrity` | **PASS** | 0 | 8.5s | — |
| `08-vitest` | **PASS** | 0 | 148.8s | — |
| `09-redis-integration` | **PASS** | 0 | 3.4s | — |
| `10-ai-certification` | **PASS** | 0 | 7.3s | — |
| `11-email-safety` | **PASS** | 0 | 2.2s | — |
| `12-import-fault-matrix` | **PASS** | 0 | 7.9s | — |
| `13-queue-load` | **PASS** | 0 | 35.1s | — |
| `14-security-suite` | **PASS** | 0 | 3.7s | — |
| `15-production-build` | **PASS** | 0 | 118.8s | — |
| `16-playwright-roles` | **PASS** | 0 | 32.1s | — |
| `16-playwright-roles-evidence` | **PASS** | 0 | 0.2s | — |
| `17-golden-browser-journey` | **PASS** | 0 | 15.9s | — |
| `18-worker-readiness` | **PASS** | 0 | 3.3s | — |
| `22-health-smoke` | **PASS** | 0 | 0.0s | — |
| `19-docker-build` | BLOCKED_EXTERNAL | 127 | 0.0s | no container runtime on the certification workstation; see TEL-P1-018 |
| `20-image-inspection` | BLOCKED_EXTERNAL | 127 | 0.0s | no image exists to inspect; see TEL-P1-018 |
| `21-compose-validation` | **PASS** | 0 | 0.4s | — |
| `23-validator-selftest` | **PASS** | 0 | 0.7s | — |

## 3. Test execution

| Measure | Value |
|---|---:|
| Test files | 164 |
| Test files passed | 164 |
| Tests passed | 2059 |
| Tests failed | 0 |
| Tests skipped | 0 |

Counts come from Vitest's JSON reporter. None is typed by hand.

## 4. Raw output

Every gate's stdout and stderr was captured while it ran, under
`evidence/raw/run2-*.log` and `evidence/raw/gate-*.log`, and each file
is hash-verified by `npm run certify:validate`.
