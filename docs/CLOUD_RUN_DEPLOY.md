# Google Cloud Run — demo deployment runbook

Deploys the CRM to Cloud Run + Cloud SQL for a **demo**: seeded fake data, outbound email
disabled, no worker.

> **Which GCP runbook do I want?**
> - **This file** — Cloud Run + Cloud SQL, serverless, scales to zero, **no BullMQ worker**.
>   Fastest path to a shareable URL for a demo.
> - **`GCP_DEPLOY.md`** — Compute Engine VM + Docker Compose + Caddy + Memorystore Redis,
>   running the web app *and* the worker. The full production topology.
>
> Also see `DEPLOY.md` (EC2/VPS) and `docs/archive/runtime-hardening/PLAN.md` for the always-on
> worker requirement.

Cloud Run scales to zero and is **not** a valid host for `workers/index.ts` unless run as a
separate service with `--min-instances=1` and CPU always allocated. The demo runs without a
worker: BullMQ queues are lazy, and lead import falls back to an inline path under
`INLINE_IMPORT_MAX_ROWS` (2000).

## Run these from Google Cloud Shell

PowerShell writes CRLF into `gcloud secrets create --data-file=-`. A trailing `\r` makes
`ENCRYPTION_KEY` 65 characters, fails the `/^[0-9a-f]{64}$/i` check in `lib/env.ts`, and
crashloops the container with an error that looks like a bad key. `cmd.exe` also eats the
`^` in gcloud's ArgList escapes. Cloud Shell has neither problem and the commands below are
bash as-is.

---

## 1. Project, APIs, IAM

```bash
export PROJECT_ID=telestar-crm-demo-$(date +%y%m%d)   # project ids are globally unique
export REGION=asia-southeast1
export SERVICE_NAME=telestar-crm-web
export DB_INSTANCE=telestar-db
export DB_NAME=telestar_crm
export DB_USER=crm_user
export REPO=cloud-run-source-deploy

gcloud auth login
gcloud projects create $PROJECT_ID --name="Telestar CRM Demo"
gcloud config set project $PROJECT_ID

gcloud billing accounts list
export BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX
gcloud billing projects link $PROJECT_ID --billing-account=$BILLING_ACCOUNT
gcloud billing projects describe $PROJECT_ID --format='value(billingEnabled)'   # must be True
```

APIs need **full** `*.googleapis.com` names. `compute.googleapis.com` is what creates the
default runtime service account — without it, every later command fails with "service
account does not exist".

```bash
gcloud services enable \
  run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  sqladmin.googleapis.com secretmanager.googleapis.com compute.googleapis.com \
  iam.googleapis.com cloudresourcemanager.googleapis.com logging.googleapis.com

export PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
export RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud iam service-accounts describe $RUNTIME_SA    # gate: must succeed before continuing
```

`gcloud builds` runs **as** the compute service account, so it needs the builder role or the
build 403s immediately.

```bash
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${RUNTIME_SA}" --role="roles/cloudbuild.builds.builder"
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${RUNTIME_SA}" --role="roles/cloudsql.client"
gcloud iam service-accounts add-iam-policy-binding $RUNTIME_SA \
  --member="user:$(gcloud config get-value account)" --role="roles/iam.serviceAccountUser"

gcloud artifacts repositories create $REPO --repository-format=docker --location=$REGION
```

## 2. Cloud SQL — start now, it takes 10–15 min

Run section 3 in parallel while this provisions.

```bash
export DB_PASS=$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 28)  # alnum: no URL-encoding

gcloud sql instances create $DB_INSTANCE \
  --database-version=POSTGRES_16 --edition=enterprise --tier=db-g1-small \
  --region=$REGION --storage-type=SSD --storage-size=10GB --no-storage-auto-increase \
  --availability-type=zonal \
  --backup-start-time=17:00 --enable-point-in-time-recovery \
  --retained-transaction-log-days=7 --backup-location=$REGION

# NOT --no-backup. That flag was here until 2026-08-23 and it contradicts the certification
# programme: DR-001 requires a verifiable backup and DR-007 requires a measured RPO, and an
# instance created without backups can satisfy neither. The live instance telestar-db has
# backups and point-in-time recovery ENABLED, so this command did not describe the database
# it claims to create — anyone rebuilding from this runbook would have produced a
# non-compliant instance and only discovered it during an incident.

gcloud sql databases create $DB_NAME --instance=$DB_INSTANCE
gcloud sql users create $DB_USER --instance=$DB_INSTANCE --password="$DB_PASS"
export ICN=$(gcloud sql instances describe $DB_INSTANCE --format='value(connectionName)')
```

