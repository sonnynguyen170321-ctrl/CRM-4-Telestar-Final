# ADR-015 — Local-First Migration and Rollback

Status: Patched / accepted for future schema phases.

## Decision

V2 is local-first but migration-safe. Every V2 migration must use a V2-specific name:

```txt
YYYYMMDDHHMM_v2_<short_description>
```

V2 must not dynamically reference V1 runtime tables. V1 data may be imported only as snapshot/legacy source.

Stress seed is separate from pilot seed.

Rollback rehearsal is required before staging/prod schema changes.

## Consequences

- Prevents V1/V2 migration confusion.
- Makes local → staging/prod transition safer.
- Adds discipline before schema-heavy phases.
