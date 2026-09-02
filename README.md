# TeleStar Company-First Lead Scoring Tool

## Project Summary

TeleStar Company-First Lead Scoring Tool is an internal web app for researching, filtering, scoring, reviewing, and exporting company-level lead lists before any lead-level filtering happens.

The app is designed around the current TeleStar workflow: upload company CSV data, research websites, classify company fit, review results, save SDR corrections, and export reviewed company results.

## Current MVP Features

- Local CSV upload and parsing in the browser.
- Upload job metadata persistence.
- Parsed company record persistence.
- Local deterministic company scoring with hard-rule support.
- Website research API with reachability, quality, signal, and evidence extraction.
- Website research result persistence.
- DB-backed company review table.
- Company detail/review drawer.
- SDR feedback example saving from the company review drawer.
- Latest saved feedback display on the companies page.
- CSV export of company results using SDR reviewed values when available.
- Server-only AI provider abstraction foundation with a local test endpoint.
- Optional AI assessment after local scoring, stored separately
  in `CompanyAiAssessment`.
- Health check endpoint for internal deployment monitoring.

## Not Included Yet

- Authentication or user/team permissions.
- AI as the official source of truth for company rows.
- Redis, queues, or background workers.
- Lead, contact, or person-level filtering.
- Automatic learning from feedback.
- Feedback approval workflows.
- Evaluation dashboards or benchmark runners.
- Large-scale CSV/background processing.
- Public internet hardening.

## Prerequisites

- Node.js compatible with the versions in `package.json`.
- npm.
- PostgreSQL database.
- Network access from the server for website research requests.

## Environment Setup

Create a `.env` file from `.env.example`:

```env
DATABASE_URL=
NEXT_PUBLIC_APP_URL=http://localhost:3000

AI_ENABLED=false
AI_PROVIDER=gemini
AI_TIMEOUT_MS=15000
AI_MAX_OUTPUT_TOKENS=1200
AI_MAX_ROWS_PER_UPLOAD=200
AI_SCORING_MODE=all_companies

GEMINI_API_KEY=
GEMINI_MODEL=gemini-flash-latest

OPENAI_API_KEY=
OPENAI_MODEL=

ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=
```

`DATABASE_URL` must point to the PostgreSQL database used by Prisma.

AI keys must stay server-side in `.env.local` or the deployment environment. Do not use `NEXT_PUBLIC_` for provider keys, and do not commit real keys.

Gemini is the first implemented provider for local wiring tests. OpenAI and Anthropic are reserved behind the same internal interface but are not implemented yet.

## AI Configuration

AI is optional. The app continues to work when AI is disabled, when `GEMINI_API_KEY` is missing, or when provider tests fail.

- Keep AI keys server-side in `.env.local` or deployment environment variables.
- Do not use `NEXT_PUBLIC_` for AI provider keys.
- SDR users should not paste API keys into the UI.
- V1 AI modes are `all_companies` and `uncertain_only`: local rules and website signals run first, then eligible rows can receive a separate AI assessment when AI is enabled.
- Prompt 30 added safe config, status, and a small connection-test UI.
- Prompt 31 adds optional AI assessment after local scores are saved.
- AI output is stored separately in `CompanyAiAssessment` as a second opinion and does not overwrite local predicted scoring or SDR feedback.
- Prompt 32 adds rule-vs-AI comparison in company detail and upload-level AI usage summaries.
- `/settings/ai` shows provider status and connection test controls.
- `AI_SCORING_MODE` controls whether AI assesses all companies or uncertain rows only.
- `AI_MAX_ROWS_PER_UPLOAD` is a total cap per upload job for automatic AI assessments.
- Token usage is summarized when the provider returns token counts.
- `/companies` table and CSV export still use local score results plus SDR feedback overlays, not AI assessments.
- AI queue processing is separate from the web app. Run `npm run ai:worker`
  on a trusted server process to turn queued `CompanyAiJob` rows into
  `CompanyAiAssessment` rows. The worker uses server-side
  `AI_JOB_PROCESS_SECRET`; never expose that secret in browser code.

Useful AI checks:

```powershell
curl.exe http://localhost:3000/api/ai/status
curl.exe -X POST http://localhost:3000/api/ai/test -H "Content-Type: application/json" -d "{\"prompt\":\"Say pong in one short sentence.\"}"
```

Local AI worker:

```powershell
npm run ai:worker
npm run ai:worker -- --uploadJobId=<upload_job_id>
npm run ai:worker -- --uploadJobId=<upload_job_id> --once
```

Running AI Assessment Queue locally:

1. Start the app with `npm run dev`.
2. Open `/uploads` and open an upload detail panel.
3. Queue AI for uncertain rows, qualified + uncertain rows, or the full upload.
4. Start the worker with `npm run ai:worker -- --uploadJobId=<upload_job_id>`.
5. Watch the upload AI Assessment Batch card for pending/running/succeeded counts.
6. Open `/companies` to see completed AI second opinions.
7. Export with `includeAi=true` only when AI columns are needed.

Recommended local paid/API testing overrides:

