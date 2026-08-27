# UI/UX Impeccable Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate 100% of AI-detected design artifacts and ensure all 20+ routes achieve zero flags on `scripts/design-audit.mjs` while maintaining flawless type check and test suites.

**Architecture:** A three-phase execution model: (1) Global CSS and design token enforcement to guarantee typography, contrast, and neutral shadows application-wide, (2) Route-by-route structural and component cleanup (SDR, Director, Admin), (3) Playwright-driven automated audit iteration and release verification ladder.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, IBM Plex Fonts (Sans, Condensed, Mono), Playwright, Vitest.

## Global Constraints

- Never use generator fonts (`inter`, `geist`, `geist mono`, `poppins`, `montserrat`). IBM Plex family only.
- Never use font size below 12px (`--text-micro: 12px` absolute floor).
- All standard text must satisfy $\ge 4.5:1$ contrast against background; large text $\ge 3:1$.
- Orange buttons (`#E8611A`) must have `#0A0A0A` near-black labels (5.99:1).
- Emerald buttons (`#047857`) must have white `#FFFFFF` labels (5.48:1).
- Exactly one `<h1>` per page. Top-level panel containers must be `<h2>`. Subsections `<h3>`.
- No cards inside card containers. Outer kanban columns / segmented control bars must have no card borders/shadows.
- Dense table rows must be $\ge 48\text{px}$ high with $\ge 24\text{px}$ total vertical padding.
- All prose paragraphs must be capped at 68ch via `.prose-measure`.
- No springy cubic-beziers, gradient text clips, or tinted shadow glow halos.

---

### Task 1: Global Theme & Token Armor Sweep

**Files:**
- Modify: `app/globals.css`
- Modify: `tailwind.config.js` (or relevant theme configs)
- Test: `scripts/design-audit.mjs`

**Interfaces:**
- Consumes: CSS variables in `app/globals.css`.
- Produces: Guaranteed contrast rules, table padding overrides, text floor tokens, neutral shadow definitions.

- [ ] **Step 1: Inspect and verify global CSS definitions in `app/globals.css`**
  Ensure:
  - Font families are strictly IBM Plex Sans, IBM Plex Sans Condensed, IBM Plex Mono.
  - `--text-micro` is 12px, `--text-meta` is 13px, `--text-body` is 14px, `--text-subsection` is 16px, `--text-section` is 20px, `--text-page` is 28px.
  - Unlayered contrast override rules for chromatic text weights (`emerald`, `green`, `blue`, `amber`, `red`, `purple`, `indigo`, `sky`, `cyan`).
  - Table dense cell padding rules (`table th, table td { padding-top: 16px; padding-bottom: 16px; }`).
  - Button text contrast rules for `[class~="bg-brand-orange"]` (near-black text) and `[class~="bg-emerald-600"], [class~="bg-emerald-700"]` (white text).
  - Clean purge of all dead tokens (`text-muted`, `bg-surface`, `text-foreground`, `text-surface`, `bg-muted`).

- [ ] **Step 2: Run static audit check on components for dead utility tokens**
  Run: `grep -rn "text-muted\|bg-surface\|text-foreground\|text-surface\|bg-muted" app/ components/`
  Expected: 0 unmapped token matches.

- [ ] **Step 3: Fix any leftover unmapped tokens across components**
  Map to proper theme tokens (`text-text-muted`, `bg-card-bg`, `text-text-primary`, `text-text-secondary`, `bg-canvas`).

- [ ] **Step 4: Verify type safety with TypeScript**
  Run: `npx tsc --noEmit`
  Expected: 0 errors (exit 0).

---

### Task 2: SDR & Core Workflow Route Remediation

**Files:**
- Modify: `app/leads/page.tsx`
- Modify: `components/LeadDetailPanel.tsx`
- Modify: `app/inbox/page.tsx`
- Modify: `app/page.tsx`
- Modify: `app/sequences/page.tsx`
- Modify: `app/templates/page.tsx`
- Modify: `app/tasks/page.tsx`

**Interfaces:**
- Consumes: Lead, Sequence, Task, and Activity models.
- Produces: SDR views compliant with single `<h1>`, no card nesting in kanban, 13px/12px minimum typography, tabular monospace data.

- [ ] **Step 1: Remediate `app/leads/page.tsx` & `components/LeadDetailPanel.tsx`**
  - Verify kanban column wrappers are layout lanes without card border chrome (`border border-card-border` removed from column outer wrapper; inner lead cards retain 1px border).
  - Verify single `<h1>` on `/leads`.
  - In `LeadDetailPanel`, ensure meta timestamps are $\ge 12\text{px}$, phone numbers & emails use monospace tabular font, activity timeline has high-contrast text.

- [ ] **Step 2: Remediate `app/inbox/page.tsx` & `app/page.tsx` (Task Dashboard)**
  - Ensure task action triggers conform to SDR workflow rules: "Log & Complete" for LinkedIn/WhatsApp, "Complete" for Phone.
  - Tab bar (Today / Yesterday / Overdue) uses underline tab styling without card-in-card buttons.
  - Empty state text uses `.type-body` (14px) and `.prose-measure`.

- [ ] **Step 3: Remediate `app/sequences/page.tsx`, `app/templates/page.tsx`, and `app/tasks/page.tsx`**
  - Promote top-level panel headings to `<h2>` with `.type-section`.
  - Email step timeline uses clean vertical line borders with no glowing halos.
  - Template preview prose wrapped in `.prose-measure`.

