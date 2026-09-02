# V2 Error and Degraded States UX Spec

Status: **v0.2 patched**

## 1. Purpose

Enterprise-style tools must remain trustworthy when things fail. V2 UI must define degraded states before UI implementation so agents do not invent happy-path-only screens.

## 2. UX pattern

Every degraded state should show:

```txt
what happened
what data was saved
what user can do next
whether retry is safe
whether manager review is needed
```

## 3. Retry safety table

| Operation | Retry safety | Notes |
|---|---|---|
| Parse/normalize CSV | Safe | deterministic using ingestion_rows |
| Identity match | Safe | creates suggestions/review; no mutation until apply |
| Apply ingestion rows | Partial safe | retry failed rows only; do not reapply successful rows |
| Local scoring | Safe | creates new immutable snapshot if rerun |
| AI insight | Manual only | quota/cost; no auto rerun |
| Email dry-run | Safe | no EmailSend created |
| Real email send | Not blindly safe | avoid duplicate sends |

## 4. Required states

### Upload failed

Show:

- file name,
- reason,
- whether any rows were saved,
- retry upload action.

### Mapping failed

Show missing required fields, detected headers, and allow remapping.

### Too many invalid rows

If invalid rows exceed threshold, block apply and allow error export.

### Identity no match

Show create-from-row / link existing / dismiss options.

### Identity multiple match

Show candidate comparison and force manager decision.

### AI quota reached / provider failed

Show local score remains available. AI is optional and can be retried manually later.

### Score timeout

Show job state and allow safe local rerun. Existing old assessment remains visible if any.

### Export failed

Show whether export had no data, permission issue, server issue, or filter mismatch.

### Permission denied

Show required role/scope and link to request access if implemented later.

### Stale assessment

HardRule stale:

- badge: `Assessment outdated`,
- action: `Re-run local assessment`,
- do not mutate old snapshot.

AI stale:

- badge: `AI Insight outdated`,
- action: `Generate fresh AI Insight`,
- no auto-rerun.

### Recap import session abandoned mid-flow

If user uploads/maps but closes tab:

- ingestion_job remains in `mapped`, `validated`, or `abandoned` depending on last state,
- user can resume mapping/apply if safe,
- user can mark abandoned,
- abandoned jobs do not apply rows automatically,
- stale mapped jobs can be cleaned up later with admin action.

## 5. Partially applied ingestion UX

Show:

- applied row count,
- failed row count,
- skipped duplicate count,
- retry failed rows,
- rollback applied rows,
- export errors.

Do not show partially applied as success.

## 6. Manager review overload UX

If review queue is large:

- show reason-code grouping,
- allow low-risk bulk dismiss only,
- no bulk accept/update in pilot,
- surface top causes so manager can fix mapping/source sheet.

## 7. Codex guardrails

Codex/Antigravity must not:

- create happy-path-only import screens,
- hide failed rows,
- auto-rerun AI,
- make real email send retry idempotent without send-id safeguards,
- bulk mutate lead status from recap rows.
