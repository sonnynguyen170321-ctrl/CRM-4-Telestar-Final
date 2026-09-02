# AWS deploy — EC2 + docker-compose (single host)

Runs TeleStar SDR OS V2 on **one EC2 host** with **managed RDS Postgres + ElastiCache
Redis**, fronted by **Caddy** for automatic HTTPS on a domain-less `sslip.io` URL. All app
processes (web, worker, imap, migrate) share one image built by CI and pushed to ECR.

This is the low-cost / low-ops path. The repo also ships an ECS/Fargate kit
(`deploy/task-def.*.json` + `.github/workflows/deploy-aws.yml` + `docs/aws-migration-runbook.md`)
if you later want horizontal scaling — the app code is identical.

> **Doing it by hand instead?** [CONSOLE-SETUP.md](./CONSOLE-SETUP.md) is a click-by-click AWS
> Console walkthrough (VPC → security groups → RDS → ElastiCache → EC2) that builds the image
> on the box and needs **no Terraform, no CI, no ECR**. Start there if you want to understand
> the pieces first; this file is the automated path.

```
Internet ──80/443──> EC2 (Elastic IP)
                       └─ docker compose: caddy → web:3000
                                          worker (BullMQ)   imap (poller)
                       │5432                    │6379
                       ▼                        ▼
                  RDS Postgres 16        ElastiCache Redis 7   (private subnets)
Registry: ECR   ·  Secrets: Secrets Manager  ·  Deploy: S3 bundle + SSM (no SSH)
```

## Files

| Path | What |
| --- | --- |
| `CONSOLE-SETUP.md` | Manual AWS Console walkthrough (no Terraform/CI/ECR — builds on the box). |
| `docker-compose.yml` | The host stack: caddy + web + worker + imap + one-shot migrate. Uses a prebuilt `${APP_IMAGE}`. |
| `Caddyfile` | Reverse proxy + auto-HTTPS for `${APP_DOMAIN}`. |
| `deploy.sh` | On-box deploy: render `.env.production` from Secrets Manager → ECR login → pull → migrate → up → health check. |
| `terraform/` | VPC, SGs, EC2+EIP+IAM, RDS, ElastiCache, ECR, Secrets Manager, S3 deploy bucket, GitHub OIDC role. |
| `../../.github/workflows/deploy-ec2.yml` | CI: build → push ECR → upload bundle to S3 → trigger SSM deploy. |

## One-time provisioning

Requires local AWS credentials (`aws configure`) with rights to create the above, plus
Terraform ≥ 1.6.

```bash
cd deploy/aws-ec2/terraform
terraform init
terraform apply            # review the plan, then approve
terraform output           # note app_url, instance_id, ecr_repository_url, deploy_bucket,
                           # github_deploy_role_arn, secret_arn
```

Terraform generates and stores the app secrets (`V2_AUTH_SECRET`, `V2_OUTREACH_CREDENTIAL_KEY`,
`V2_WORKER_SECRET`, DB password) and the full env bundle in Secrets Manager — nothing secret
is printed. RDS + ElastiCache endpoints are baked into `DATABASE_URL` / `REDIS_URL`
automatically.

## Wire GitHub Actions (from `terraform output`)

Repo **Variables**: `AWS_REGION`, `ECR_REPOSITORY=telestar-v2`, `DEPLOY_BUCKET`,
`INSTANCE_ID`, `NEXT_PUBLIC_APP_URL` (= `app_url`).
Repo **Secret**: `AWS_ROLE_ARN` (= `github_deploy_role_arn`).

> `NEXT_PUBLIC_APP_URL` is inlined into the image at build time, so it must be the final
> `https://…sslip.io` URL before the first deploy. Since the URL derives from the Elastic IP,
> `terraform apply` (which allocates the EIP) always runs first.

## First deploy

Run the **Deploy to AWS (EC2 + docker-compose)** workflow (Actions tab → Run workflow). It:

1. Builds the image and pushes `:<sha>` + `:latest` to ECR.
2. Syncs this folder (compose + Caddyfile + deploy.sh) to the S3 deploy bucket.
3. Sends an SSM command; the box runs `run-deploy.sh <sha>` → `deploy.sh`, which renders
   `.env.production`, pulls the image, **runs `prisma migrate deploy`**, brings the stack up,
   and waits for `https://<app_domain>/api/health` to report `"database":"ok"`.

## Verify

- `curl https://<app_domain>/api/health` → `{"status":"ok","database":"ok"}` (valid TLS cert).
- Open the site → self-hosted login (`V2_AUTH_SECRET`) works over HTTPS.
- Via SSM Session Manager on the box: `cd /opt/telestar/app && docker compose ps` (all up),
  `docker compose logs worker` shows the BullMQ worker registering queues, and
  `curl -s -H "x-v2-worker-secret: <V2_WORKER_SECRET>" https://<app_domain>/v2/runtime/health`
  shows `db:ok`, `redis:ok`, and a live worker heartbeat.
- Upload a small CSV → the worker drains ingestion → leads appear.

## Operate

- **Redeploy:** re-run the workflow (new image `:<sha>` → migrate → rolling `up -d`).
- **Shell on the box:** AWS console → Systems Manager → Session Manager (no SSH key/port).
- **Edit env:** update the `telestar/prod/env` secret, then re-run the workflow (deploy.sh
  re-renders `.env.production`).
- **Add a real domain later:** point an A record at the Elastic IP, set `APP_DOMAIN` +
  `NEXT_PUBLIC_APP_URL` to it, redeploy. Caddy re-issues the cert automatically.
- **Teardown:** `terraform destroy` (RDS final snapshot skipped by default — flip
  `db_skip_final_snapshot=false` to keep one).

## Cost (rough, ap-southeast-1, on-demand)

t3.medium (~$30) + db.t4g.small (~$25) + cache.t4g.micro (~$12) + EIP/EBS/S3 ≈ **$70–90/mo**.
Drop to `t3.small` / `db.t4g.micro` for a lighter footprint.