- [ ] **Step 4: Verify type check**
  Run: `npx tsc --noEmit`
  Expected: 0 errors.

---

### Task 3: Director & Management Surface Remediation

**Files:**
- Modify: `app/director/page.tsx`
- Modify: `app/team/page.tsx`
- Modify: `app/campaigns/page.tsx`
- Modify: `app/opportunities/page.tsx`
- Modify: `app/client-reports/page.tsx`
- Modify: `app/automation/page.tsx`
- Modify: `app/email-health/page.tsx`

**Interfaces:**
- Consumes: Director metrics, Rep performance, Campaign statistics.
- Produces: High-density management dashboards with 48px tables, 5.99:1 orange action buttons, 5.48:1 emerald buttons, no nested tab cards.

- [ ] **Step 1: Remediate `app/director/page.tsx` & `app/team/page.tsx`**
  - Metric KPI cards: Monospace numbers (`tabular-nums`), high contrast delta chips.
  - Flatten tab bars / segmented controls on Director and Team pages.
  - Leaderboard data table rows $\ge 48\text{px}$ with $\ge 24\text{px}$ vertical padding.

- [ ] **Step 2: Remediate `app/opportunities/page.tsx`, `app/campaigns/page.tsx`, `app/client-reports/page.tsx`**
  - Replace any low-contrast text on board tabs and buttons ("Board" tab: near-black text on `#E8611A`; "Create Opportunity": `#047857` with white text).
  - Flatten opportunity pipeline stage containers.
  - Report tables formatted with 48px rows.

- [ ] **Step 3: Remediate `app/automation/page.tsx` & `app/email-health/page.tsx`**
  - "Run Inbox Sync" button: `#0A0A0A` text on `#E8611A` (5.99:1).
  - Section descriptions capped with `.prose-measure`.
  - Deliverability status chips use high-contrast dark green/amber/red tones on light background.

- [ ] **Step 4: Verify type check**
  Run: `npx tsc --noEmit`
  Expected: 0 errors.

---

### Task 4: Admin Control Center & System Settings Remediation

**Files:**
- Modify: `app/admin/page.tsx`
- Modify: `app/admin/users/page.tsx`
- Modify: `app/admin/teams/page.tsx`
- Modify: `app/admin/campaigns/page.tsx`
- Modify: `app/admin/clients/page.tsx`
- Modify: `app/admin/jobs/page.tsx`
- Modify: `app/admin/imports/page.tsx`
- Modify: `app/admin/outbound/page.tsx`
- Modify: `app/admin/worker-health/page.tsx`
- Modify: `app/admin/transfer-work/page.tsx`
- Modify: `app/admin/audit/page.tsx`
- Modify: `app/settings/page.tsx`
- Modify: `app/leadgen/page.tsx`
- Modify: `app/leadgen-manager/page.tsx`

**Interfaces:**
- Consumes: Admin schemas, Audit log models, User management tables.
- Produces: Unified `AdminTable` and `ImpactPanel` surfaces with strict heading hierarchy and 0 long line flags.

- [ ] **Step 1: Remediate Admin Table and Heading Hierarchy**
  - Ensure all admin tabs have exactly one `<h1>` per page.
  - Promoted subsection titles to `<h2>` / `<h3>` without skipping levels.
  - Long description lines wrapped in `.prose-measure` ($\le 68\text{ch}$).

- [ ] **Step 2: Remediate Settings & Leadgen Pages**
  - Settings tabs: Unbordered layout wrappers, 14px body text, 13px meta timestamps.
  - Leadgen batch import table: 48px row heights, monospace counts and file sizes.

- [ ] **Step 3: Verify type check**
  Run: `npx tsc --noEmit`
  Expected: 0 errors.

---

### Task 5: Automated Impeccable Playwright Audit & Full Verification Ladder

**Files:**
- Execute: `scripts/design-audit.mjs`
- Execute: `scripts/e2e-regression.mjs`

- [ ] **Step 1: Execute `scripts/design-audit.mjs` across all 20+ routes**
  Run: `node scripts/design-audit.mjs`
  Expected: 0 flags across `lowContrast`, `tiny`, `longLine`, `gradientText`, `glow`, `tintedShadow`, `darkSurfaceGlow`, `springy`, `headingOrder`, `nestedCards`, `cramped`, `deadTokens`, and 0 `flaggedFonts`.

- [ ] **Step 2: If any flag is reported, apply targeted fix and re-run**
  Iterate until the output table shows:
  ```
  ===== TOTALS =====
  generator-default fonts: none
  lowContrast: 0
  tiny: 0
  longLine: 0
  gradientText: 0
  glow: 0
  tintedShadow: 0
  darkSurfaceGlow: 0
  springy: 0
  headingOrder: 0
  nestedCards: 0
  cramped: 0
  deadTokens: 0
  ```

- [ ] **Step 3: Run TypeScript compiler check**
  Run: `npx tsc --noEmit`
  Expected: 0 errors.

- [ ] **Step 4: Run Vitest test suite**
  Run: `npx vitest run`
  Expected: All tests passing.

- [ ] **Step 5: Run E2E functional regression suite**
  Run: `node scripts/e2e-regression.mjs`
  Expected: All functional checks passing.
