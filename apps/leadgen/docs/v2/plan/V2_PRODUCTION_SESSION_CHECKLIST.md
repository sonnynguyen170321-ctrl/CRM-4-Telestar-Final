# V2 Production Session Checklist

Status: active governance checklist for future V2 sessions.

Purpose: keep every Scoring -> CRM -> Outreach session tied to the production workflow spine. Use this checklist before coding, during review, and in the session log.

This document is a docs-only guardrail. It does not authorize runtime, schema, API, UI, package, migration, or V1 changes.

## 1. Session Header Checklist

Every future V2 session must fill this header before implementation:

```txt
Session ID:
Phase:
Change kind:
Workflow stage:
Allowed files:
Forbidden files:
Runtime changed? yes/no
Schema changed? yes/no
V1 touched? yes/no
```

Required rule: if the allowed files or change kind do not match the active phase, stop and ask for a scope correction before editing.

## 2. Workflow Linkage Checklist

Every future V2 session must prove how its output connects to the next workflow step:

```txt
Upstream objects consumed:
Objects created/updated:
Downstream consumers:
Idempotency key:
Tenant boundary:
User-visible proof:
Automated linkage proof:
Failure/rollback behavior:
```

Required rule: if a session cannot name downstream consumers and automated linkage proof, it is not ready to code.

## 3. Product Spine Checklist

Before and after each session, confirm the session preserves the relevant links in this spine:

```txt
Product Context -> Upload/Ingestion
Ingestion -> Identity Resolution
Identity Resolution -> LeadAssignment
LeadAssignment -> Intelligence
Intelligence -> Scoring
Scoring -> CRM Workspace
CRM -> Manager Review
Manager Review -> Feedback
Feedback -> ICP Tuning
Activity -> Lead Timeline / SDR Management
Outreach -> Suppression / Activity / Reporting
```

Production rule: no session should create an isolated page, helper, route, handler, or model that is not consumed by the next workflow step.

## 4. Active Session Ledger

Use this ledger to keep the production plan ordered. Update only after human review accepts a completed session.

| Session | Focus | Status |
| --- | --- | --- |
| WF0 | Workflow contracts | Done |
| WF1 | Production session checklist | Done |
| UI0 | Shell contract enforcement | Current |
| UI1 | ContextBar production contract | Pending |
| S1 | ICP rules schema V2 | Pending |
| S2 | Fact token vocabulary lock | Pending |
| S3 | Fact-driven scoring | Pending |
| S4 | Scoring persistence/rescore | Pending |
| S5 | ICP authoring UI | Pending |
| S6 | ICP preview | Pending |
| I1 | Deterministic company brief | Pending |
| I2 | Brief UI | Pending |
| I3 | Enrichment refresh workflow | Pending |
| C1 | Home dashboard | Pending |
| C2 | Leads workspace production | Pending |
| C3 | Export source of truth | Pending |
| C4 | Company workspace | Pending |
| C5 | Contacts workspace | Pending |
| C6 | Workflow transition matrix | Pending |
| R1 | Review queue resolution | Pending |
| R2 | Review-to-rescore bridge | Pending |
| R3 | Feedback capture | Pending |
| A1 | Activity schema plan | Pending |
| O1 | Outreach schema | Pending |
| O2 | Suppression gate | Pending |

## 5. Stop Conditions

A future session must stop if any of these are true:

```txt
It cannot name downstream consumers.
It changes qualification and workflowStatus together.
It writes canonical UNCERTAIN qualification.
It mutates old scoring assessments.
It creates duplicate leads/reviews/scores on rerun.
It touches V1 without explicit approval.
It changes schema/migrations outside an approved schema phase.
It adds outreach send behavior before suppression gate exists.
```

## 6. Next Build Session After WF1

After WF1 is reviewed, continue with:

```txt
UI0 - Shell Contract Enforcement
```

UI0 should only normalize V2 page shell structure. It must not change data fetching, server logic, scoring, ingestion, review behavior, or schema.

UI0 workflow linkage block:

```txt
Workflow stage:
Product shell / CRM navigation foundation

Upstream objects consumed:
AppShell, PageHeader, ContextBar, current V2 pages

Objects created/updated:
Consistent page scaffolds only

Downstream consumers:
ICP editor, lead workspace, manager review, uploads, reports, outreach

Idempotency key:
N/A, UI-only

Tenant boundary:
Preserve existing tenant/context checks and route behavior

User-visible proof:
V2 pages look like one product shell

Automated linkage proof:
Build passes, target pages no longer use isolated top-level shell hacks, no lib/v2 or schema diff
```

## 7. Verification Checklist

For WF1-style docs-only governance sessions, run:

```txt
git diff --name-only
git diff --check
git diff -- app components lib scripts package.json package-lock.json prisma/schema.prisma prisma/migrations
```

Expected result:

```txt
Docs only
Runtime changed? no
Schema/migrations changed? no
V1 touched? no
Commit created? no, unless explicitly requested
```
