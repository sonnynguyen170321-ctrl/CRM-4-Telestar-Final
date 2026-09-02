# ADR-012 — Unified Ingestion Framework

Status: Patched / accepted.

## Decision

Use one ingestion framework for company uploads, contact uploads, and activity recap imports.

Core objects:

```txt
ingestion_jobs
ingestion_rows
```

Pilot runtime supports CSV. XLSX later.

Batch policy:

```txt
parse chunks around 500 rows
DB apply batches 100–250 rows
```

`partially_applied` is a recoverable state with explicit user action, not success.

## Consequences

- Prevents duplicate upload systems.
- Enables shared mapping/validation/rollback/audit.
- Requires clear job/row status handling before runtime implementation.
