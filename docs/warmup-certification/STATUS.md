# Email Inbox Warmup & Sender Reputation Certification — STATUS

> This file tracks the progress of the Warmup & Sender Reputation Certification (Gates W1–W20).

**Current Phase:** W1–W2 (Mailbox Inventory & Domain Foundation Check)
**Next Task:** W1 Inventory Generation & W2 DNS Authentication Probe
**Overall Progress:** 0 / 20 Gates Complete

---

## 📋 Warmup Gates Progress (W1–W20)

- [ ] **W1 — Inventory Every Production Sending Inbox:** Query Cloud SQL `EmailAccount` records & map warmup state.
- [ ] **W2 — Domain Foundation Check:** Validate SPF, DKIM, DMARC, MX records for `@itelestar.com`, `@telestar.cloud`, `@telestar.vn`.
- [ ] **W3 — Add Warmup State to the CRM:** Verify persistent schema fields (`warmupStatus`, `warmupDay`, `warmupDailyLimit`, `healthScore`).
- [ ] **W4 — Worker Capacity & Policy Enforcement:** Verify BullMQ worker enforces `effectiveLimit = min(configuredLimit, warmupLimit, healthAdjustedLimit)`.
- [ ] **W5 — Configurable Warmup Ramp Schedule:** Ensure conservative stage ramp (15 -> 30 -> 60 -> 100 -> 150).
- [ ] **W6 — Separate Warmup Traffic from Outreach:** Canary allowlist & conversational traffic verification.
- [ ] **W7 — Inbound Sync & Reply Loop:** IMAP thread matching & ingestion check.
- [ ] **W8 — Per-Mailbox Daily Send Capacity:** Atomic race-safe Redis / DB CAS limit counter.
- [ ] **W9 — Health-Based Automatic Ramp:** Verify advancement requires 0 bounces & healthy send history.
- [ ] **W10 — Automatic Warmup Pause:** Auto-pause if bounce rate > 3% on sample size >= 10.
- [ ] **W11 — Recovery Stage Logic:** `WARM -> DEGRADED -> PAUSED -> RECOVERY -> WARM` transition state machine.
- [ ] **W12 — Warmup Dashboard:** Real-time visibility on `/email-health` (sent today, remaining, warmup day, health status).
- [ ] **W13 — SDR Sender Selection Rules:** Restrict SDRs from launching sequences with paused/warming-depleted mailboxes.
- [ ] **W14 — Sequence Scheduler Capacity Distribution:** Defer sequence tasks smoothly when mailbox daily capacity is reached without error drops.
- [ ] **W15 — Multi-Inbox Load Distribution:** Intelligent routing respecting SDR ownership and sender identity.
- [ ] **W16 — Warmup + Canary Isolation:** Strict adherence: `stricter_rule_wins(warmup_allowance, canary_allowlist)`.
- [ ] **W17 — Health Auto-Pause Thresholds:** Min sample size protection to avoid false triggers on low volume.
- [ ] **W18 — Automated Test Suite:** Unit & concurrency tests for warmup limits and capacity resets.
- [ ] **W19 — Live Warmup Evidence Records:** Audit logs for active mailboxes.
- [ ] **W20 — Production Warm Inbox Gate:** Final sign-off for live outreach scaling.

---

## 📝 Change Log
- **2026-08-17:** Created warmup certification tracking roadmap (W1–W20).
