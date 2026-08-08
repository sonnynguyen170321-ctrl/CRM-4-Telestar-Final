# Managed Redis — inventory, requirements and migration

Redis today is a `redis:7` container on the same VM as the app, with an `appendonly` volume.
That is a single point of failure sharing a host with its own consumers. This document is
what has to be true before moving to a managed instance, and what breaks if it is not.

## 1. Queue inventory

Five queues, six workers. `lib/bullmq/types.ts` routes job types to queues by prefix.

| Queue | Job types | Producer | Consumer | Concurrency | Attempts / backoff |
| --- | --- | --- | --- | --- | --- |
| `sequence` | `sequence.enroll`, `.advance`, `.pause`, `.unenroll`, `.rebuild`, `.execute-task` | API routes, sequence cron | `workers/sequence.ts` | 5 | 3 / exponential 2s (execute-task: 3 / exp 5s) |
| `email` | `email.send` | `lib/workflows/email.ts`, inbox reply route, sequence worker | `workers/email.ts` | 5 | 5 / exponential 5s |
| `import` | `import.parse`, `.chunk`, `.commit` | Import UI | `workers/import.ts` | 3 | parse 2 / fixed 5s; chunk 3 / exp 2s; commit 3 / fixed 5s |
| `sync` | `email.sync`, `.apply-reply`, `.apply-bounce`, `reminder.due`, `digest.daily` | Inbox-sync cron, notification cron | `workers/sync.ts`, `workers/notification.ts` | 3 | 3 / exponential; digest 1 |
| `maintenance` | `maintenance.healthcheck`, `.repair` | Maintenance cron, admin UI | `workers/maintenance.ts`, `workers/healthcheck.ts` | 1 | healthcheck 1; repair 2 / fixed 10s |

### Business impact if Redis is lost

| Queue | Impact | Recovery source |
| --- | --- | --- |
| `email` | Queued sends stop. **No duplicates and no silent drops:** every send is an `OutboundMessage` row with a unique idempotency key, and a worker claims it with a compare-and-set. A lost job leaves the row in `pending`, which is re-claimable. | `OutboundMessage` |
| `sequence` | Delayed step execution stops; sequences stall rather than skip. Enrollments and step state live in Postgres. | `SequenceEnrollment`, `Task`, `JobRun` |
| `import` | An in-flight import stalls. `ImportBatch` / `ImportRow` hold per-row state, so it resumes rather than restarting. | `ImportBatch`, `ImportRow` |
| `sync` | Inbox sync and reminders pause. Both are cron-driven and idempotent; the next tick catches up. | Cron re-enqueue |
| `maintenance` | Repairs and audit pruning pause. No user-visible effect. | Cron re-enqueue |

**Every business-critical job is backed by a durable row.** That is the property that makes
a Redis outage a delay rather than data loss, and it is the reason the runtime law says the
database holds the truth and BullMQ can be rebuilt from it. The maintenance worker's
`missing-delayed` repair exists to rebuild delayed jobs from `Task` rows after a flush.

> The one thing Redis loss *does* cost: jobs already delayed to a future time. They are
> reconstructible from `Task.dueDate` and `JobRun`, but only by running the repair.

## 2. Provider requirements

### Eviction policy — the one that will silently corrupt you

**`maxmemory-policy` must be `noeviction`.**

BullMQ stores queue state in Redis keys with no TTL. Under any `allkeys-*` policy, memory
pressure makes Redis delete *whichever keys it likes* — including job hashes and the lists
that reference them. The failure is not an error: it is a job that quietly ceases to exist,
or a queue whose counters no longer match its contents. With `noeviction`, a full instance
rejects writes loudly and the enqueue fails where you can see it.

Providers commonly default to `allkeys-lru`, which is correct for a cache and wrong for a
queue. **Check this before migrating, not after.**

### Checklist

| Item | Requirement |
| --- | --- |
| Version | 7.x — matches the current container and BullMQ's tested range |
| Eviction | `noeviction`. Non-negotiable, see above |
| TLS | Required. Connection string must be `rediss://` |
| Auth | Password or ACL user, carried in the URL |
| Persistence | AOF, or RDB with a short interval. Delayed jobs must survive a restart |
| Private networking | Reachable only from the app/worker hosts; never a public endpoint |
| Memory | Small — queue state only. Size for burst depth, not for a dataset |
| Failover | Preferred, not required. Workers reconnect indefinitely by design |
| Backups | Not required. Postgres is the recovery source; Redis is rebuildable |
| Monitoring | Memory used vs limit, evicted keys (must stay 0), connection count |
| Cost | Smallest tier meeting the above. This is not a cache workload |

## 3. What the application already handles

- **`rediss://` and auth.** `lib/bullmq/connection.ts` enables TLS when the URL scheme is
  `rediss:`; ioredis parses credentials from the URL. `assertUsableRedisUrl` rejects a
  non-`redis(s)` scheme, and rejects a password sent over plaintext to a non-local host.
- **No assumption of a compose network.** `docker-compose.yml` now reads
  `${REDIS_URL:-redis://redis:6379}`, so a managed instance needs no file edit.
- **Fail fast rather than hang.** `commandTimeout: 10_000` and `enableOfflineQueue: false`.
  Without these, an unreachable Redis makes callers *hang* — BullMQ's own calls never
  reject — so a web request that enqueued would sit until the platform killed it.
- **Bounded per-command, unbounded reconnect.** Individual commands time out; the
  connection keeps retrying with capped backoff. That combination is deliberate: a worker
  must self-heal across a provider failover, while a web request must not wait for it.
- **Observability.** `/api/admin/worker-health` reports per-queue waiting/active/delayed/
  failed/completed, **the age of the oldest waiting job**, and a **worker heartbeat read
  from Postgres** — not from Redis, because a heartbeat stored in Redis is unreadable
  exactly when Redis is the problem. Depth alone cannot tell a healthy burst from a dead
  consumer; age and heartbeat can.

## 4. Migration steps

1. Provision with the checklist above. **Verify `maxmemory-policy` is `noeviction`** —
   `CONFIG GET maxmemory-policy`, or the provider's parameter group.
2. Confirm private networking from the app host: `redis-cli -u "$REDIS_URL" PING`.
3. Drain: stop workers, let `active` reach zero (`/api/admin/worker-health`), stop web.
4. Repoint `REDIS_URL` to the `rediss://` URL. Do **not** migrate Redis data — queue state
   is rebuildable and copying it risks resurrecting stale jobs.
5. Start web and workers. Confirm the heartbeat goes healthy and `alerts` is empty.
6. Run the maintenance repair so delayed jobs are rebuilt from Postgres:
   `POST /api/cron/maintenance?types=missing-delayed`.
7. Watch `evicted_keys` for a week. It must stay at 0.

## 5. Recovery tests

To run against staging before trusting the migration. Each has a durable-state expectation,
not just "it came back".

| Scenario | Expected |
| --- | --- |
| Worker restart mid-job | Job returns to `waiting` and is retried; `JobRun` shows the retry; no duplicate delivery |
| Web restart | No queue effect; enqueue resumes |
| Transient Redis disconnect | Workers reconnect on their own; commands during the gap fail fast rather than hang |
| Job timeout | Job fails, retries per its policy, then lands in `failed` — visible in the health endpoint |
| Duplicate enqueue | Same `dedupeKey` reuses the `JobRun` row; `OutboundMessage`'s unique key means at most one delivery |
| Redis flushed entirely | Queues empty, `JobRun` rows remain; `missing-delayed` repair rebuilds delayed work from `Task` |
