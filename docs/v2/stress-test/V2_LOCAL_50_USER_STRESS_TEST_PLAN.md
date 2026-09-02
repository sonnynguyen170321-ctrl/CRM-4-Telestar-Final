# Lead Gen Intelligence — Local 50-User Stress Test Plan

**Status:** Draft for review  
**Purpose:** prove local architecture and query patterns before cloud/team rollout.

## 0. Executive Decision

A local PC can be used for development and stress testing toward 50-user readiness. It should not be used as production hosting for 50 real users.

## 1. Seed profile

```txt
Users: 50
Accounts: 10
Projects: 20
Offers: 30
ICP Profiles: 30
ICP Versions: 50
Companies: 50,000
Contacts: 50,000
LeadAssignments: 50,000–100,000
ActivityRecords: 10,000–50,000
FeedbackExamples: 2,000
```

## 2. Workload tests

```txt
company upload: 5k rows
activity recap upload: 2k rows
identity resolver batch: 5k rows
company list query: filters + pagination
company drawer query: full detail
review save: 100 sequential saves
feedback save: 500 examples
manual send dry-run: 200 renders
export: 5k rows
```

## 3. Performance targets

Draft targets:

```txt
company list first page < 2s local
company drawer < 1s local after DB warm
5k upload parse/normalize reasonable and non-blocking
identity resolution does not lock UI indefinitely
export completes without memory spike
```

## 4. Failure conditions

Stop and fix if:

```txt
queries require loading all rows into memory
identity resolver is O(n^2) across full DB
drawer performs unbounded history queries
export times out on 5k rows
activity recap creates unmanageable review queue with no grouping
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