The instance keeps its default public IP — required for the Cloud Run auth-proxy path. No
`--authorized-networks` are configured, so nothing on the internet can reach it.

## 3. Build the image explicitly

Do **not** use `gcloud run deploy --source .`. Cloud Build's default timeout is 10 minutes,
`run deploy --source` exposes no flag to raise it, and this image runs `npm ci` twice plus
`next build` over 118 routes. Building separately also produces one immutable tag shared by
the service and both jobs, so migrations can run *before* the service is deployed.

```bash
git clone https://github.com/sonnynguyen170321-ctrl/CRM-4-Telestar-Final.git ~/crm && cd ~/crm
export IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE_NAME}"
export TAG="v$(date +%Y%m%d-%H%M%S)"

gcloud builds submit . --tag="${IMAGE}:${TAG}" --region=$REGION \
  --machine-type=e2-highcpu-8 --timeout=30m
```

A `Dockerfile` exists at the repo root, so Cloud Build uses `docker build`, not buildpacks.
gcloud writes a `.gcloudignore` derived from `.gitignore`; it excludes nothing the build
needs. If the Cloud Shell session drops the build survives — reattach with
`gcloud builds list --region=$REGION` then `gcloud builds log <ID> --region=$REGION --stream`.

## 4. Secrets

```bash
export AUTH_SECRET=$(openssl rand -base64 32)
export ENCRYPTION_KEY=$(openssl rand -hex 32)     # 64 lowercase hex — lib/env.ts enforces this
export CRON_SECRET=$(openssl rand -hex 32)

export DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@localhost/${DB_NAME}?host=/cloudsql/${ICN}&schema=public&connection_limit=5&pool_timeout=20"
export DIRECT_URL="$DATABASE_URL"

for S in DATABASE_URL DIRECT_URL AUTH_SECRET ENCRYPTION_KEY CRON_SECRET; do
  printf '%s' "${!S}" | gcloud secrets create "$S" --data-file=- --replication-policy=automatic
  gcloud secrets add-iam-policy-binding "$S" \
    --member="serviceAccount:${RUNTIME_SA}" --role="roles/secretmanager.secretAccessor"
done

gcloud secrets versions access latest --secret=ENCRYPTION_KEY | wc -c   # gate: must be 64
```

`printf '%s'` — never `echo`, never `printf '%s\n'`. The `wc -c` check costs nothing and
saves a long crashloop debug.

On the socket URL: `@localhost` is a required syntactic placeholder, ignored once `host=`
names the socket directory — do not remove it. Do **not** set `sslmode`; there is no TLS on a
unix socket. `DIRECT_URL` must be identical and mounted on **every job** —
`prisma/schema.prisma` declares `directUrl`, which `migrate deploy` reads.

## 5. Migrate, then seed

```bash
JOB_COMMON="--region=$REGION --image=${IMAGE}:${TAG} --service-account=$RUNTIME_SA \
  --set-cloudsql-instances=$ICN \
  --set-secrets=DATABASE_URL=DATABASE_URL:latest,DIRECT_URL=DIRECT_URL:latest,AUTH_SECRET=AUTH_SECRET:latest,ENCRYPTION_KEY=ENCRYPTION_KEY:latest \
  --set-env-vars=NODE_ENV=production --memory=1Gi --cpu=1 --max-retries=0 --task-timeout=15m"

gcloud run jobs create telestar-crm-migrate $JOB_COMMON \
  --command=/bin/sh --args="-c,npx prisma migrate deploy"
gcloud run jobs execute telestar-crm-migrate --region=$REGION --wait

gcloud run jobs create telestar-crm-seed $JOB_COMMON \
  --command=/bin/sh --args="-c,npm run db:seed"
gcloud run jobs execute telestar-crm-seed --region=$REGION --wait
```

Kept as two jobs so a seed failure is never mistaken for a migration failure, and so the
data can be reset without re-running migrations.

`--args` is a gcloud ArgList split on commas. `&&` is fine inside one quoted token; a
literal **comma** is the hazard — keep commas out of command strings rather than reaching for
`^delimiter^` escaping.

