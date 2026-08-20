---
classification: CURRENT_REFERENCE
note: Automation engine design. Still describes the running scheduler.
---

# Automation Engine — Target Architecture

> From spec §2. This is the architectural contract for the upgrade.

## Layered Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CRM DATA                                  │
│  Lead, Campaign, User, EmailAccount, Meeting, Opportunity        │
│  = Source of business truth                                      │
├─────────────────────────────────────────────────────────────────┤
│                AUTOMATION DECISION ENGINE                         │
│  lib/automation/eligibility.ts                                   │
│  lib/automation/scheduling.ts                                    │
│  = Decides what should happen next (ALLOW/BLOCK/DEFER/TERMINATE) │
├─────────────────────────────────────────────────────────────────┤
│              DATABASE SCHEDULE STATE                              │
│  SequenceEnrollment.nextActionAt                                 │
│  Task.dueDate                                                    │
│  JobRun (durable mirror)                                         │
│  = Durable execution truth — survives Redis loss                 │
├─────────────────────────────────────────────────────────────────┤
│                    BULLMQ                                        │
│  Delayed jobs, queues, deduplication                             │
│  = Transport/execution mechanism only                            │
├─────────────────────────────────────────────────────────────────┤
│                    WORKERS                                       │
│  workers/sequence.ts, email.ts, sync.ts, maintenance.ts          │
│  = Perform authorized actions, re-check eligibility at execution │
├─────────────────────────────────────────────────────────────────┤
│            ACTIVITY / AUDIT / REPORTING                          │
│  Activity, AuditLog, OutboundMessage, InboundMessage             │
│  = Explain what happened                                         │
└─────────────────────────────────────────────────────────────────┘
```

## Key Invariants

1. **BullMQ is never the only source of truth.** If Redis loses every delayed job,
   the database must contain enough to determine what should happen next.

2. **Double safety checks.** Eligibility checks at scheduling time. Email worker
   re-checks suppression/mailbox/quota at execution time.

3. **One task at a time.** Sequential cadence creates step N+1 only after step N completes.

4. **CRM state wins.** Immediately before execution, re-evaluate current CRM state.
   A three-day-old schedule is only a plan.

5. **Additive migration.** Keep existing `status` enum. Add `nextActionAt`, `pausedReason`
   alongside. No big-bang SequenceEnrollment rewrite.

## Data Flow

```
Lead enrolled in Sequence
       │
       ▼
SequenceEnrollment created (status=active, nextActionAt=...)
       │
       ▼
Task created for Step 1 (dueDate from calculateNextActionAt)
       │
       ▼
BullMQ delayed job enqueued (delay = dueDate - now)
       │
       ▼
Worker wakes at dueDate
       │
       ▼
evaluateAutomationEligibility()
       │
       ├─ ALLOW → render template → OutboundMessage → EMAIL_SEND → advance
       ├─ BLOCK → log reason, terminate/skip
       ├─ DEFER → update nextActionAt, re-enqueue with new delay
       ├─ TERMINATE → unenroll, log
       └─ MANUAL_REQUIRED → notify SDR, leave task pending
```

## Timezone Resolution Chain

```
1. Lead.timezone        (most specific)
2. User.timezone        (SDR's timezone)
3. Tenant default       (org-level fallback)
4. 'UTC'                (technical fallback only)
```
