# Job Engine — async work, two backends, idempotent

Anything slow or retryable runs **off the request**: imports, enrichment, email sends, exports,
read-model refresh. Reference implementation: **TeleStar V2** — `lib/v2/jobs/*`, `lib/v2/bullmq/*`,
`scripts/v2-runtime-worker.mjs`.

## Dual backend — Redis in prod, zero-Redis in dev

The killer feature for iteration speed: the same enqueue call works with **or without** Redis.

- **`bull` backend** — BullMQ workers on Redis (production). `lib/v2/bullmq/*`.
- **`db` backend** — jobs live in a `V2Job` table; a drain loop POSTs a secret-gated route on an
  interval. **No Redis needed** for local dev. `lib/v2/jobs/drainIfNoWorker.ts`,
  `claimNextJob.ts`.

`scripts/v2-runtime-worker.mjs` picks the backend from `V2_BULL_ENABLED` (falls back to `db`), so
the same command does the right thing per environment. Server actions can call
`drainIfNoWorker(...)` so that in dev the job runs inline when no worker is up.

## Idempotency is mandatory

`enqueueV2Job(db, input)` is keyed by **`(organizationId, idempotencyKey)`** and a **payload hash**:

- Same key + same payload → returns the existing job (no duplicate).
- Same key + different payload → a `conflict` result (`PAYLOAD_MISMATCH`) — you catch a bug instead
  of silently double-processing.

Use content hashes / stable keys, **never filenames or timestamps**, as the idempotency key. This
is invariant #6 — re-running a job or re-uploading the same file must not create duplicates.

## Worker entrypoint pattern

`scripts/v2-runtime-worker.mjs` runs **outside Next** and transpiles `lib/` TypeScript on the fly
(`loadTsModule`). Consequences you must respect:
- The deploy image must ship `scripts/` **and** `lib/` (a Next-only image can't find them — a
  paid-for gotcha, see `deploy-ec2.md`).
- Registers one `Worker` per queue from `queueNames.ts`, logs `workers listening on <prefix>: …`.

## Cluster-Redis prefix — the CROSSSLOT gotcha

BullMQ multi-key Lua ops require all keys on one Redis slot. On **cluster-mode Redis** (ElastiCache
Serverless), the queue prefix must be **hash-tagged** so every key hashes to the same slot:

```
V2_BULL_PREFIX = {telestar:v2}   // braces = hash tag; without them → CROSSSLOT errors
```

`lib/v2/bullmq/config.ts` defaults to `{telestar:v2}`. Harmless on single-node Redis; required on
cluster. Producer (web) and worker must use the **same** prefix.

## Retry & failure

`lib/v2/jobs/retryPolicy.ts` + `lib/v2/bullmq/events.ts` handle retries/backoff and failure
recording (heartbeats, `handleJobFailure`). A job's failure path must be idempotent too.

## Session fit

A `job` change-kind session produces: a queue name + processor + the `enqueue…` call site (usually
from an action). It consumes the schema/read-model it operates on. Exit-gate: enqueue → drain →
assert the effect once (and that re-enqueue with the same key is a no-op).
