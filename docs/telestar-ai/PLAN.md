# 🧠 TELESTAR AI — MASTER OPERATING SYSTEM PLAN

This roadmap operationalizes the **102-Section Master Operating System Directive** for Telestar AI into concrete, testable phases.

---

## 📌 Phase Overview & Roadmap

| Phase | Description | Status |
| :--- | :--- | :---: |
| **Phase 0 — System Audit & Foundation Architecture** | Inventory existing AI endpoints, build Constitution, Cognitive Stack, Situation Engine, Intent Taxonomy, Temporal Reasoning, and Context Builder | 🟡 **IN PROGRESS** |
| **Phase 1 — High-Value Role Intelligence (P1)** | "What Needs Attention?", SDR Next Best Action, Floor Pulse, Director Executive Brief, Automation Root-Cause Diagnostic, Email Intelligence | ⚪ Pending |
| **Phase 2 — Operational & Manager Intelligence (P2)** | Team Lead Coaching Engine, Campaign Diagnosis & Attribution, Workload/Capacity Tracker, Safe Work-Transfer Planner, Onboarding/Role-Change Preview | ⚪ Pending |
| **Phase 3 — Autonomy, Tool Contracts & Safety Gates (P3)** | Autonomy Levels 0–4, Action Risk Matrix, Idempotent Write Tool Registry, Reversible Action Preview, Partial Failure Reporting | ⚪ Pending |
| **Phase 4 — Golden Dataset & Multi-Lingual Evaluation Suite** | 25+ Golden Scenario Families (EN/VI), Factuality & Injection Evals, Latency/Cost Telemetry, Formal Section 101 Certification | ⚪ Pending |

---

## 📋 Task Checklist

### Phase 0: System Audit & Core Cognitive Foundation
- [ ] **P0.1 System Capability Audit:** Scan all AI routes, providers, tools, and UI surfaces; write `docs/telestar-ai/CAPABILITY_INVENTORY.md`.
- [ ] **P0.2 Permanent Constitution:** Implement `lib/ai/behavior/telestar-ai-constitution.ts` with immutable priority order (Security > Auth > Privacy > Truth > Rules > Safety > Style).
- [ ] **P0.3 Situation Engine & Page-Aware Resolver:** Build `lib/ai/engine/situation-engine.ts` resolving actor, surface, entity, and live context.
- [ ] **P0.4 Intent & Temporal Engine:** Implement `lib/ai/engine/intent-engine.ts` with 15 typed intents and deterministic time bucketing.
- [ ] **P0.5 Context Builder:** Implement `lib/ai/engine/context-builder.ts` with tiered context (P0 Required facts, P1 Recent supporting, P2 Historical).
- [ ] **P0.6 Business Rule & Consistency Checker:** Implement deterministic rules in `lib/ai/engine/business-rules.ts`.

### Phase 1: High-Value Role Intelligence (P1)
- [ ] **P1.1 "What Needs Attention?" Engine:** Unified intelligence primitive tailored by role (SDR, Team Lead, Floor Manager, Director, Leadgen, Admin).
- [ ] **P1.2 SDR Next Best Action:** Contextual action planner (Reply, Call, Follow-up, Wait) with deadlines and source evidence.
- [ ] **P1.3 Floor Pulse & Director Executive Brief:** High-signal operational synthesis and noise compression.
- [ ] **P1.4 Root-Cause Investigation Engine:** Multi-step deterministic diagnosis (Mailbox, Sequence, Worker, Provider) with Confirmed/Likely/Unknown confidence.
- [ ] **P1.5 Email Intelligence & Reply Classifier:** Intent-aware reply handling and CRM update suggestions.

### Phase 2: Operational & Manager Intelligence (P2)
- [ ] **P2.1 Team Lead Coaching Engine:** Objective, behavior-based coaching signals (speed, overdue rates, hygiene).
- [ ] **P2.2 Campaign Diagnosis Engine:** Hypotheses generator (targeting, copy, deliverability, follow-up, sample size).
- [ ] **P2.3 Workload, Capacity & Handoff Intelligence:** Balance indicators and safe work-transfer planning.
- [ ] **P2.4 Onboarding & Role-Change Previews:** Readiness checklists and impact calculators.

### Phase 3: Autonomy, Tool Contracts & Safety Gates (P3)
- [ ] **P3.1 Autonomy Matrix & Risk Model:** Levels 0–4 with preview, confirmation, and audit logs.
- [ ] **P3.2 Tool Registry:** Typed Read/Write tool separation with idempotency keys and error handling.
- [ ] **P3.3 Anti-Injection & Secret Exclusion Guards:** Strict data quoting and secret sanitizer.

### Phase 4: Golden Dataset & Certification
- [ ] **P4.1 Golden Scenario Suite:** English and Vietnamese evaluation test cases.
- [ ] **P4.2 Behavior & Critical Failure Evals:** Vitest test suite enforcing factuality, groundedness, and no fabrication.
- [ ] **P4.3 Master Foundation Certification:** Output Section 101 certification audit report.
