# AWS Migration Runbook — TeleStar V2 (ECS Fargate, GitHub-built image)

Region: **ap-southeast-1** (Singapore). Compute: **ECS Fargate**. Full stack: app + RDS Postgres +
ElastiCache Redis + a dedicated worker service. Image is built **on GitHub Actions** and pushed to
**ECR** — no local Docker required. HTTP over the ALB DNS first; add HTTPS/custom domain later.

## Why the previous attempt failed (fixed in this change)

1. **Build was red (CI + docker both).** `next build` runs ESLint + `tsc` internally, and it also
   **prerenders pages at build time**. The V1 home page `/` (and `companies`, `feedback`, `settings/ai`)
   are `async` server components that query the DB during render. With no DB reachable in the CI/Docker
   build, prerender threw `PrismaClientKnownRequestError` (P1000, auth failed) → the build worker
   crashed → both `ci.yml` (`npm run build`) and `docker-image.yml` (Dockerfile `npm run build`) failed.
   **Fix:** those pages now `export const dynamic = "force-dynamic"` (render per request, never
   prerender). Plus a handful of lint errors were cleared. `npm run lint` + `npm run typecheck` +
   `npm run build` are green with no DB.
2. **No infrastructure existed.** `deploy-aws.yml` only builds/pushes and `aws ecs update-service`;
   it assumed the cluster/services/task-defs/ALB/RDS/OIDC role were already there. **Fix:** a
   `build_push_only` first-run mode, and the manual console provisioning below.

## One-image / many-commands model

The single ECR image runs different roles by container command:

| Role | Task def | Command | Port | LB |
| --- | --- | --- | --- | --- |
| Web app | `telestar-app` | `npm run start:production` (default) | 3000 | ALB |
| Worker | `telestar-worker` | `npm run v2:worker` | — | no |
| Migrate (one-off) | `telestar-migrate` | `npx prisma migrate deploy` | — | no |
| IMAP (optional) | `telestar-imap` | `npm run v2:imap` | — | no |
| AI worker (optional) | `telestar-ai` | `npm run ai:worker` | — | no |

**Health check = `GET /v2/login`** (public 200). Do NOT use `/v2/runtime/health` (secret-gated → 503).
**Redis is required** for full-stack workers: set `V2_BULL_ENABLED=true` + `REDIS_URL`.

Runtime env/secrets the tasks read: `DATABASE_URL`, `REDIS_URL`, `V2_BULL_ENABLED=true`,
`V2_BULL_PREFIX`, `V2_AUTH_SECRET`, `V2_OUTREACH_CREDENTIAL_KEY`, `V2_WORKER_SECRET`, plus any
AI/`AUTH0_*` keys. `NEXT_PUBLIC_APP_URL` is **baked at image build** (build arg), not runtime.

---

## MANUAL AWS CONSOLE STEPS (do these; the rest is GitHub Actions)

All in **ap-southeast-1**.

### Networking / security groups
1. Use the **default VPC** (simplest). Note 2 **public** subnets (ALB + Fargate tasks) and 2 **private**
   subnets (RDS + Redis).
2. **SG-alb** — inbound TCP 80 from `0.0.0.0/0`.
3. **SG-task** — inbound TCP 3000 from **SG-alb** only; outbound all.
4. **SG-rds** — inbound TCP 5432 from **SG-task**. Not public.
5. **SG-redis** — inbound TCP 6379 from **SG-task**. Not public.

### Registry
6. **ECR → Create repository** (private): **`telestar-v2`**. Copy the URI.

### Database + cache
7. **RDS → Create database**: PostgreSQL 16, `db.t4g.micro`, **private** subnets, **SG-rds**,
   *Public access = No*, set master user/password, initial DB name `telestar`. Copy the endpoint.
8. **ElastiCache → Create Redis**: Redis 7, `cache.t4g.micro`, **private** subnets, **SG-redis**.
   Copy the primary endpoint.

### Secrets
9. **Secrets Manager** → create (individually or one JSON secret):
   - `DATABASE_URL` = `postgresql://<user>:<pw>@<rds-endpoint>:5432/telestar?schema=public`
   - `REDIS_URL` = `redis://<redis-endpoint>:6379`
   - `V2_AUTH_SECRET`, `V2_OUTREACH_CREDENTIAL_KEY`, `V2_WORKER_SECRET`, and any AI/`AUTH0_*` keys.

### IAM
10. **IAM → Identity providers** → add OIDC `token.actions.githubusercontent.com` (audience
    `sts.amazonaws.com`) if not present.
11. Create role **`telestar-gh-oidc`** trusting that provider scoped to the repo
    (`repo:BrandNg/telestar-company-filter:*`). Permissions: ECR push/auth, `ecs:UpdateService`,
    `ecs:RunTask`, `ecs:DescribeServices`, `iam:PassRole` (for the task/execution roles). Copy the ARN.
12. Create **ECS task-execution role** (`AmazonECSTaskExecutionRolePolicy` + read on the step-9 secrets)
    and a **task role** (minimal to start).

### ECS cluster + task definitions
13. **ECS → Create cluster** `telestar-prod` (Fargate).
14. **Register task definitions** (Fargate, `awsvpc`), image `telestar-v2:latest`, execution role from
    step 12, env/secrets from step 9:
    - **`telestar-app`** — container name `app`, port 3000, default command, health check `GET /v2/login`,
      0.5 vCPU / 1 GB.
    - **`telestar-worker`** — command `["npm","run","v2:worker"]`, no port, 0.25 vCPU / 0.5 GB.
    - **`telestar-migrate`** — command `["npx","prisma","migrate","deploy"]`, no port (one-off).
    - *(optional)* `telestar-imap` (`npm run v2:imap`), `telestar-ai` (`npm run ai:worker`).
    - Templates in [`deploy/`](../../deploy/) — fill in `<ACCOUNT>`, secret ARNs, and register with
      `aws ecs register-task-definition --cli-input-json file://deploy/task-def.app.json` (or paste in
      the console "Create new task definition with JSON" box).

