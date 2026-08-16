# Production State — Telestar CRM

> **Status:** 🟢 **INTERNAL TEST ENVIRONMENT LIVE**  
> **Canonical Record:** Single authoritative source of truth for the running live environment.  
> **Last Verified:** 2026-08-16T13:57:00Z  

---

## 1. Environment & Architecture

| Property | Value |
| :--- | :--- |
| **Canonical URL** | [https://crm.telestar.cloud](https://crm.telestar.cloud) |
| **Health Endpoint** | [https://crm.telestar.cloud/api/health](https://crm.telestar.cloud/api/health) |
| **DNS Authority** | Hostinger DNS (`A` record `crm.telestar.cloud` → `34.87.126.177`) |
| **Compute Host** | Google Compute Engine (GCE) `telestar-crm-vm` (`asia-southeast1-a`) |
| **Ingress & TLS** | Caddy 2 reverse proxy with automatic Let's Encrypt TLS & HSTS |
| **Database** | Google Cloud SQL PostgreSQL 16 (`telestar-db`, `136.110.29.201`) |
| **Queue & Cache** | Redis 7 (`redis:7-bookworm` container on `crm_internal` network) |
| **Worker Host** | GCE BullMQ worker (`crm-4-u-worker-1`) |

---

## 2. Release & Version Authority

| Component | Reference |
| :--- | :--- |
| **Application Git Commit** | `7580643` |
| **Application Image Digest** | `6b0579357f35` (web and worker on exact same digest) |
| **Infrastructure Git Commit** | `7580643` (on `chore/canary-sequence-script`) |
| **Deploy Target** | `gcp` (`-f docker-compose.yml -f docker-compose.gcp.yml`) |
| **Database Migrations** | 46 total migrations applied (all schema models up to date) |

---

## 3. Operational Safety & Canary Controls

| Flag | Value | Enforced Behavior |
| :--- | :--- | :--- |
| `EMAIL_SEND_DRY_RUN` | `true` | Outbound emails simulated; no live mail leaves the box. |
| `SEQUENCE_AUTOSEND_ENABLED` | `false` | Automated sequence tasks queued but not dispatched automatically. |
| `EMAIL_HEALTH_AUTOPAUSE` | `true` | Mailboxes exceeding bounce threshold auto-paused. |
| `EMAIL_GLOBAL_PAUSE` | `false` | Emergency kill switch — when `true`, all outbound mail immediately blocked. |
| `LIVE_EMAIL_CANARY_MODE` | `true` | When active, restricts live sending exclusively to `LIVE_EMAIL_ALLOWED_RECIPIENTS`. |

---

## 4. Canonical Runbooks & Operations

| Operation | Canonical Reference / Command |
| :--- | :--- |
| **Production Readiness Audit** | `npx tsx scripts/production-readiness-audit.ts` |
| **DNS Deliverability Audit** | `npx tsx scripts/verify-domain-dns.ts telestar.cloud` |
| **Email Incident Runbook** | [`docs/EMAIL_INCIDENT_RUNBOOK.md`](./EMAIL_INCIDENT_RUNBOOK.md) |
| **Backup & Restore Drill** | [`docs/BACKUP_RESTORE_RUNBOOK.md`](./BACKUP_RESTORE_RUNBOOK.md) |
| **Rollback Execution** | [`docs/ROLLBACK_RUNBOOK.md`](./ROLLBACK_RUNBOOK.md) / `./scripts/rollback.sh` |
| **Smoke Test** | `./scripts/post-deploy-smoke.sh` |
| **Topology Validation** | `npm run check:production-compose` |
| **Worker Healthcheck** | `npm run worker:healthcheck` |
| **Hourly Cron Dispatch** | `/opt/crm-4-u/bin/cron-call.sh <sequence-engine\|inbox-sync\|email-health>` |


---

## 5. Known Open Operational Debt

- [ ] **A3 — Backup Restore Drill:** Exercise full restore from Cloud SQL automated backup to a separate scratch instance to prove recovery RTO/RPO.
- [ ] **A6 — Data Reconciliation:** Validate legacy demo data cleanup vs production tenant isolation.
- [ ] **A7 — Dedicated Operator Credentials:** Seed unique passwords for production accounts, retiring shared defaults.
- [ ] **A11 — Live Role Journey Audits:** Run Playwright / manual acceptance scans against live domain.
- [ ] **Cloud SQL Server SSL:** Enforce `require-ssl` flag on Cloud SQL instance.
- [ ] **Hostinger VPS Migration:** Deferred until GCP production test phase completes.
