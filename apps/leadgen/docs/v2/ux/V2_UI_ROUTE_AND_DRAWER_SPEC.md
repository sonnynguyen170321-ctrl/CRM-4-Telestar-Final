# Lead Gen Intelligence — UI Route and Drawer Spec

**Status:** Draft for review  
**Purpose:** map the polished mocks to a pilot-safe route surface.

## 0. Executive Decision

Use the mock gallery as product direction, but do not build all screens at once.

## 1. Pilot visible routes

```txt
/v2/home
/v2/accounts
/v2/projects
/v2/icp-library
/v2/companies
/v2/contacts-leads
/v2/activity-recaps
/v2/review-queue
/v2/settings-admin
```

## 2. Deferred routes

```txt
/v2/pipeline
/v2/outreach
/v2/reports
/v2/ai-insights
advanced theme manager
```

## 3. Drawer pattern

Primary review UI uses a large right-side drawer or split panel.

Company/Lead drawer tabs:

```txt
Overview
Contacts
Activities
AI Insight
Feedback
Data Log
Raw Data (debug/collapsed)
```

Pilot may collapse Feedback/Data Log into later tabs if route surface is too large.

## 4. Decision-first layout

Review drawer top area must show:

```txt
company/contact identity
project
ICP
rule result
AI insight status
SDR final review fields
save feedback/action button
```

Evidence and raw data are below, not first.

## 5. Status color semantics

ThemeProfile cannot change status meanings:

```txt
qualified/pass = green
uncertain/review = amber/orange
unqualified/fail = red
AI = purple/blue
manager review = red/orange
meeting booked = green/blue
```


---

## Codex Guardrails
- Do not modify V1 routes, V1 API handlers, V1 scoring, V1 export, V1 AI, or V1 feedback logic.
- Do not modify `prisma/schema.prisma` from this spec alone.
- Do not create migrations until the relevant schema phase is approved.
- Do not implement runtime code until the phase prompt explicitly allows it.
- Preserve append-only history and source-of-truth boundaries.

## Human Review Gate
Before implementation, confirm:
1. The decision matches the V7 master plan.
2. The spec does not contradict another spec or ADR.
3. Open questions are resolved or explicitly deferred.
4. Codex allowed files are narrow enough for the next phase.
