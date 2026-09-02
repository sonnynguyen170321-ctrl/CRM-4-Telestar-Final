# Deploy — TeleStar SDR OS V2

Container + CI/CD for the Next.js app, its BullMQ workers, Postgres, and Redis. The local Docker
stack mirrors the AWS service topology 1:1, so what runs in `docker compose` is what you deploy.

## Architecture

| Component | Local (`docker-compose.yml`) | AWS target |
|-----------|------------------------------|------------|
| Web app (`next start`, port 3000) | `app` | ECS/Fargate service (behind ALB) |
| Runtime worker (`npm run v2:worker`) | `worker` | ECS/Fargate service (scale by desired count) |
| IMAP poller (`npm run v2:imap`) | `imap` (profile `workers`) | ECS service / scheduled task |
| AI worker (`npm run ai:worker`) | `ai-worker` (profile `workers`) | ECS service |
| DB migrations (`prisma migrate deploy`) | `migrate` (one-shot) | pre-deploy `aws ecs run-task` |
| PostgreSQL | `postgres` | RDS for PostgreSQL |
| Redis | `redis` | ElastiCache for Redis |

All app + worker containers run the **same image** with a different `command`. Build once, deploy everywhere.

## Run locally

```bash
cp .env.production.example .env      # fill secrets (see "Required env" below)
docker compose up --build            # migrations run first, then app on http://localhost:3000
docker compose --profile workers up --build   # also start imap + ai-worker
```

`DATABASE_URL` and `REDIS_URL` are set by compose to the internal service DNS and override `.env`,
so the stack is self-contained.

## Required env (runtime)

Provided by `.env` locally; by SSM Parameter Store / Secrets Manager on AWS.

- `DATABASE_URL` — Postgres connection string (compose/RDS set this).
- `REDIS_URL` — Redis connection string (compose/ElastiCache set this).
- `V2_BULL_ENABLED=true` — turn on the BullMQ workers (compose sets this).
- `V2_AUTH_SECRET` — HMAC secret for session cookies. **Required.** Generate: `openssl rand -base64 48`.
- `V2_OUTREACH_CREDENTIAL_KEY` — encrypts sender SMTP/IMAP creds. Required for live outreach. `openssl rand -base64 48`.
- `V2_WORKER_SECRET` — gates `/v2/runtime/health` + worker-only endpoints.
- `NEXT_PUBLIC_APP_URL` — public origin. **Baked at build time** — pass as a build arg (compose/CI do).
- AI + auth providers as needed: `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY`, `AUTH0_*`.

See `.env.production.example` for the full list.

## CI/CD (GitHub Actions)

- **`ci.yml`** — lint + typecheck + build on every push/PR (the existing safety net).
- **`docker-image.yml`** — builds the production image and pushes to **GHCR**
  (`ghcr.io/<owner>/<repo>`) on pushes to the working branch and on `v*` tags. Zero setup — uses
  `GITHUB_TOKEN`. Optionally set repo variable `NEXT_PUBLIC_APP_URL` so the public origin is baked correctly.
- **`deploy-aws.yml`** — **dormant** (manual `workflow_dispatch` only). Builds + pushes to **ECR** and
  rolls out ECS via OIDC (no long-lived AWS keys). Fill the variables/secrets in its header, then run it.

## AWS migration checklist

1. **ECR**: `aws ecr create-repository --repository-name telestar-v2`.
2. **RDS** (PostgreSQL 16) + **ElastiCache** (Redis 7) in a private subnet; note their endpoints.
3. **Secrets**: put `V2_AUTH_SECRET`, `V2_OUTREACH_CREDENTIAL_KEY`, `V2_WORKER_SECRET`, `DATABASE_URL`,
   `REDIS_URL`, and provider API keys in SSM Parameter Store / Secrets Manager. Reference them from the
   ECS task definitions' `secrets` block (never bake secrets into the image).
4. **GitHub OIDC role**: create an IAM role trusting `token.actions.githubusercontent.com`, allowing
   `ecr:*` (push) + `ecs:UpdateService`/`ecs:RunTask`. Put its ARN in repo secret `AWS_ROLE_ARN`.
5. **Repo variables**: `AWS_REGION`, `ECR_REPOSITORY`, `ECS_CLUSTER`, `ECS_SERVICE_APP`,
   `ECS_SERVICE_WORKER`, `NEXT_PUBLIC_APP_URL`.
6. **Task definitions** (all from the ECR image; mirror the compose services):
   - `app` → command `npm run start:production`, port 3000, ALB target, health path `/v2/login`.
   - `worker` → command `npm run v2:worker`.
   - `telestar-migrate` → command `npx prisma migrate deploy` (one-off, run before each rollout).
7. **Deploy**: run the **Deploy to AWS** workflow (Actions tab). It builds+pushes to ECR, runs the
   migrate task, then forces a new deployment of the app (and worker) services.

### Notes

- Run `prisma migrate deploy` exactly once per release (the migrate task), **not** on every app boot —
  the app image intentionally does not auto-migrate, so multiple app replicas are safe.
- The app image is Debian-slim (glibc), matching Prisma's default engine — no `binaryTargets` change needed.
- Health probe: `/v2/runtime/health` is secret-gated; use a public route (e.g. `/v2/login`) or a TCP
  check for ALB/ECS health checks.
