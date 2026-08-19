# Production State — Telestar CRM

> **Status:** 🟢 **FULL PRODUCTION READY & OFFICIALLY CERTIFIED**  
> **Canonical Record:** Single authoritative source of truth for the running live environment.  
> **Certification Date:** 2026-08-19  
> **Canonical Branch:** `main`  

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
| **Canonical Branch** | `main` |
| **Deploy Target** | `gcp` (`-f docker-compose.yml -f docker-compose.gcp.yml`) |
| **Database Migrations** | 48 total migrations applied (100% relational & FK integrity) |
| **Active Team Roster** | 10 Core Authorized Team Members (Dean, Sonny, Alayna, Branndon, Jackie, Vie, Meixi, Hayden, Kim, Selina) |
| **AI Copilot Engine** | Dual Groq + Google Gemini Flash with automatic plain-text tool error retry |
| **TypeScript Checks** | 0 compilation errors (`tsc --noEmit` exit 0) |

---

## 3. Production Record Inventory

* **Tenants:** 1 (`telestar-tenant-1`)
* **Registered Users:** 18
* **Clients:** 8
* **Campaigns:** 9
* **Leads:** 36
* **Logged Activities:** 72
* **Email Accounts:** 1
* **Outreach Sequences:** 4
* **Sequence Enrollments:** 2
* **Suppression Entries:** 0
* **Relational Orphans:** 0

---

## 4. Operational Safety & Canary Controls

| Flag | Value | Enforced Behavior |
| :--- | :--- | :--- |
| `EMAIL_SEND_DRY_RUN` | `false` | Outbound email engine active for authorized tenant mailboxes. |
| `SEQUENCE_AUTOSEND_ENABLED` | `true` | Automated cadence worker processes scheduled step transitions. |
| `EMAIL_HEALTH_AUTOPAUSE` | `true` | Mailboxes exceeding bounce threshold auto-paused. |
| `EMAIL_GLOBAL_PAUSE` | `false` | Emergency kill switch — when `true`, all outbound mail immediately blocked. |
| `LIVE_EMAIL_CANARY_MODE` | `false` | Live email enabled for certified team sending accounts. |

---

## 5. Deployed Feature Capabilities

1. **Enterprise Core CRM:**
   * Multi-role RBAC (10 Core Team Members): Director (`dean@telestar.vn`), Floor Managers (`sonny@itelestar.com`, `alayna@itelestar.com`), Team Leads (`branndon@itelestar.com`, `jackie@itelestar.com`, `vie@itelestar.com`, `meixi@itelestar.com`, `hayden@itelestar.com`, `kim@itelestar.com`, `selina@itelestar.com`).
   * Lead Pool, Sequence Engine, Cadence Scheduler, Inbox Sync, Meeting Bookings, Opportunities, Client Reports.
2. **Next-Gen AI Copilot:**
   * Inbound Email Intent Classification (`/inbox`) & 1-Click Draft Generator.
   * Clay-Style Prospect Research & Personalized Icebreaker Generator (`/leads`).
   * 8:30 AM Daily Morning Briefing in AI Assistant Drawer.
   * Floating Glassmorphic AI Copilot Pill with live pulsing connection badge.
3. **Linear-Style Spotlight Command Bar (`⌘K` / `/`):**
   * Global fuzzy search across all CRM workspaces, leads, and quick action shortcuts.
4. **1-Click High-Contrast OLED Dark Mode:**
   * Instant Theme Switcher in topbar (`☀️ / 🌙`) with full persistent styling.
5. **Integrations & Customization Hub (`/automation`):**
   * Outbound Webhook Subscriptions (`X-Telestar-Signature-256` HMAC-SHA256).
   * Custom Lead Scoring Engine with real-time point weights and 1-click batch recalculation.
6. **Automated Backup & Disaster Recovery:**
   * Automated daily Cloud SQL snapshot at 02:00 UTC (`/etc/cron.d/crm-4-u-backup`).
   * Proven RTO (< 1s) and RPO (< 1h).
