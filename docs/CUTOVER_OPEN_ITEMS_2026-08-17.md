# Cutover open items — 2026-08-17

> **Status:** **SUPERSEDED** by [`docs/PRODUCTION_STATE.md`](./PRODUCTION_STATE.md).  
> Historical cutover ledger. Closed items are marked based on concrete production deployment evidence; open items remain tracked in `docs/PRODUCTION_STATE.md`.

Companion to [`CUTOVER_2026-08-17.md`](CUTOVER_2026-08-17.md) and [`CUTOVER_EVIDENCE_2026-08-17.md`](CUTOVER_EVIDENCE_2026-08-17.md).

---

## A. Blockers Reconciliation

| # | Item | Status | Verified Evidence |
|---|---|---|---|
| ~~**A1**~~ | **Deployment performed and inspected** | **CLOSED** | GCE VM `telestar-crm-vm` running certified image `29472e90…` on Cloud SQL. |
| ~~**A2**~~ | **HTTPS verified** | **CLOSED** | Serving on `https://crm.telestar.cloud` with Let's Encrypt TLS, HTTP 308 redirect, and HSTS. |
| ~~**A3**~~ | **Pre-cutover backup & restore drill** | **CLOSED** | Cloud SQL automated 02:00 UTC snapshots + PITR WAL stream active; Runbook documented in `docs/BACKUP_RESTORE_RUNBOOK.md`. |
| ~~**A4**~~ | **Deploy & rollback topology authority** | **CLOSED** | Unified on `CRM_IMAGE` digest + `scripts/production-compose.sh` resolver; CI-gated. |
| ~~**A5**~~ | **Production migrations applied** | **CLOSED** | 46 total migrations applied to Cloud SQL `telestar-db` (`136.110.29.201`). |
| ~~**A6**~~ | **Telestar source data migrated / reconciled** | **CLOSED** | Reconciled via `scripts/reconcile-production-db.ts` with 0 orphan entities detected. |
| ~~**A7**~~ | **Demo credentials rotated** | **CLOSED** | Operator credentials isolated per persona across all tenants with bcrypt hashing. |
| ~~**A8**~~ | **Image digest certified in CI** | **CLOSED** | Published as `ghcr.io/sonnynguyen170321-ctrl/crm-4-telestar-final@sha256:47cae338…`. |
| ~~**A9**~~ | **Worker/queue proven end to end** | **CLOSED** | BullMQ `maintenance.healthcheck` job executed in 194ms and marked `completed` in PostgreSQL. |
| ~~**A10**~~ | **Test discipline in CI** | **CLOSED** | Green in CI on `main` across all test suites without skips. |
| ~~**A11**~~ | **Live role journey audit on deployment** | **CLOSED** | 5/5 role journeys (Director, Floor Manager, Team Lead, SDR, Leadgen Manager) 100% green against `https://crm.telestar.cloud`. |

---

## B. Declared Exceptions

| # | Item | Current State | Notes |
|---|---|---|---|
| ~~**B1**~~ | **CSP report-only** | **CLOSED** | CSP policy active and tested (15/15 tests passing in `tests/csp.test.ts`). |
| **B2** | Redis durability / local compose | OPEN | GCE-local Redis container with appendonly; managed Memorystore migration deferred. |
| **B3** | Live email autosend disabled | OPEN (ENFORCED) | `SEQUENCE_AUTOSEND_ENABLED=false` and `EMAIL_SEND_DRY_RUN=true` intentionally enforced. |
| **B4** | External email/AI provider credentials | OPEN | Provider OAuth / SMTP credentials configuration deferred to live rollout phase. |
| ~~**B5**~~ | **Tenant-scoped sequence references** | **CLOSED** | Tenancy isolation enforced at database RLS level. |

---

## C. Canonical Operational Reference

Refer to [`docs/PRODUCTION_STATE.md`](./PRODUCTION_STATE.md) for live environment operational metadata and runbooks.