### Load balancer
15. **EC2 → Load balancers → Create ALB** (internet-facing) in the 2 public subnets, attach **SG-alb**.
    Create a **target group** (type **IP**, HTTP, port 3000, health check path **`/v2/login`**,
    success code 200). Add an **HTTP:80 listener** → forward to that target group.

### GitHub repo configuration (Settings → Secrets and variables → Actions)
16. **Variables:** `AWS_REGION=ap-southeast-1`, `ECR_REPOSITORY=telestar-v2`,
    `ECS_CLUSTER=telestar-prod`, `ECS_SERVICE_APP=telestar-app`, `ECS_SERVICE_WORKER=telestar-worker`,
    `NEXT_PUBLIC_APP_URL=http://<alb-dns-name>` (set after step 15; rebuild so the baked URL is right),
    and `AWS_SUBNETS` / `AWS_SECURITY_GROUP` if you run migrate from the workflow.
    **Secret:** `AWS_ROLE_ARN=<arn from step 11>`.

### Push image → migrate → create services
17. **GitHub → Actions → "Deploy to AWS (ECR + ECS)" → Run workflow** with **`build_push_only = true`**.
    This builds + pushes `telestar-v2:latest` to ECR (no rollout — services don't exist yet).
18. **ECS → Run task** `telestar-migrate` once (Fargate, a **public** subnet + **SG-task**,
    auto-assign public IP). Confirm it exits 0 — migrations applied to RDS. Do this **before** serving.
19. **ECS → Create service `telestar-app`**: task def `telestar-app`, desired 1–2, **public** subnets,
    *Auto-assign public IP = ENABLED*, **SG-task**, attach to the ALB target group.
20. **ECS → Create service `telestar-worker`**: task def `telestar-worker`, desired 1, **SG-task**, no LB.
21. Open `http://<alb-dns-name>/v2/login` → verify. Log in; check `/v2/leads`, a lead drawer, compose,
    send. Confirm the worker task is RUNNING and drains an enqueued research/score run.

### Ongoing deploys
22. Push to `feature/shared-types` / `main`, then **Run workflow** normally (leave `build_push_only`
    off). It builds+pushes the new image and `update-service --force-new-deployment` for app + worker.

### Later — HTTPS + custom domain
23. **ACM** → request a cert for your domain (DNS-validate). Add an **HTTPS:443** listener on the ALB
    using the cert; optionally redirect 80→443. Point DNS (Route 53 or your registrar) at the ALB.
    Then set `NEXT_PUBLIC_APP_URL=https://<domain>` and re-run the workflow to rebuild.

---

## Rollback

- **App regression:** in the ECS service, update to the previous task-def revision (or previous image
  tag) and force a new deployment. Keep the last-known-good `telestar-v2:<sha>` tag.
- **Bad migration:** migrations are forward-only via `prisma migrate deploy`. Take an RDS snapshot
  **before** step 18 and before every future release; restore the snapshot if a migration is bad.
- **Fast kill:** set the app service desired count to 0 (stops serving) while you investigate; the ALB
  target goes unhealthy but the stack stays intact.

## Optional — SearXNG search service (free OSS provider for research)

Research search can run on self-hosted **SearXNG** instead of paid keys (exa/brave/serper). Deploy it as
an internal ECS service; the app reaches it via `SEARXNG_URL`.

1. Build the thin JSON-enabled image from [`deploy/searxng/`](../../deploy/searxng/) (stock SearXNG serves
   HTML only; our image enables `formats: [html, json]`) and push to ECR as `telestar-searxng:latest` —
   on GitHub Actions, no local Docker.
2. Secrets Manager → `telestar/SEARXNG_SECRET` (a random string for the instance secret).
3. Register [`deploy/task-def.searxng.json`](../../deploy/task-def.searxng.json) and create an ECS service
   `telestar-searxng` (desired 1, **SG-task**, no public LB — internal only). Note its private
   address/port 8080 (use Cloud Map / service discovery, or a small internal ALB).
4. App config: set `SEARXNG_URL=http://<searxng-internal>:8080` (Secrets/env on the app + worker tasks).
   The provider chain auto-includes it once the URL is set. Optionally set `DDG_SEARCH_ENABLED=true` for
   the keyless DuckDuckGo fallback (no service needed).
5. *(Optional)* `SEARCH_RERANK_ENABLED=true` + `npm i @huggingface/transformers` in the image to turn on
   the local neural rerank; otherwise it no-ops.

## Notes / trade-offs

- Fargate tasks run in **public subnets with public IPs** (no NAT gateway cost). Move them to private
  subnets + a NAT gateway if outbound traffic must not originate from public IPs.
- Migrations are run as a **console one-off task** the first time (simplest). To automate later, set
  `AWS_SUBNETS` + `AWS_SECURITY_GROUP` repo vars and run the workflow with `run_migrations = true`.
- **Search providers:** the chain is exa→brave→serper→searxng→ddg, each active only when configured
  (key / `SEARXNG_URL` / `DDG_SEARCH_ENABLED`). A run where every configured provider rejects the queries
  now records a visible error on `/v2/research` instead of a silent "0 candidates".
