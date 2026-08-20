# Telestar Commercial Intelligence Engine — Implementation Plan

## Overview
Transform temporary campaign workflows into a permanent Telestar Lead, Contact, Account, Relationship, and Commercial Intelligence Asset.

---

## Phase 1 — Foundation Data Layer & Calculation Engine
- **Task P1.1**: Define Enums and Models in `prisma/schema.prisma` (`ContactIntelligence`, `ContactEvidence`, relations on `Contact`).
- **Task P1.2**: Generate Migration and Prisma Client.
- **Task P1.3**: Build Central Service `lib/contact-intelligence/` (`service.ts`, `lifecycle.ts`, `quality.ts`, `engagement.ts`, `relationship.ts`, `freshness.ts`, `reuse.ts`, `evidence.ts`, `explainability.ts`).
- **Task P1.4**: Author idempotent backfill script `scripts/backfill-contact-intelligence.ts`.
- **Task P1.5**: Test foundation and calculation correctness (`tests/contact-intelligence.test.ts`).

---

## Phase 2 — Existing Workflow Event Integration
- **Task P2.1**: Hook Leadgen QA qualification -> emit `identity_verified` / `employment_verified` evidence.
- **Task P2.2**: Hook Activity logging (calls, emails, linkedin, whatsapp) -> emit interaction evidence.
- **Task P2.3**: Hook Meeting outcomes -> emit `meeting_completed`, `meeting_no_show`, `relationship_strengthened` evidence.
- **Task P2.4**: Hook Opportunity transitions (accepted, won, lost, nurture) -> emit commercial evidence and manage `client_locked` state.
- **Task P2.5**: Hook Suppression & Archive -> emit `suppressed` / `dnc` / `archived` evidence.

---

## Phase 3 — Contact & Leadgen UI + Database Health
- **Task P3.1**: Contact Intelligence Badge, Score breakdown, and Explainability modal in Contact/Lead UI.
- **Task P3.2**: Internal Lead Database filtered views (Proven, Promising, Untested, Relationships, Needs Refresh, Reusable).
- **Task P3.3**: Leadgen Manager Asset Analytics & Database Health Metric calculations.

---

## Phase 4 — Internal Campaign Matching & Reuse Engine
- **Task P4.1**: Enhance `CampaignLeadRequirement` to query internal Contact asset inventory first.
- **Task P4.2**: Implement 10-step Reuse & Safety Eligibility Engine (`lib/contact-intelligence/reuse.ts`).
- **Task P4.3**: Implement 1-click Contact -> Campaign Lead Assignment workflow.

---

## Phase 5 — Relationship Retention & Meeting Intelligence
- **Task P5.1**: Post-meeting structured intelligence capture modal.
- **Task P5.2**: Relationship owner protection & assignment collision warnings.
- **Task P5.3**: Sequence enrollment relationship-aware gating rules.

---

## Phase 6 — AI Signal Extraction & Contact Memory
- **Task P6.1**: Structured note/reply signal extraction (topics, pain points, vendors, timing).
- **Task P6.2**: Tiered AI Contact Memory summarizer (Immediate, Relationship, Commercial, Account).
- **Task P6.3**: Master E2E Certification & Regression suite.
