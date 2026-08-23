# Telestar CRM — Certification Run 1

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/runs/manifests/run-1.json
  Regenerate: node scripts/certification/render-runs.mjs
-->

**Verdict**: **PASS**
**Candidate SHA**: `fa3a54be4276d79ea7d24d63aab4e89ae3ff0bbb`
**Release tag**: `telestar-internal-rc-2026-08-22`
**Environment**: win32 / node 24.16.0 / postgres 16 / redis real
**Ran**: 2026-08-23T12:48:54.499Z → 2026-08-23T13:13:42.477Z (24.8 min)

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
| `03-typecheck` | **PASS** | 0 | 28.3s | — |
| `04-lint` | **PASS** | 0 | 56.7s | — |
| `05-test-discipline` | **PASS** | 0 | 0.3s | — |
| `06-migration-validation` | **PASS** | 0 | 0.2s | — |
| `07-database-integrity` | **PASS** | 0 | 4.8s | — |
| `08-vitest` | **PASS** | 0 | 172.9s | — |
| `09-redis-integration` | **PASS** | 0 | 4.2s | — |
| `10-ai-certification` | **PASS** | 0 | 8.9s | — |
| `11-email-safety` | **PASS** | 0 | 2.4s | — |
| `12-import-fault-matrix` | **PASS** | 0 | 8.2s | — |
| `13-queue-load` | **PASS** | 0 | 24.5s | — |
| `14-security-suite` | **PASS** | 0 | 4.2s | — |
| `15-production-build` | **PASS** | 0 | 191.6s | — |
| `16-playwright-roles` | **PASS** | 0 | 33.8s | — |
| `16-playwright-roles-evidence` | **PASS** | 0 | 0.2s | — |
| `17-golden-browser-journey` | **PASS** | 0 | 16.3s | — |
| `18-worker-readiness` | **PASS** | 0 | 51.8s | — |
| `22-health-smoke` | **PASS** | 0 | 0.0s | — |
| `19-docker-build` | **PASS** | 0 | 849.8s | — |
| `20-image-inspection` | **PASS** | 0 | 0.2s | — |
| `21-compose-validation` | **PASS** | 0 | 1.5s | — |
| `23-validator-selftest` | **PASS** | 0 | 1.6s | — |

## 3. Test execution

| Measure | Value |
|---|---:|
| Test files | 194 |
| Test files passed | 194 |
| Tests passed | 2780 |
| Tests failed | 0 |
| Tests skipped | 0 |

Counts come from Vitest's JSON reporter. None is typed by hand.

## 4. Raw output

Every gate's stdout and stderr was captured while it ran, under
`evidence/raw/run1-*.log` and `evidence/raw/gate-*.log`, and each file
is hash-verified by `npm run certify:validate`.
