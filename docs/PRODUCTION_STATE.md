# Production State — Telestar CRM

> **Status:** 🟢 **INTERNAL TEST ENVIRONMENT LIVE**  
> **Canonical Record:** Single authoritative source of truth for the running live environment.  
> **Last Verified:** 2026-08-16T13:20:00Z  

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
| **Application Git Commit** | `29472e90d2f561d3b9eca46e31d856b8697cce40` |
| **Application Image Digest** | `ghcr.io/sonnynguyen170321-ctrl/crm-4-telestar-final@sha256:47cae338dcb6c3a0197033570eb56937430a67092c72a57d9208b1a127b4266d` |
| **Infrastructure Git Commit** | `d978240` (on `main`) |
| **Deploy Target** | `gcp` (`-f docker-compose.yml -f docker-compose.gcp.yml`) |
| **Database Migrations** | 46 total migrations applied (all schema models up to date) |

---

## 3. Operational Safety Flags

| Flag | Value | Enforced Behavior |
| :--- | :--- | :--- |
| `EMAIL_SEND_DRY_RUN` | `true` | Outbound emails simulated; no live mail leaves the box. |
| `SEQUENCE_AUTOSEND_ENABLED` | `false` | Automated sequence tasks queued but not dispatched automatically. |
| `EMAIL_HEALTH_AUTOPAUSE` | `true` | Mailboxes exceeding bounce threshold auto-paused. |

---

## 4. Canonical Runbooks & Operations

| Operation | Canonical Command |
| :--- | :--- |
| **Deploy Exact Build** | `./scripts/deploy.sh <40-char-git-sha>` |
| **Rollback to Previous** | `./scripts/rollback.sh` |
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
