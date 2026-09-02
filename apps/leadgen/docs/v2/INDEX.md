# TeleStar SDR OS V2 Documentation Index

This file defines the canonical documentation hierarchy for V2 work. Use it before selecting any phase prompt.

## Baseline Architecture

- `docs/V2_FINAL_EXECUTION_PLAN_V8_ENTERPRISE.md`
  - Status: architecture baseline.
  - The 12-layer enterprise invariants still hold.
  - STATUS: stale pointer, superseded for sequencing by the Action Map V1.1.1. Its "immediate next phase = CORE0" pointer is historical because CORE0, CORE1, JOB0, INGEST-HV0, SCORE-HV0, CRM read/Auth0, and Manager Review schema/runtime work have already landed.

## Active Execution

- `docs/v2/plan/V2_SCORING_CRM_ACTION_MAP_V1_1_1.md`
  - Status: active execution map for Phase 1 and Phase 2.
- `docs/v2/plan/V2_WORKFLOW_LINKAGE_CONTRACTS.md`
  - Status: active workflow-governance contract for future V2 implementation sessions.
  - Every implementation prompt must include its `WORKFLOW LINKAGE` block.
- `docs/v2/plan/V2_PRODUCTION_SESSION_CHECKLIST.md`
  - Status: active production session checklist and workflow ledger.
  - Every future V2 session should use it to confirm upstream/downstream linkage before implementation.
- `docs/v2/plan/V2_PHASE1_EXECUTION_LOGIC_SPEC.md`
- `docs/v2/plan/V2_PHASE1_CODEX_PROMPT_PACK.md`
- `docs/v2/plan/V2_PHASE2_EXECUTION_LOGIC_AND_PROMPTS.md`
- `docs/v2/plan/V2_PHASE3_EXECUTION_LOGIC_AND_PROMPTS.md`
- `docs/v2/plan/V2_PHASE3_OUTREACH_PLAN.md`
- `docs/v2/plan/V2_UIUX_DESIGN_SPEC_FULL.md`
- `docs/v2/plan/V2_MASTER_MAP_AND_SHIP_READINESS.md`

## Locked Decisions

- Agent rules: see `AGENTS.md` -> `V2 INVARIANTS (read before every V2 session)`.
- V8 Enterprise is the architecture baseline.
- Action Map V1.1.1 is the active Phase 1/2 execution map.
- Workflow Linkage Contracts are mandatory for future implementation prompts.
- Phase 1 ship definition includes export: full, qualified-only, and needs-contact.
- `NOT_SCORED` is read-model/UI-derived only and must not be added as a DB enum.
- `UNCERTAIN` is deprecated for V2 canonical output.
- Outreach remains parked until Phase 1 and Phase 2 are accepted.

## Historical Reference

Do not execute from historical documents unless a later approved plan explicitly revives them.

- `docs/V2_FINAL_EXECUTION_PLAN_V7.md`
- `docs/v2/reference/v7/V2_FINAL_EXECUTION_PLAN_V7.md`
- `docs/v2/codex/V2_PROMPT_TEMPLATES.md`
- `docs/v2/architecture/V2_PHASE_ROADMAP.md`
- `docs/v2/architecture/V2_PILOT_SCOPE_AND_SUCCESS_METRICS.md`
- `docs/v2/reference/v2-1-scoring-research/**`
- `UI_UX_FLOW.md`
- `APP_SKELETON.md`

## ADR Notes

- `docs/v2/adr/ADR-004-geography-rules-per-icp-version.md` is canonical for ADR-004.
- `docs/v2/adr/ADR-004-geography-per-icp.md` is retained as historical summary context only.
- `ADR-005`, `ADR-006`, and `ADR-014` currently have multiple files by number in `git ls-files`, but per P0 guidance they are treated as distinct decisions and are not marked superseded in this pass. They remain open risks for human review if further consolidation is desired.

## Next Step

After this P0 docs canonicalization gate is reviewed and accepted, run `P1.S0A` from `docs/v2/plan/V2_PHASE1_CODEX_PROMPT_PACK.md`. Do not start implementation from stale roadmap text.
