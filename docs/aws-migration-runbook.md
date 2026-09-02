# AWS Migration Runbook — TeleStar SDR OS V2

How to run this app on AWS as separate **web** + **worker** services with managed
Postgres / Redis. Decision (see `docs/v2-final-acceptance.md`): **ECS/Fargate** (not App
Runner — we need a long-running worker separate from the web request path).

## 1. Services

| Service | Command | Notes |
| --- | --- | --- |
| **web** | `npm run build` → `npm start` | Next.js app. Stateless; scale horizontally. |
| **worker** | `npm run v2:worker -- --backend=bull` | BullMQ consumer for all async work. Needs `V2_BULL_ENABLED=true` + `REDIS_URL`. One+ replicas. |
| **imap poller** (optional) | `npm run v2:imap` | Only if inbound-reply IMAP polling is used. Single replica. |

All three run the **same image**; the command differs. Web must never run long jobs — sends,
scoring, enrichment, and exports all go through the worker (durable-job bridge, P1).

## 2. AWS mapping

| Concern | AWS service |
| --- | --- |
| Prisma database | **RDS PostgreSQL** (`DATABASE_URL`) |
| BullMQ queues | **ElastiCache Redis** (`REDIS_URL`) |
| Import/export files & large artifacts | **S3** (current DB-backed storage OK ≤ ~20k rows/file; S3 multipart is a post-migration follow-up) |
| Secrets (API keys, credential key, auth secret) | **Secrets Manager / SSM** injected as env |
| Logs / metrics / alarms | **CloudWatch** (alarm on health failures + queue lag) |
| Compute | **ECS/Fargate** — one task def per service, in private subnets; web behind an ALB |

## 3. Health checks

Both already implemented:

- **ALB target group → `GET /api/health`** — returns `200 {status:"ok",database:"ok"}` or
  `503` on DB failure (`app/api/health/route.ts`). Use for web target health.
- **Ops/runtime → `GET /v2/runtime/health`** (secret-gated by `x-v2-worker-secret` =
  `V2_WORKER_SECRET`) — DB + Redis ping + BullMQ flag + worker heartbeat + backlog
  (`app/v2/runtime/health/route.ts`). Wire a CloudWatch synthetic + alarm on `ok:false` or
  a missing worker heartbeat.

Worker liveness: the worker writes a runtime heartbeat; `/v2/runtime/health.worker` shows
it. Alarm if no heartbeat for > 2× `V2_WORKER_INTERVAL_MS`.

## 4. Environment matrix

**Required (all services):**
- `DATABASE_URL` — RDS Postgres connection string.
- `V2_AUTH_SECRET` — session signing secret.
- `APP_URL` (or `APP_BASE_URL` / `NEXT_PUBLIC_APP_URL`) — public base URL (tracking links,
  worker callbacks resolve `V2_WORKER_APP_URL → APP_URL → NEXT_PUBLIC_APP_URL → APP_BASE_URL`).

**Runtime (web + worker):**
- `V2_BULL_ENABLED=true`, `REDIS_URL` — enable BullMQ + point at ElastiCache.
- `V2_BULL_PREFIX` (optional queue namespace), `V2_BULL_WORKER_ID` (worker only, optional).
- `V2_WORKER_SECRET` — gates `/v2/runtime/health`.
- `V2_WORKER_INTERVAL_MS`, `V2_WORKER_APP_URL` — worker heartbeat + callback base.

**Outreach:**
- `V2_OUTREACH_CREDENTIAL_KEY` — encrypts sender credentials (**Secrets Manager**; rotate
  with care — see key-rotation note in the code).
- `V2_OUTREACH_KILL_SWITCH=true` — global send kill switch.
- `V2_IMAP_POLL_INTERVAL_MS` — imap poller cadence (imap service only).

**AI (optional, off by default):**
- `GEMINI_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` — advisory AI providers. AI is
  disabled unless enabled in `/v2/ai`; deterministic flows run without any key.

**Enrichment (optional):**
- `V2_ENRICHMENT_PLAYWRIGHT_ENABLED` — JS-render fallback for crawling.
- `V2_LINKEDIN_PROBE_PROVIDER` — LinkedIn reachability probe adapter (OFF by default).

Never put secrets in the image or client bundle. `V2_DEMO_SMOKE_*` and `V2_SIGNUP_*` are
seed/dev-only — do not set in production.

## 5. Boot order (deploy)

1. `npm run prisma:generate` (build step).
2. `npm run prisma:migrate:deploy` — apply migrations (includes the P3 additive enum
   `NOT_FOUND`/`PRIVATE`). Run once per release, before new tasks serve traffic.
3. Roll **web** tasks (ALB waits for `/api/health`).
4. Roll **worker** tasks (they self-register queues from the handler map).
5. Verify `/v2/runtime/health` shows `db:ok`, `redis:ok`, a live worker heartbeat, and no
   stuck backlog.

## 6. Rollback / failed-migration recovery

- **Bad release, schema unchanged:** redeploy the previous image tag for web + worker.
- **Failed migration:** migrations here are additive (new enum values, new columns) — safe
  to leave applied; roll the app image back. Never destructive-migrate on rollback.
- **Redis outage:** the DB-drain fallback still advances jobs (slower). Bring ElastiCache
  back; workers reconnect. No data loss — V2Job rows are the source of truth.
- **Stuck jobs:** the failed-hook forces terminal state after Bull retries; the DB reaper is
  the second net. Inspect `/v2/jobs` + `/v2/runtime/health`.

## 7. Pre-cutover checklist

- [ ] `npm run build` succeeds in the image.
- [ ] Worker boots with `V2_BULL_ENABLED=true REDIS_URL=…` and registers queues.
- [ ] `/api/health` returns 200; `/v2/runtime/health` shows all green with a live worker.
- [ ] Secrets resolved from Secrets Manager (no plaintext in task def).
- [ ] One end-to-end: upload → score (worker) → review → campaign dry-run (gates hold) →
      export (worker) → file downloads.