**Never run `prisma migrate dev` or `migrate reset` against a deployed database.**
`package.json` sets `prisma.seed`, so both auto-fire the destructive seed (17 unfiltered
`deleteMany()` calls, including `tenant` and `user`). `migrate deploy` does not.

## 6. Demo accounts

The seed creates a populated org — leads, tasks, campaigns, activities — with every account
on password `telestar2026`. Use these; freshly created accounts own no data, so the SDR
dashboard and daily-task flows come up empty.

| Persona | Email | Role |
|---|---|---|
| Director | `dean@telestar.vn` | director |
| Floor Manager | `sonny@telestar.vn` | floor_manager |
| SDR | `lan.pham@telestar.vn` | sdr |
| Leadgen Manager | `dominic@telestar.vn` | leadgen_manager |
| Leadgen | `alex@telestar.vn` | leadgen |

The one-click demo buttons on `/login` are gated on `NODE_ENV !== 'production'`, so on Cloud
Run only the email/password form renders. Reset passwords to something non-public before
showing the app to anyone outside the team:

```bash
gcloud run jobs create telestar-crm-users $JOB_COMMON --command=/bin/sh \
  --args="-c,npm run create-user -- --email dean@telestar.vn --password <NEW> --activate && npm run create-user -- --email lan.pham@telestar.vn --password <NEW> --activate"
gcloud run jobs execute telestar-crm-users --region=$REGION --wait
```

`create-user` upserts, so passing an existing email updates it in place and keeps its data.
**Re-running the seed wipes users** — re-run this job afterwards.

## 7. Deploy

```bash
gcloud run deploy $SERVICE_NAME --region=$REGION \
  --image="${IMAGE}:${TAG}" --service-account="$RUNTIME_SA" --allow-unauthenticated \
  --set-cloudsql-instances="$ICN" \
  --set-secrets="DATABASE_URL=DATABASE_URL:latest,DIRECT_URL=DIRECT_URL:latest,AUTH_SECRET=AUTH_SECRET:latest,ENCRYPTION_KEY=ENCRYPTION_KEY:latest,CRON_SECRET=CRON_SECRET:latest" \
  --set-env-vars="NODE_ENV=production,SEQUENCE_AUTOSEND_ENABLED=false,EMAIL_SEND_DRY_RUN=true,EMAIL_HEALTH_AUTOPAUSE=false,NEXT_TELEMETRY_DISABLED=1" \
  --port=3000 --memory=2Gi --cpu=1 --cpu-boost \
  --min-instances=1 --max-instances=3 --concurrency=20 --timeout=120
```

> **Always use `--update-env-vars` / `--update-secrets` for later changes, never `--set-*`.**
> `--set-*` replaces the whole map, so a later `--set-env-vars` would silently drop
> `SEQUENCE_AUTOSEND_ENABLED=false` and re-arm live sending.

`--memory=2Gi` because 1Gi is tight for Next 16 SSR plus the Prisma engine across 118 routes,
and an OOM surfaces only as "Container terminated" with no stack. `--concurrency=20` because
one vCPU cannot serve 80 concurrent SSR renders. `PORT` is reserved and cannot be set via
`--set-env-vars`; `--port` is the only lever. `NEXTAUTH_URL` is optional —
`auth.config.ts` sets `trustHost: true`.

## 8. Verify

```bash
export URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format='value(status.url)')

curl -s "$URL/api/health"          # {"ok":true,...} — real DB probe, use as the health check
curl -si "$URL/login" | head -1    # HTTP/2 200
```

Secrets are really mounted (the Dockerfile's runtime sentinels fail `lib/env.ts`, so a failed
mount crashloops rather than booting with placeholders — a Ready revision is itself evidence):

```bash
REV=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format='value(status.latestReadyRevisionName)')
gcloud run revisions describe $REV --region=$REGION --format=json \
  | jq '.spec.containers[0].env[] | {name, hasSecret: (.valueFrom != null), value}'
```

### Outbound email safety — three independent proofs

**1. Config landed as exact strings.** `route.ts` tests `=== 'false'`, so a missing var,
`False`, or `0` all mean *enabled*.

```bash
gcloud run revisions describe $REV --region=$REGION --format=json \
  | jq -r '.spec.containers[0].env[] | select(.name|test("EMAIL_SEND_DRY_RUN|SEQUENCE_AUTOSEND_ENABLED|EMAIL_HEALTH_AUTOPAUSE")) | "\(.name)=\(.value)"'
```

