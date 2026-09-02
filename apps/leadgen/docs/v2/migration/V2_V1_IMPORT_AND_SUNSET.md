# Lead Gen Intelligence â€” V1 Import and Sunset Spec

**Status:** Draft for review
**Purpose:** define how V1 data is reused or retired without corrupting V2.

## 0. Executive Decision

V2 may start clean for companies, but V1 feedback examples are valuable scoring memory.

## 1. Import options

| Data | Recommendation | Reason |
|---|---|---|
| V1 CompanyRecord | optional/manual import | identity model changed |
| V1 ContactRecord | optional/manual import | contact identifiers changed |
| V1 FeedbackExample | import as legacy_feedback | useful tuning evidence |
| V1 CompanyAiAssessment | do not import by default | old AI context may be stale |
| V1 UploadJob history | archive/reference only | V2 ingestion model differs |

## 2. Legacy feedback policy

Imported feedback must be labeled:

```txt
source = v1_legacy
use_for_tuning = false by default
requires_manager_approval = true
```

Do not silently mix V1 feedback into V2 active tuning.

## 3. Parallel run

V1 remains available until:

```txt
V2 pilot workflow is stable
core lead lists can be reviewed/exported
activity recaps produce trusted manager queue
Stop & Ship metrics are measured
```

## 4. Sunset trigger

Sunset V1 only after:

```txt
team agrees V2 replaces V1 daily workflow
critical V1 data is imported/exported/archive-safe
rollback option exists
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
