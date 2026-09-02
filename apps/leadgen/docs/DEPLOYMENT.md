# TeleStar Deployment Guide

This guide packages the TeleStar Company-First Lead Scoring Tool for portable production deployment on AWS EC2 with RDS Postgres, an Ubuntu VPS with local or external Postgres, or a standard Node/Next.js host.

The app is not Vercel-only and does not require AWS-specific code. Keep secrets in server environment files or the host secret manager, never in git.

## Runtime Overview

The production runtime needs:

- Node.js compatible with the version in `package.json`, or Docker.
- PostgreSQL reachable from the app server.
- Outbound HTTP access for website research.
- Server-side environment variables.

AI is optional. With `AI_ENABLED=false`, the upload, local scoring, SDR feedback, company review, and export workflows continue to work without Gemini credentials.

## Environment Variables

Use `.env.production.example` as the production template. Copy it to `.env.production` on the server and fill in real values there.

Required for normal production operation:

| Variable | Purpose |
| --- | --- |
| `NODE_ENV=production` | Runs the app in production mode. |
| `DATABASE_URL` | PostgreSQL connection string used by Prisma. |
| `NEXT_PUBLIC_APP_URL` | Public/internal app URL used for app links. |

AI runtime controls:

| Variable | Default | Purpose |
| --- | --- | --- |
| `AI_ENABLED` | `false` | Enables optional AI second opinions only when set to `true`. |
| `AI_PROVIDER` | `gemini` | Current configured provider. Gemini is the implemented provider. |
| `GEMINI_API_KEY` | empty | Server-side Gemini API key. Leave blank when AI is disabled. |
| `GEMINI_MODEL` | `gemini-flash-latest` | Gemini model name. |
| `AI_SCORING_MODE` | `all_companies` | Controls whether AI assesses `all_companies` or `uncertain_only`. |
| `AI_MAX_ROWS_PER_UPLOAD` | `200` | Total automatic AI assessment cap per upload/provider/model/prompt/mode. |
| `AI_TIMEOUT_MS` | `15000` | Provider request timeout. |
| `AI_MAX_OUTPUT_TOKENS` | `1200` | Provider output token cap. |

Future provider placeholders may exist in `.env.example`, but OpenAI and Anthropic are not usable until implemented.

Security rules:

- Do not commit `.env.production`, `.env.local`, or real credentials.
- Do not expose `GEMINI_API_KEY` or database credentials through `NEXT_PUBLIC_` variables.
- The internal MVP has no auth yet. Deploy only behind private/internal access or a protected proxy.

## Standard Node Deployment

Run these commands on the production server after setting environment variables:

```bash
npm ci
npm run prisma:generate
npm run prisma:migrate:deploy
npm run build:production
npm run start:production
```

PowerShell equivalent:

```powershell
npm ci
npm run prisma:generate
npm run prisma:migrate:deploy
npm run build:production
npm run start:production
```

Run migrations before starting the app or during a controlled release step. Do not run migrations during Docker image build.

## AI Worker

AI assessment jobs are queued in Postgres and processed by a separate trusted
server process. The browser can enqueue jobs, but it cannot process the queue
and never receives `AI_JOB_PROCESS_SECRET`.

Local/manual worker:

```bash
npm run ai:worker
npm run ai:worker -- --uploadJobId=<upload_job_id>
npm run ai:worker -- --uploadJobId=<upload_job_id> --once
```

Local queue workflow:

1. Start the web app with `npm run dev`.
2. Open `/uploads`.
3. Open an upload detail panel.
4. Queue AI for the upload.
5. Start `npm run ai:worker -- --uploadJobId=<upload_job_id>`.
6. Watch pending/running/succeeded counts in the AI Assessment Batch card.
7. Open `/companies` to inspect completed AI second opinions.
8. Use `includeAi=true` export only when AI columns are needed.

PM2 example on AWS EC2 or a VPS:

```bash
pm2 start npm --name telestar-ai-worker -- run ai:worker
pm2 save
pm2 logs telestar-ai-worker
```

The worker calls the protected `/api/ai-jobs/process` endpoint using
server-side environment variables. Keep the main web app process and the AI
worker process separate. If the worker is stopped, queued jobs remain pending;
local scoring, SDR review, and export continue to work.

## Docker Deployment

Build the image:

```bash
docker build -t telestar-company-filter:local .
```

Run with Compose using an external database such as AWS RDS:

```bash
cp .env.production.example .env.production
# edit .env.production and set DATABASE_URL to the RDS or external Postgres endpoint
docker compose -f docker-compose.prod.example.yml up --build -d app
```

For a VPS or local production-style test with the included Postgres service:

```bash
cp .env.production.example .env.production
# set DATABASE_URL=postgresql://telestar:change-me@postgres:5432/telestar?schema=public
docker compose -f docker-compose.prod.example.yml --profile local-postgres up --build -d
docker compose -f docker-compose.prod.example.yml exec app npm run prisma:migrate:deploy
```

