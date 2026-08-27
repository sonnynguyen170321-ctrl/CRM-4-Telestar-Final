# UI/UX Impeccable Design Specification: World-Class BPO Operating System

**Date:** 2026-08-27  
**Status:** Approved for Implementation  
**Domain:** `frontend-role-ux` (R1)  

---

## 1. Executive Summary & Design Philosophy

This specification defines the complete transformation of Telestar CRM into an ultra-high-performance, bespoke BPO operating system. It eliminates every trace of generic "AI-generated" UI artifacts (aurora glows, gradient text, spring physics, nested cards, arbitrary sizing, low-contrast text) and replaces them with an authoritative, tactile, industrial-grade software aesthetic engineered specifically for high-velocity SDRs and Operations Directors.

### Design Principles
1. **Industrial Precision & Tactile Utility**: Crisp 1px borders, calibrated neutral gray scale, optical typography hierarchies, and tabular monospace alignment. Every element has purpose; zero decorative clutter.
2. **Speed & Ergonomics**: Sub-50ms perceived interaction latency, keyboard-navigable queues, sticky context bars, and inline row actions.
3. **Role-Tailored Density**: High-density cockpits for Directors and Floor Managers; distraction-free, linear focus queues for SDRs and Leadgens.
4. **Absolute WCAG AAA / AA Contrast Compliance**: Zero text or control fails readability criteria under any lighting condition.

---

## 2. Quantitative Metric Targets (The Zero-Flag Gate)

All 20+ routes in `scripts/design-audit.mjs` must achieve **0 flags**:
1. `lowContrast`: Standard text $\ge 4.5:1$, Large text $\ge 3:1$. Primary text at 15.3:1 (`#111827`).
2. `tiny`: Absolute text floor $\ge 12\text{px}$.
3. `longLine`: Prose measure capped $\le 68\text{ch}$ via `.prose-measure`.
4. `gradientText`: 0 instances. Solid brand, neutral, or semantic fills only.
5. `glow`: 0 glow halos or `drop-shadow(0 0 ...)`.
6. `tintedShadow`: 0 colored shadow blurs. Strictly neutral alpha shadows (`rgba(0,0,0,0.04)` to `rgba(0,0,0,0.10)`).
7. `darkSurfaceGlow`: 0 dark surface glow halos.
8. `springy`: 0 bouncy cubic-beziers or playful physics. Linear/ease-out transitions $\le 150\text{ms}$.
9. `headingOrder`: Exactly one `<h1>` per route; strict `<h2>` $\rightarrow$ `<h3>` descending hierarchy.
10. `nestedCards`: 0 cards inside card containers. Outer columns/panels are layout-only; inner leaf items are cards.
11. `cramped`: Table row height $\ge 48\text{px}$, vertical cell padding $\ge 24\text{px}$ total.
12. `deadTokens`: 0 unmapped utility classes.
13. `fonts`: 100% IBM Plex family (`IBM Plex Sans`, `IBM Plex Sans Condensed`, `IBM Plex Mono`). 0% Inter, Geist, Poppins, Montserrat.

---

## 3. Visual System & Layering Architecture

### 3.1 Spatial Layering (Z-Index & Surface Hierarchy)
- **Layer 0 (Canvas Base):** `#F8F9FA` background with subtle `#E5E7EB` dividers.
- **Layer 1 (Cards & Data Tables):** Solid `#FFFFFF`, `border border-neutral-200/90`, `shadow-[0_1px_2px_rgba(0,0,0,0.04)]`, `rounded-md`.
- **Layer 2 (Floating Controls & Popovers):** Solid `#FFFFFF`, `border border-neutral-300`, `shadow-[0_4px_16px_-2px_rgba(0,0,0,0.08)]`, `rounded-lg`.
- **Layer 3 (Slide-Over Sheets & Modals):** Backdrop `bg-neutral-900/40 backdrop-blur-[2px]`, sheet surface `#FFFFFF`, `border-l border-neutral-200`, `shadow-2xl`.

### 3.2 Typography System & Optical Scaling
- **Font Stacks:**
  - **Body / Headings:** `var(--font-ibm-plex-sans), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
  - **Condensed Badges / Column Headers:** `var(--font-ibm-plex-sans-condensed), sans-serif`
  - **Data / Metrics / Timestamps / IDs:** `var(--font-ibm-plex-mono), monospace` with `font-variant-numeric: tabular-nums`
- **Scale Hierarchy:**
  - `<h1>` Page Hero: 28px (`leading-tight font-semibold tracking-tight text-neutral-950`)
  - `<h2>` Section / Panel: 20px (`leading-snug font-semibold tracking-tight text-neutral-900`)
  - `<h3>` Subsection / Group: 16px (`leading-normal font-medium text-neutral-900`)
  - Body: 14px (`leading-relaxed font-normal text-neutral-800`)
  - Meta / Caption: 13px (`leading-normal font-normal text-neutral-600`)
  - Micro / Pill Badges: 12px (`leading-none font-medium tracking-wide uppercase text-neutral-700`) — **Absolute Floor**

### 3.3 Semantic Color & High-Contrast Tokens
- **Brand Identity:**
  - **Brand Orange (`#E8611A`):** Action buttons strictly pair `#E8611A` background with `#0A0A0A` near-black bold labels (5.99:1 contrast).
  - **Brand Red (`#D42B1E`):** Solid wordmark, urgent alerts, destructive highlights (white on red is 4.90:1).