```env
AI_ENABLED=true
AI_MODE=queue
AI_CONCURRENCY=1
AI_REQUEST_DELAY_MS=3000
AI_DAILY_REQUEST_BUDGET=500
AI_MAX_ROWS_PER_UPLOAD=300
AI_ADMIN_PROCESS_UI_ENABLED=true
AI_WORKER_APP_URL=http://127.0.0.1:3000
AI_WORKER_POLL_MS=3000
```

AWS/PM2 example:

```powershell
pm2 start npm --name telestar-ai-worker -- run ai:worker
pm2 save
```

The main web app process and AI worker process are separate. If the worker is
not running, AI jobs can remain queued while local scoring, SDR review, and
export continue to work.

## Local Development

Install dependencies, generate Prisma client, apply local migrations, and start the dev server:

```powershell
npm install
npx prisma generate
npx prisma migrate dev
npm run dev
```

Open the app at:

```text
http://localhost:3000
```

## Production Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the portable production package, including standard Node, Docker, AWS EC2 + RDS, and Ubuntu VPS deployment notes.

Production environment template:

```text
.env.production.example
```

Apply migrations before starting production. Do not bake secrets into Docker images or commit production env files.

```powershell
npm ci
npm run prisma:generate
npm run prisma:migrate:deploy
npm run build:production
npm run start:production
```

Confirm `DATABASE_URL` and `NEXT_PUBLIC_APP_URL` are set in the deployment environment.

Docker examples are provided in `Dockerfile` and `docker-compose.prod.example.yml`. For AWS RDS, set `DATABASE_URL` to the RDS endpoint and do not start the optional local Postgres profile.

## Health Check

The app exposes:

```text
GET /api/health
```

Expected successful response:

```json
{
  "status": "ok",
  "service": "telestar-company-filter",
  "timestamp": "2026-05-24T00:00:00.000Z",
  "database": "ok"
}
```

If the database check fails, the endpoint returns HTTP `503` with `database: "error"`.

## Post-Deploy Smoke Checklist

Run these checks after deployment:

```powershell
curl.exe http://localhost:3000/api/health
curl.exe http://localhost:3000/api/upload-jobs
curl.exe http://localhost:3000/api/ai/status
curl.exe -X POST http://localhost:3000/api/ai/test -H "Content-Type: application/json" -d "{\"provider\":\"gemini\",\"prompt\":\"Say pong in one short sentence.\"}"
Invoke-WebRequest http://localhost:3000/uploads -UseBasicParsing | Select-Object StatusCode
Invoke-WebRequest http://localhost:3000/companies -UseBasicParsing | Select-Object StatusCode
Invoke-WebRequest http://localhost:3000/settings/ai -UseBasicParsing | Select-Object StatusCode
Invoke-WebRequest http://localhost:3000/exports -UseBasicParsing | Select-Object StatusCode
Invoke-RestMethod -Uri "http://localhost:3000/api/companies?page=1&pageSize=5" -Method GET | ConvertTo-Json -Depth 8
Invoke-RestMethod -Uri "http://localhost:3000/api/feedback-examples?page=1&pageSize=5" -Method GET | ConvertTo-Json -Depth 8
Invoke-WebRequest "http://localhost:3000/api/companies/export" -UseBasicParsing | Select-Object StatusCode,Headers
```

Manual checks:

- `/uploads` loads.
- CSV upload and local parsing work.
- Local scoring works.
- `/companies` loads persisted rows.
- Review drawer opens.
- Saving feedback works.
- `/exports` loads.
- Company CSV export downloads.
- `/api/health` returns `status: "ok"` and `database: "ok"`.
- `/api/ai/status` returns safe AI configuration status.
- `/settings/ai` shows AI status and connection test controls.
- `/api/ai/test` returns a compact provider response only when AI is enabled and a server-side AI key is configured.
- Optional upload-time AI assessment checks only uncertain local rows and stores the result separately.

## Production Cautions

- Auth is not implemented yet. Deploy only behind private/internal access.
- Do not expose the app to the public internet without access control.
- Website research performs outbound HTTP requests from the server.
- Large CSV/background queue processing is not implemented yet.
- AI assessment is optional and runs only for rows selected by the current AI mode after local scoring.
- AI assessments are not the official score and do not replace SDR feedback.
- Feedback examples are stored for later evaluation and controlled improvement, but no automatic learning is implemented.
- Lead/contact/person filtering is not implemented yet.

## Useful Routes

- `/` - dashboard overview.
- `/uploads` - CSV parsing, local scoring, row persistence, and score persistence.
- `/companies` - DB-backed company review table and review drawer.
- `/settings/ai` - AI provider status and connection test.
- `/exports` - CSV export links.
- `/api/health` - health check and database connectivity check.
- `/api/upload-jobs` - upload job metadata.
- `/api/companies` - enriched company rows.
- `/api/companies/export` - company CSV export.
- `/api/feedback-examples` - persisted SDR feedback examples.
- `/api/website-research` - single-website research.
- `/api/website-research-results` - persisted website research results.
- `/api/ai/test` - internal provider wiring test endpoint.
- `/api/ai/status` - safe AI runtime status endpoint.
