# V2 Local-First Migration Strategy

Status: **v0.2 patched**

## 1. Purpose

V2 is built local-first but must remain portable to Supabase/AWS/RDS/VPS later. Local-first does not mean casual schema changes. Migration naming, rollback rehearsal, and stress data separation are mandatory.

## 2. Environments

```txt
local_dev: developer machine, small data
local_stress: developer machine, stress seed
staging: cloud/VPS test
production: future shared team environment
```

## 3. Pilot seed vs stress seed

Do not confuse pilot seed with stress seed.

### Pilot target

```txt
10–15 users
5k–20k companies
5k–20k contacts
10 accounts
10 projects
20 ICPs
```

### Stress target

```txt
50 simulated users
20k–50k companies
20k–50k contacts
optional 100k LeadAssignments
large ingestion jobs
activity recap imports
```

Codex must label stress fixtures as stress-only.

## 4. Migration naming convention

All V2 migrations must use explicit V2 names.

```txt
YYYYMMDDHHMM_v2_<short_description>
```

Examples:

```txt
202606071530_v2_add_enterprise_foundation.sql
202606081000_v2_add_lead_assignment.sql
202606091330_v2_add_ingestion_jobs.sql
```

Forbidden:

```txt
migration.sql
init.sql
add_tables.sql
20260607_update.sql
```

## 5. V1 safety

V2 migrations must not:

- drop V1 tables,
- rename V1 columns,
- mutate V1 data,
- change V1 indexes unless explicitly approved,
- alter V1 runtime behavior.

V2 tables should use clear V2 naming/prefixing or separate logical grouping in schema comments/specs.

## 6. Rollback rehearsal

Before staging/prod schema work:

1. Take DB backup.
2. Apply migration on local/stress database.
3. Seed representative data.
4. Run smoke queries.
5. Rehearse rollback or restore path.
6. Document time-to-restore.

## 7. Data migration from V1

V2 must not dynamically join live V1 runtime tables.

Allowed:

- one-time import,
- manual import,
- legacy_feedback snapshot,
- source label `v1_legacy`,
- manager approval before legacy feedback affects V2 tuning.

## 8. Local 50-user readiness

Before V2.7+ identity/bulk ingestion implementation is considered stable, run local stress tests with realistic seed sizes.

Minimum checks:

- upload parse speed,
- identity resolver speed,
- scoring pure function throughput,
- review drawer query responsiveness,
- activity recap match throughput,
- database indexes visible in query plans.

## 9. Codex guardrails

Codex must not:

- create migrations before approved phase,
- generate ambiguous migration names,
- mix stress seed with pilot seed,
- touch V1 schema,
- skip rollback notes during schema phases.