**2. Behavioural — the one that matters.** `app/api/cron/sequence-engine/route.ts` is the only
path that can send without a worker: it calls `EmailService.send()` directly and **never
consults `EMAIL_SEND_DRY_RUN`** (that flag only gates `workers/email.ts`).
`SEQUENCE_AUTOSEND_ENABLED=false` is the load-bearing guard, and the route is reachable by any
logged-in director/floor_manager/team_lead, not just cron.

```bash
CRON=$(gcloud secrets versions access latest --secret=CRON_SECRET)
curl -s -H "Authorization: Bearer $CRON" "$URL/api/cron/sequence-engine"
```

Must return exactly `{"disabled":true,"sent":0}`. Anything with `"sent":` but no
`"disabled":true` means the guard is off — stop before anyone logs in.

**3. Structural — the strongest.** The seed deletes every `EmailAccount` and creates none.
`EmailService.fromAccount()` is the sole entry point to every send adapter, so with zero
`EmailAccount` rows no credential exists that could authenticate an outbound send. Confirm
`GOOGLE_CLIENT_ID` / `MICROSOFT_CLIENT_ID` are absent from the revision env too — without
them the OAuth connect routes return 400 and no mailbox can be attached mid-demo.

`/email-health` is therefore empty by design. Demo the empty state or skip it; populating it
requires real OAuth, which is exactly what the safety posture forbids.

### Automated post-deploy gate

```bash
BASE_URL="$URL" E2E_PASSWORD=<password> npx playwright test
```

`e2e/deep-smoke.spec.ts` drives all 6 personas across every permitted route and fails on any
5xx, uncaught exception, console error, or silent redirect, plus role gates and the safety
guard above. Re-run it after every redeploy.

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `gcloud services enable` → "Service name is invalid" | short names used | full `*.googleapis.com` names |
| "Service account …-compute@… does not exist" | `compute.googleapis.com` not enabled | enable, wait ~2 min |
| Build 403s instantly | missing `roles/cloudbuild.builds.builder` | section 1; fallback add `roles/storage.admin` + `roles/artifactregistry.writer` |
| Build dies ~10 min, status `TIMEOUT` | default Cloud Build timeout | `--timeout=30m` |
| "Ineffective mark-compacts near heap limit" | build heap | raise `HEAP_MB` in `scripts/build.cjs` |
| Deploy: `secretmanager.versions.access` denied | missing per-secret binding | section 4 loop |
| Revision fails: `ENCRYPTION_KEY must be 64 hex chars` | CRLF in the secret | `… \| wc -c` → 65; recreate with `printf '%s'` from Cloud Shell |
| Revision fails: `AUTH_SECRET is required` | secret mount failed — sentinels working as designed | fix the mount |
| Migrate job: `Can't reach database server` | `--set-cloudsql-instances` missing on the *job*, or no `roles/cloudsql.client` | add both; check `$ICN` |
| Migrate job: `permission denied for schema public` | PG15+ schema ownership | `gcloud sql connect $DB_INSTANCE --user=postgres --database=$DB_NAME` → `GRANT ALL ON SCHEMA public TO crm_user;` |
| Migrate job: `Environment variable not found: DIRECT_URL` | `directUrl` unsatisfied | mount `DIRECT_URL` on every job |
| Login page loads, submit → 500 | migration job did not run | check its execution status |
| Login works, dashboard empty | signed in as a created account, not a seeded one | use `dean@telestar.vn` |
| Lead import > 2000 rows → 503 | working as designed (`INLINE_IMPORT_MAX_ROWS`) | use a smaller file |

## 10. Cost control and rollback

```bash
gcloud run services update $SERVICE_NAME --region=$REGION --min-instances=0
gcloud sql instances patch $DB_INSTANCE --activation-policy=NEVER   # storage-only billing
gcloud run services update $SERVICE_NAME --region=$REGION --no-allow-unauthenticated

# roll back a bad revision without deleting anything
gcloud run revisions list --service=$SERVICE_NAME --region=$REGION
gcloud run services update-traffic $SERVICE_NAME --region=$REGION --to-revisions=<REV>=100

gcloud projects delete $PROJECT_ID    # ends billing on everything at once
```
