# Telestar CRM — Master 5-Minute Product Walkthrough & Demo Guide

> **Audience:** Clients, Prospects, Executive Leadership, SDR Operations  
> **Environment:** Live Production (`https://crm.telestar.cloud`) or Staging  
> **Estimated Demo Duration:** 5–7 minutes  

---

## 🎭 Persona Credentials Reference

| Persona | Email | Password | Primary Surface |
| :--- | :--- | :--- | :--- |
| **Director** | `dean@telestar.vn` | `Telestar2026` | Executive Brief, Campaign ROI, Revenue Health |
| **Floor Manager** | `sonny@itelestar.com` | `Telestar2026` | SDR Attention Matrix, Workload Reassignment |
| **Team Lead** | `branndon@itelestar.com` | `Telestar2026` | 1-on-1 Coaching, Queue Management |
| **SDR** | `lan.pham@itelestar.com` | `Telestar2026` | AI Copilot, 1-Click Dialing, Icebreaker Generator |
| **Leadgen Manager** | `dominic@itelestar.com` | `Telestar2026` | Lead Pool, ICP Adherence, Batch Conversion |

---

## ⏱️ 5-Minute Live Demo Flow

### Act 1: The Executive Command Center (Director / Floor Manager)
* **Goal:** Prove operational clarity and real-time revenue intelligence in under 60 seconds.
* **Log In As:** `dean@telestar.vn` or `sonny@itelestar.com`

1. **Morning Briefing & Floor Pulse:**
   * Open the **AI Copilot Drawer** (click the floating glassmorphic Copilot pill in the lower right or press `⌘K`).
   * Show the **8:30 AM Daily Morning Briefing**:
     * Highlights top 3 pipeline risks and unreached high-priority accounts.
     * Displays team response velocity and deliverability health.
2. **Global Spotlight Navigation (`⌘K` / `/`):**
   * Press `⌘K` to open the Command Palette.
   * Search for `"Canary"` or `"Acme Logistics"`. Show instant fuzzy navigation directly to lead timelines without loading screens.
3. **High-Contrast OLED Dark Mode:**
   * Toggle the Theme Switcher in the topbar (`☀️ / 🌙`). Show seamless zero-flicker glassmorphic styling across charts and data tables.

---

### Act 2: The SDR Outreach Engine & AI Copilot (SDR)
* **Goal:** Demonstrate how Telestar AI reduces SDR prep time from 15 minutes to 15 seconds per lead.
* **Log In As:** `lan.pham@itelestar.com`

1. **Next Best Action Priority Matrix:**
   * Navigate to `/tasks` and `/leads`.
   * Show how leads are ranked dynamically using **Multi-Factor Lead Scoring** (engagement + title relevance + ICP match).
2. **Clay-Style AI Prospect Research & Icebreaker Generator:**
   * Click on any lead to open the **Lead Detail Drawer**.
   * Click **"⚡ AI Enrich & Research"**.
   * Watch the AI analyze company positioning, extract key pain points, and generate 3 custom peer-to-peer opening hooks (Operational Pain, Social Proof, and Industry Trend).
3. **Integrated WebRTC Softphone Dialer:**
   * Click the **"📞 Call"** button on the lead record.
   * Demonstrate the **Call Dialer Modal**:
     * Live call connection with synthesized DTMF dial pad.
     * One-click call outcome logging (`Connected - Pitching`, `Gatekeeper Objection`, `Meeting Booked`).
     * Call notes auto-appended to lead activity timeline.
4. **AI Inbound Email Classifier:**
   * Navigate to `/inbox`.
   * Click on an incoming thread: show automatic sentiment tagging (`Interested`, `Out of Office`, `Objection - Budget`) and 1-click contextual draft generation.

---

### Act 3: Lead Pool Sourcing & ICP Governance (Leadgen Manager)
* **Goal:** Show data quality enforcement before leads ever reach the SDR queue.
* **Log In As:** `dominic@itelestar.com`

1. **Leadgen Pool & ICP Adherence Engine:**
   * Navigate to `/leadgen-pool` or `/leads/import`.
   * Show how raw prospect imports are screened against the campaign ICP requirements (Industry, Title, Company Size).
2. **1-Click Batch Conversion:**
   * Select qualified pool leads and click **"Convert to Active Campaign"**.
   * Leads are automatically assigned to reps, contact deduplication runs, and initial sequence steps are scheduled.

---

### Act 4: Multi-Step Sequence Automation & Cadence Analytics
* **Goal:** Showcase enterprise deliverability, auto-advance logic, and A/B variant tracking.
* **Log In As:** `sonny@itelestar.com`

1. **Visual Sequence Builder (`/sequences`):**
   * Review multi-step outreach ladder (Day 1: AI Cold Email → Day 3: Phone Touchpoint → Day 5: Break-up Message).
   * Show **"Run Now"** capability for instant step advancement during staging drills.
2. **A/B Variant Attribution & Performance (`/sequences/performance`):**
   * Show conversion tracking per subject line variant (A vs B) with reply rate attribution.
3. **Email Deliverability & Auto-Pause Sentinel (`/email-health`):**
   * Show mailbox health monitor with automatic bounce threshold circuit breaker.

---

### Act 5: Client Reporting & Developer API Hub
* **Goal:** Demonstrate stakeholder transparency and external integration readiness.

1. **Executive Client Portal (`/client-reports`):**
   * Show client-facing performance dashboard with meeting conversion rate, activity counts, and 1-click PDF/CSV export.
2. **Interactive OpenAPI 3.1 Developer Hub (`/docs`):**
   * Navigate to `https://crm.telestar.cloud/docs`.
   * Show complete interactive API documentation for VOIP caller integration, lead sync, and webhook events.

---

## 🎯 Key Differentiators to Emphasize

1. **Real Infrastructure:** BullMQ Redis queue on dedicated worker (`crm-4-u-worker-1`), Cloud SQL Postgres, Caddy TLS.
2. **Zero Hallucination AI:** AI engine is strictly governed by a 10-tier Constitution, temporal bounds, and PII anonymization.
3. **Tenant & Role Isolation:** Absolute database-level tenancy separation across all personas.
4. **All-in-One Operations:** Replaces 4 separate tools (Apollo/Clay + Outreach/Salesloft + Softphone + Analytics).