- **Status & State Badges:**
  - **Cold / Uncontacted:** `bg-neutral-100 text-neutral-800 border border-neutral-200` + neutral dot.
  - **Hot / Interested:** `bg-amber-50 text-amber-900 border border-amber-200` + amber dot.
  - **Qualified / Won:** `bg-emerald-50 text-emerald-900 border border-emerald-300` + emerald dot.
  - **Unqualified / Lost:** `bg-rose-50 text-rose-900 border border-rose-200` + rose dot.
  - **In Sequence / Scheduled:** `bg-sky-50 text-sky-900 border border-sky-200` + blue dot.

---

## 4. Role-Specific Experience & Workflow Polish

### 4.1 SDR & Leadgen Focus Mode
- **Task Hub (`/` & `/tasks`):**
  - Instant triage tabs: Today / Yesterday / Overdue with numeric badge counts.
  - Task item rows with single-click action triggers:
    - Phone: "Complete" $\rightarrow$ opens Call Outcome Modal with duration & sentiment logging.
    - LinkedIn / WhatsApp: "Log & Complete" $\rightarrow$ opens quick-paste activity logger.
    - Email: "Compose" $\rightarrow$ opens sequence template with variable preview.
- **Leads Kanban & List (`/leads`):**
  - Outer kanban columns are unbordered layout lanes (`bg-neutral-100/60 rounded-lg p-3`).
  - Lead cards carry clean 1px border, 13px company name, 12px status pill, and tag dots.
  - Clicking any lead opens the right-hand `LeadDetailPanel` slide-over with activity timeline and sequence enrollment controls.

### 4.2 Director & Floor Manager Cockpits
- **Director Executive Dashboard (`/director`):**
  - Top KPI strip: Monospace revenue, conversion rate, SDR quota attainment with $\pm\%$ deltas.
  - Campaign pacing waterfall table with 48px rows, sticky headers, and sortable columns.
  - Role-scoped filter dropdowns (by Pod, by Campaign, by SDR).
- **Team & Rep Performance (`/team`):**
  - Leaderboard matrix with avatar initials, calls logged, meetings booked, and reply velocity.
  - Coaching note modal with timestamped activity audit trail.

### 4.3 Outbound Engine & Admin Control Center
- **Campaigns & Sequences (`/campaigns`, `/sequences`, `/templates`):**
  - Step-by-step visual sequence builder with clean vertical line connectors.
  - Email health deliverability monitor (`/email-health`) with SPF/DKIM/DMARC status indicators.
- **Admin Control Center (`/admin/*`):**
  - Single `<h1>` per admin section, unified `AdminTable` with dense 48px rows and pagination controls.
  - Monospace UUIDs, API keys, and audit log timestamps for rapid scanning.

---

## 5. Micro-Interactions, Feedback & Motion Rules

- **Hover States:** Smooth color transitions (`transition-colors duration-100 ease-out`).
- **Active Click:** Subtle 1% physical depression (`active:scale-[0.99]`).
- **Focus Rings:** High-contrast outline ring (`focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:outline-none`).
- **Loading & State Transitions:**
  - Geometric skeleton loaders matching exact table/card layouts (zero layout shifts).
  - Toast notifications: Fixed bottom-right, neutral dark surface `#18181B`, white text, 4-second auto-dismiss with manual close icon.

---

## 6. Execution Roadmap & Verification Ladder

### Phase 1: Global Foundation & Token Armor
- Review and refine `app/globals.css` to guarantee typography, contrast floors, table row sizing, and neutral shadow tokens across the entire DOM tree.
- Purge any remaining dead utility tokens across shared components.

### Phase 2: Component & Route Sweeps
1. **SDR Core:** `/leads`, `components/LeadDetailPanel.tsx`, `/inbox`, `/`, `/sequences`, `/templates`, `/tasks`.
2. **Management Core:** `/director`, `/team`, `/campaigns`, `/opportunities`, `/client-reports`, `/automation`, `/email-health`.
3. **Admin Suite:** `/admin/*`, `/settings`, `/leadgen`, `/leadgen-manager`.

### Phase 3: Comprehensive Automated Quality Gate
```bash
# 1. Full 20+ route Playwright Impeccable Design Audit
node scripts/design-audit.mjs

# 2. Strict TypeScript Verification
npx tsc --noEmit

# 3. Unit & Component Integration Suite
npx vitest run

# 4. End-to-End Business Flow Suite
node scripts/e2e-regression.mjs
```

**Completion Criteria:**
- 0 flags on `scripts/design-audit.mjs` across all 12 categories.
- 0 font flags (100% IBM Plex family).
- 0 TypeScript errors.
- 100% pass on Vitest and Playwright test suites.
