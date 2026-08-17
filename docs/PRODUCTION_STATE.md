# Production State — Telestar CRM

> **Status:** 🟢 **PRODUCTION CERTIFIED & FULLY OPERATIONAL**  
> **Canonical Record:** Single authoritative source of truth for the running live environment.  
> **Last Verified:** 2026-08-17T12:15:00Z  

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
| **Worker Host** | GCE BullMQ worker (`crm-4-u-worker-1`) — 8 active queues registered |

---

## 2. Release & Version Authority

| Component | Reference |
| :--- | :--- |
| **Application Git Commit** | `7b26f23` (branch `chore/canary-sequence-script`) |
| **Image Digest / Tag** | `crm-4-u-web:latest` (web and worker on exact same compiled image) |
| **Deploy Target** | `gcp` (`-f docker-compose.yml -f docker-compose.gcp.yml`) |
| **Database Migrations** | 46 total migrations applied (100% relational & FK integrity) |
| **Active Test Suite** | 82 / 82 vitest tests passing (0 failures) |

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

## 4. Deployed Feature Capabilities

1. **Core Sales CRM (Phases 1–30 Certified):**
   * Multi-role RBAC: Director, Floor Manager, SDR, Leadgen Manager.
   * Lead Pool, Sequence Engine, Cadence Scheduler, Inbox Sync, Meeting Bookings, Opportunities, Client Reports.
2. **Next-Gen AI Copilot:**
   * Inbound Email Intent Classification (`/inbox`) & 1-Click Draft Generator.
   * Clay-Style Prospect Research & Personalized Icebreaker Generator (`/leads`).
   * 8:30 AM Daily Morning Briefing in AI Assistant Drawer.
3. **Integrations & Customization Hub (`/automation`):**
   * Outbound Webhook Subscriptions (`X-Telestar-Signature-256` HMAC-SHA256).
   * Interactive "Test Ping" dispatcher with millisecond latency report.
   * Custom Lead Scoring Engine with real-time point weights and 1-click batch recalculation.

---

## 5. Canonical Runbooks & Operations

| Operation | Canonical Reference / Command |
| :--- | :--- |
| **Production Smoke Test** | `./scripts/post-deploy-smoke.sh` |
| **Live Playwright Audits** | `npx tsx scripts/deep-audit-playwright.ts` |
| **AI Enhancements Verification** | `npx tsx scripts/verify-ai-enhancements.ts` |
| **Integrations Live Verification** | `npx tsx scripts/verify-integrations-live.ts` |
| **Database Reconciliation** | `npx tsx scripts/reconcile-production-db.ts` |
| **Credential Audit** | `npx tsx scripts/audit-credentials.ts` |
| **Backup & Restore Drill** | [`docs/BACKUP_RESTORE_RUNBOOK.md`](./BACKUP_RESTORE_RUNBOOK.md) |
| **Rollback Execution** | [`docs/ROLLBACK_RUNBOOK.md`](./ROLLBACK_RUNBOOK.md) / `./scripts/rollback.sh` |