For AWS RDS, do not start the `local-postgres` profile. Point `DATABASE_URL` at RDS.

## Health Checks

Health endpoint:

```text
GET /api/health
```

Linux:

```bash
curl http://localhost:3000/api/health
```

PowerShell:

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/health" -Method GET
```

Expected healthy response includes `status: "ok"` and `database: "ok"`. If the database check fails, the endpoint returns HTTP `503` with `database: "error"`.

## Production Smoke Checklist

After deployment:

1. Run `npm run prisma:migrate:deploy` against the production database if it was not already run.
2. Check `GET /api/health`.
3. Open `/uploads`.
4. Open `/companies`.
5. Open `/feedback`.
6. Open `/exports`.
7. Open `/settings/ai`.
8. Upload a small CSV.
9. Confirm upload metadata, company rows, website research, and score results are saved.
10. Save SDR feedback for one row.
11. Confirm `/companies` shows the SDR feedback overlay.
12. Export CSV and confirm predicted and final values remain separate.
13. If `AI_ENABLED=true`, check `/api/ai/status` and run a tiny `/api/ai/test`.

Linux commands:

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/ai/status
curl -X POST http://localhost:3000/api/ai/test \
  -H "Content-Type: application/json" \
  -d '{"provider":"gemini","prompt":"Say pong in one short sentence."}'
curl -I http://localhost:3000/uploads
curl -I http://localhost:3000/companies
curl -I http://localhost:3000/feedback
curl -I http://localhost:3000/exports
curl -I http://localhost:3000/settings/ai
curl -I "http://localhost:3000/api/companies/export"
```

PowerShell commands:

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/health" -Method GET
Invoke-RestMethod -Uri "http://localhost:3000/api/ai/status" -Method GET
$body = @{ provider = "gemini"; prompt = "Say pong in one short sentence." } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3000/api/ai/test" -Method POST -ContentType "application/json" -Body $body
Invoke-WebRequest -Uri "http://localhost:3000/uploads" -UseBasicParsing | Select-Object StatusCode
Invoke-WebRequest -Uri "http://localhost:3000/companies" -UseBasicParsing | Select-Object StatusCode
Invoke-WebRequest -Uri "http://localhost:3000/feedback" -UseBasicParsing | Select-Object StatusCode
Invoke-WebRequest -Uri "http://localhost:3000/exports" -UseBasicParsing | Select-Object StatusCode
Invoke-WebRequest -Uri "http://localhost:3000/settings/ai" -UseBasicParsing | Select-Object StatusCode
Invoke-WebRequest -Uri "http://localhost:3000/api/companies/export" -UseBasicParsing | Select-Object StatusCode,Headers
```

## AWS EC2 + RDS Outline

Recommended setup:

- Ubuntu EC2 instance for the app.
- RDS Postgres for the database.
- EC2 security group:
  - SSH from your IP only.
  - HTTP/HTTPS from trusted networks or through a load balancer/proxy.
  - App port `3000` only for direct testing if needed.
- RDS security group:
  - Allow Postgres only from the EC2 security group.
  - Do not expose RDS publicly.
- Store `.env.production` on EC2 or use a server secret manager.
- Set `DATABASE_URL` to the RDS endpoint.
- Run `npm run prisma:migrate:deploy` against RDS before starting the app.
- Run the app with Docker Compose or a process manager such as PM2.
- Add HTTPS and a reverse proxy before wider internal use.

Do not put AWS credentials or database credentials in the repository.

## Ubuntu VPS Outline

The same package can run on an Ubuntu VPS:

- Use Docker Compose with the included `local-postgres` profile, or point `DATABASE_URL` to an external managed Postgres.
- Keep `.env.production` on the server only.
- Run `npm run prisma:migrate:deploy`.
- Start with `npm run start:production`, Docker Compose, or PM2.
- Protect the app at the network or reverse-proxy layer until auth is added.

## Rollback Notes

- Keep the previous image tag or release directory available.
- If a release fails before migrations, stop the new app and start the previous version.
- If migrations were applied, inspect the Prisma migration before rollback. Some migrations may require a deliberate database rollback plan.
- Database backups should be taken before production migrations.
- AI can be disabled immediately with `AI_ENABLED=false` and an app restart.

## Troubleshooting

- `GET /api/health` returns `503`: check `DATABASE_URL`, database network access, RDS security groups, and migration status.
- `prisma migrate deploy` fails: verify the production database URL and that migrations are present in `prisma/migrations`.
- Docker app cannot connect to local Postgres: use `postgres` as the host when using the compose profile, not `localhost`.
- AI status says disabled: set `AI_ENABLED=true` and restart the app only if AI is intended for that environment.
- AI status says missing Gemini key: set `GEMINI_API_KEY` server-side. Never expose it in browser variables.
- Website research fails broadly: confirm the server has outbound HTTP/DNS access.
- App is reachable publicly: add network restrictions, VPN, auth proxy, or reverse-proxy protection before team usage.
