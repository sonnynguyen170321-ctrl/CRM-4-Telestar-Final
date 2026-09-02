# ADR-010 — Activity Recap Matching

Status: Patched / accepted for pilot defaults.

## Decision

Activity Recaps are core product workflow and use the shared identity resolver. Pilot supports CSV only. XLSX is deferred.

Match confidence levels:

```txt
auto_match
suggested_match
needs_review
no_match
```

Low confidence rows create ManagerReviewItems.

ActivityRecord is append-only. Re-upload corrections create superseding records instead of overwriting.

## Consequences

- Safer data quality.
- More manager review volume early.
- Requires create-from-recap action to prevent queue overload.
