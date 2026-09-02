# Lead Gen Intelligence - V2 Phase Roadmap

**Status:** V8 Enterprise canonical roadmap
**Purpose:** prevent phase drift and define the safe build order after V2.ICP1R.

## 0. Operating Rule

One phase = one Codex session = one human review gate.

No phase may continue into the next phase automatically.

`docs/V2_FINAL_EXECUTION_PLAN_V8_ENTERPRISE.md` is the active source of truth for execution planning. `docs/V2_FINAL_EXECUTION_PLAN_V7.md` and `docs/v2/reference/v7/V2_FINAL_EXECUTION_PLAN_V7.md` are historical reference only.

## 1. Current Checkpoint

According to `docs/v2/codex/SESSION_LOG.md`, these phases are complete or treated as complete:

```txt
V2.5
V2.6
V2.7
V2.8
V2.INGEST
V2.A0
V2.A0.1
V2.A0.2
V2.A1
V2.ICP0R
V2.ICP-BENCH0R
V2.ICP1R
```

V2.ICP1R is an isolated pure TypeScript ICP rule schema and evaluation harness. It does not unlock schema, runtime scoring, ingestion runtime, API, UI, outreach, or manager review implementation by itself.

## 2. Strategic Shift

V8 Enterprise shifts the project from a small internal pilot roadmap to a scalable Enterprise SaaS & Outreach OS foundation.

The immediate priority is enterprise backend invariants before UI/runtime work:

```txt
V2.CORE0 -> V2.CORE1 -> V2.JOB0 -> V2.INGEST-HV0 -> V2.SCORE-HV0 -> V2.CRM0
```

## 3. Current Holds

The following phases are paused until enterprise backend invariants are locked and the relevant V8 phase prompt explicitly allows them:

```txt
V2.A2 Manager Review
V2.9 UI shell
V2.10 Company/Lead review UI
runtime scoring
runtime ingestion
API routes
UI routes/components
outreach/email/sequence runtime
schema/migrations outside approved schema phases
```

V2.A2 is not deleted. Its timing changes: manager review belongs under the later CRM/review workspace path after CORE1, JOB0, INGEST-HV0, and SCORE-HV0 have made the source objects, job boundaries, tenant scoping, idempotency, and review contracts safe.

## 4. V8 Forward Sequence

| Phase | Goal | Runtime code? | Schema? | Exit gate |
| --- | --- | ---: | ---: | --- |
| V2.CORE0 | Enterprise backend invariants ADRs | No | No | ADRs reviewed and approved |
| V2.CORE1-PLAN | Current Prisma audit and exact schema-hardening plan | No | No | schema diff plan approved |
| V2.CORE1 | Schema hardening for tenant scope, uniqueness, soft delete, workflow state, snapshots, pointers | No | Yes | migration reviewed, Prisma checks pass |
| V2.JOB0 | Async job foundation | Yes | Maybe | jobs are tenant-safe and idempotent |
| V2.INGEST-HV0 | High-volume ingestion runtime | Yes | Maybe | ingestion is async, resumable, and review-safe |
| V2.SCORE-HV0 | Bulk ICP scoring runtime using ICP1R | Yes | Maybe | immutable scoring snapshots and latest pointers are safe |
| V2.CRM0 | Lead workspace and manager review UI foundation | Yes | Maybe | UI consumes hardened contracts; no sync-heavy workflows |

## 5. V2.CORE0 Boundary

V2.CORE0 is docs-only. It should create/reconcile ADRs for enterprise invariants before schema work.

Expected ADR outputs:

```txt
ADR-019-lead-assignment-idempotency-and-uniqueness.md
ADR-020-qualification-vs-workflow-status-separation.md
ADR-021-async-job-processing-foundation.md
ADR-022-soft-delete-and-data-retention.md
ADR-023-rbac-and-tenant-isolation.md
ADR-024-webhook-provider-idempotency.md
ADR-025-synchronous-suppression-gate.md
ADR-026-optimistic-concurrency-control.md
```

It must not implement:

- schema changes
- migrations
- runtime jobs
- ingestion runtime
- scoring runtime
- API routes
- UI components
- outreach/email/sequence behavior
- V1 mutation or dynamic V1 joins

## 6. V2.CORE1 Boundary

V2.CORE1 may become schema work only after:

1. V2.CORE0 ADRs are reviewed.
2. V2.CORE1-PLAN audits the current Prisma schema.
3. Human review approves the exact schema diff and migration scope.

V2.CORE1 must not implement API, UI, jobs, ingestion runtime, scoring runtime, outreach, or sequence execution.

## 7. Human Review Gate

Before implementation, confirm:

1. The decision matches V8 Enterprise.
2. The active phase prompt has narrow allowed files.
3. The phase does not mutate V1 or dynamically join live V1 runtime tables.
4. Schema/migration work is allowed only in an explicitly approved schema phase.
5. Runtime/API/UI work is allowed only in an explicitly approved runtime/API/UI phase.
