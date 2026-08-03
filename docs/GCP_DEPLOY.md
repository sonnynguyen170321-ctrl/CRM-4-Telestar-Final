# GCP Deployment Runbook — Telestar SDR CRM

Deploys the CRM to **Google Compute Engine** with Docker Compose and Caddy: the Next.js web
app **and** the BullMQ worker, backed by **Cloud SQL for PostgreSQL 16**, with automatic
HTTPS. This is the full production topology.

> **Which GCP runbook do I want?**
> - **This file** — GCE VM + Compose + Caddy. Runs `workers/index.ts`, so email, sequences,
>   import, inbox sync, notifications and maintenance all actually execute.
> - **`CLOUD_RUN_DEPLOY.md`** — Cloud Run + Cloud SQL. Serverless and cheaper, but it
>   **cannot host the worker**; imports fall back to an inline path and the rest of the
>   worker layer is simply absent. Demo-shaped only.

## Architecture

| Component | Service | Notes |
|---|---|---|
| Database | Cloud SQL for PostgreSQL 16 | External by requirement — `scripts/prod-check-env.ts` rejects a DB host of `localhost`/`127.0.0.1`/`::1`/`postgres`, and `docker-compose.aws.yml` disables the compose-local postgres via a profile |
| Queue & cache | Redis 7 container on the VM | `docker-compose.yml` already runs it healthchecked with an appendonly volume. Memorystore is optional and **not** used here — see "Optional: Memorystore" |
| App host | GCE VM (`e2-standard-2`, Ubuntu 22.04) | Web + worker + redis + Caddy via Docker Compose |
| TLS | Caddy 2 | Automatic Let's Encrypt certificate, triggered by setting `CADDY_SITE_ADDRESS` to a bare hostname |

**Everything below runs in [Google Cloud Shell](https://shell.cloud.google.com), not local
PowerShell.** PowerShell writes CRLF into piped values; a trailing `\r` makes `ENCRYPTION_KEY`
65 characters, fails the `/^[0-9a-f]{64}$/i` check in `lib/env.ts`, and crashloops the
container with an error that looks like a bad key rather than a bad newline.

## What you need first

- A GCP project with **billing linked** (API enablement fails otherwise)
- A **domain you control** and can add an A record to. No domain? See "IP mode" at the end
- The repository URL

---

## Phase 1 — Project, APIs, static IP, firewall

```bash
export PROJECT_ID=<your-project-id>
export CRM_DOMAIN=<crm.yourcompany.com>
export REGION=asia-southeast1
export ZONE=${REGION}-a

export VM_NAME=telestar-crm-vm
export DB_INSTANCE=telestar-db
export DB_NAME=telestar_crm
export DB_USER=crm
export ADDR_NAME=telestar-crm-ip

gcloud config set project "$PROJECT_ID"
gcloud services enable compute.googleapis.com sqladmin.googleapis.com
```

Reserve a **static** address. An ephemeral IP changes whenever the VM stops, which silently
breaks the DNS A record and the Cloud SQL authorized-network entry at the same time:

```bash
gcloud compute addresses create "$ADDR_NAME" --region="$REGION"
export STATIC_IP=$(gcloud compute addresses describe "$ADDR_NAME" --region="$REGION" --format='value(address)')
echo "STATIC_IP=$STATIC_IP"     # needed for the DNS record in Phase 4
```

The VM below is tagged `http-server,https-server`, which only means anything if the matching
firewall rules exist. They ship with the default VPC but not with every project:

```bash
gcloud compute firewall-rules describe default-allow-http >/dev/null 2>&1 || \
  gcloud compute firewall-rules create default-allow-http \
    --allow=tcp:80 --target-tags=http-server --source-ranges=0.0.0.0/0
gcloud compute firewall-rules describe default-allow-https >/dev/null 2>&1 || \
  gcloud compute firewall-rules create default-allow-https \
    --allow=tcp:443 --target-tags=https-server --source-ranges=0.0.0.0/0
```

Port 80 must stay open even after TLS works — Caddy renews certificates over it.

---

## Phase 2 — Cloud SQL

```bash
# Alphanumeric only. A raw / + or = in the password corrupts the postgres:// URL
# unless percent-encoded, and the failure surfaces as an unrelated auth error.
export DB_PASSWORD=$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 32)
echo "DB_PASSWORD=$DB_PASSWORD"     # SAVE THIS — it is not recoverable later

gcloud sql instances create "$DB_INSTANCE" \
  --database-version=POSTGRES_16 \
  --cpu=2 --memory=4GiB \
  --region="$REGION" \
  --root-password="$DB_PASSWORD"

gcloud sql databases create "$DB_NAME" --instance="$DB_INSTANCE"
gcloud sql users create "$DB_USER" --instance="$DB_INSTANCE" --password="$DB_PASSWORD"

export DB_IP=$(gcloud sql instances describe "$DB_INSTANCE" --format='value(ipAddresses[0].ipAddress)')
echo "DB_IP=$DB_IP"
```

**Authorize the VM.** A Cloud SQL instance with a public IP still refuses every connection
until the source address is allowlisted. Skipping this produces a connection timeout at
`prisma migrate deploy` with nothing useful in the logs:

```bash
gcloud sql instances patch "$DB_INSTANCE" --authorized-networks="$STATIC_IP/32" --quiet
```

---

## Phase 3 — VM

```bash
gcloud compute instances create "$VM_NAME" \
  --zone="$ZONE" \
  --machine-type=e2-standard-2 \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=50GB \
  --tags=http-server,https-server \
  --address="$STATIC_IP"
```

`--boot-disk-size=50GB` is deliberate. The 10 GB default cannot hold the Docker layer cache
for a Next.js production build; it fails partway through with a disk error that reads like a
build error.

---

## Phase 4 — DNS, then stop and wait

Add at your DNS provider:

```
A    <CRM_DOMAIN>    →    <STATIC_IP>
```

Then poll from Cloud Shell until it resolves:

```bash
until [ "$(dig +short "$CRM_DOMAIN" | tail -1)" = "$STATIC_IP" ]; do
  echo "waiting for DNS…"; sleep 20;
done; echo "DNS OK"
```

**Do not start the stack before this prints `DNS OK`.** Caddy requests a certificate the
moment it boots. If the record is not live the ACME challenge fails, Caddy retries, and you
can exhaust the Let's Encrypt failed-validation limit for that hostname — which then has to
time out before you can try again.

---

## Phase 5 — Host setup

```bash
gcloud compute ssh "$VM_NAME" --zone="$ZONE"
```

On the VM. **Node.js is not needed and is not installed** — migrations and seeding run inside
the application image, which already contains `prisma`, `@prisma/client` and `tsx` as runtime
dependencies:

Docker must come from Docker's own apt repository. Ubuntu ships `docker.io`, but **not**
`docker-compose-plugin` — and because apt aborts the whole transaction on one unknown
package, asking for both installs neither, leaving a confusing
`usermod: group 'docker' does not exist` as the only visible symptom. The v2 `docker compose`
subcommand every command below uses exists only in this package.

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
docker compose version
exit
```

`exit` is part of the block: Linux only reads group membership at login, so the new `docker`
group does not apply until you reconnect. Prefer this over `newgrp docker`, which opens a
sub-shell and silently swallows the remainder of a pasted block.

Reconnect with `gcloud compute ssh "$VM_NAME" --zone="$ZONE"`, confirm `docker ps` returns an
empty table rather than a socket permission error, then:

```bash
sudo mkdir -p /opt/crm-4-u && sudo chown -R $USER:$USER /opt/crm-4-u
git clone <REPO_URL> /opt/crm-4-u
cd /opt/crm-4-u
git log --oneline -1
```

---

## Phase 6 — Secrets and `.env.production`

Re-export `CRM_DOMAIN`, `DB_USER`, `DB_PASSWORD`, `DB_IP` and `DB_NAME` here — SSH does not
carry the Cloud Shell environment across.

```bash
AUTH_SECRET=$(openssl rand -base64 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)     # exactly 64 hex chars
CRON_SECRET=$(openssl rand -hex 32)
```

Start from the checked-in template (`cp .env.production.example .env.production`) and fill it
in, or generate it directly:

```bash
cat > .env.production <<EOF
APP_ENV_FILE=.env.production
IMAGE_TAG=latest

CRM_DOMAIN=${CRM_DOMAIN}
CADDY_SITE_ADDRESS=${CRM_DOMAIN}
NEXTAUTH_URL=https://${CRM_DOMAIN}

DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_IP}:5432/${DB_NAME}?schema=public&sslmode=require"
DIRECT_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_IP}:5432/${DB_NAME}?schema=public&sslmode=require"
BACKUP_DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_IP}:5432/${DB_NAME}?schema=public&sslmode=require"
REDIS_URL="redis://redis:6379"

AUTH_SECRET=${AUTH_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
CRON_SECRET=${CRON_SECRET}

EMAIL_SEND_DRY_RUN=true
SEQUENCE_AUTOSEND_ENABLED=false
EOF

chmod 600 .env.production
```

Three things here are load-bearing and easy to get wrong:

- **`CADDY_SITE_ADDRESS` is the bare hostname**, not `:80`. That single value is what makes
  Caddy provision TLS. `prod-check-env` then requires `NEXTAUTH_URL` to be `https://` and its
  hostname to equal `CRM_DOMAIN` exactly.
- **`BACKUP_DATABASE_URL` is required**, and all three DB URLs are asserted to share a
  hostname. Point it at the same instance unless you have a read replica.
- **The two email flags are enforced, not advisory.** `prod-check-env` fails on any other
  value. Both are fail-open in application code — `EMAIL_SEND_DRY_RUN` engages only on the
  literal `"true"`, `SEQUENCE_AUTOSEND_ENABLED` disables only on the literal `"false"` — so a
  typo means real mail goes out.

---

## Phase 7 — Build, gate, migrate, seed, launch

```bash
DC="docker compose -f docker-compose.yml -f docker-compose.aws.yml -f docker-compose.build.yml --env-file .env.production"
```

That overlay stack is what produces this topology: the base file defines all services, the
`aws` overlay disables local postgres and wires the external database, and the `build` overlay
builds `web`/`worker` from source instead of pulling a published image.

```bash
$DC build web worker          # 10–15 min on e2-standard-2
```

Validate the environment before anything touches the database. There is no Node on the host,
so the checker runs inside the image with the env file bind-mounted:

```bash
$DC run --rm --user root -v "$PWD/.env.production:/app/.env.production:ro" web npm run prod:check-env
```

`--user root` is required. The image runs as the `node` user (uid 1000) while
`.env.production` is mode 600 owned by your VM account (uid 1001), so a read-only bind mount
without it fails with `EACCES: permission denied, open '.env.production'`. Overriding the
container user keeps the file at 600 on disk rather than loosening its permissions.

Fix anything it reports before continuing. Then migrate, seed, and start:

> **`prod:check-env` validates URL *shape*, not credentials.** A wrong or empty database
> password still parses as a valid URL and passes. The first real credential test is
> `migrate deploy` below — a `P1000: Authentication failed` there means the password in
> `.env.production` and the one on the Cloud SQL user disagree. Resolve it by setting both
> to one known value:
> ```bash
> # on the VM — rewrite all three DSNs, then print the matching gcloud command
> NEWPW=$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 32)
> sed -i -E "s|(postgresql://crm:)[^@]*(@)|\1${NEWPW}\2|g" .env.production
> echo "gcloud sql users set-password crm --instance=$DB_INSTANCE --password='${NEWPW}'"
> ```
> Run the printed line in Cloud Shell, then retry. Note `P1000` means the server was reached
> and rejected the credentials — a genuine network/allowlist problem times out instead.

```bash
$DC run --rm web npx prisma migrate deploy
$DC run --rm web npm run db:seed
$DC up -d
$DC ps
```

> **`db:seed` is destructive.** It issues 17 unfiltered `deleteMany()` calls including
> `tenant` and `user`. It is safe here **only because this database was created empty minutes
> ago**. Never run it against a populated database. `package.json` also wires it to
> `prisma.seed`, so `prisma migrate dev` and `migrate reset` fire it automatically — use
> `migrate deploy` in production, as above, which does not.

Seeding creates the six role personas, all `@telestar.vn`, password `telestar2026`:
`dean` (director), `sonny`/`alayna` (floor_manager), `brandon` and six more (team_lead),
`lan.pham`/`david.miller`/`vy.hoang`/`carlos.reyes` (sdr), `dominic` (leadgen_manager),
`alex`/`priya` (leadgen). Change or disable these before any real use.

---

## Phase 8 — Verify

```bash
$DC ps                                    # web, worker, redis, caddy up; postgres absent by design
curl -sSI https://$CRM_DOMAIN/ | head -5  # 307 -> /login, valid cert, Via: 1.1 Caddy
curl -sS  https://$CRM_DOMAIN/api/health  # 200 with a db boolean — NOT 401
$DC logs --tail=50 worker
$DC exec -T web npm run worker:healthcheck
```

`/api/health` is the cheapest single check: it is excluded from the session proxy
(`proxy.ts`), runs `SELECT 1`, and returns a boolean. A 401 there means the image predates
that exclusion, i.e. you deployed stale code.

Then, from a workstation with the repo checked out:

```bash
BASE_URL=https://<CRM_DOMAIN> E2E_PASSWORD=telestar2026 npx playwright test \
  e2e/crm-journeys.spec.ts e2e/deep-smoke.spec.ts
```

`deep-smoke` includes the outbound-safety assertion: `GET /api/cron/sequence-engine` must
return `{disabled: true, sent: 0}`.

---

## Operations

**Logs**
```bash
$DC logs --tail=100 web worker caddy
```

**Redeploy after a code change**
```bash
cd /opt/crm-4-u && git pull
$DC build web worker
$DC run --rm web npx prisma migrate deploy    # only if migrations changed
$DC up -d
```

**Rollback**
```bash
$DC down            # containers only — Cloud SQL data and the caddy cert volume survive
```

**Tear down entirely**
```bash
gcloud compute instances delete "$VM_NAME" --zone="$ZONE"
gcloud sql instances delete "$DB_INSTANCE"
gcloud compute addresses delete "$ADDR_NAME" --region="$REGION"
```

---

## IP mode (no domain yet)

Supported, and validated as a distinct mode by `prod-check-env`. Skip Phase 4 and change
three values:

```
CRM_DOMAIN=<STATIC_IP>
CADDY_SITE_ADDRESS=:80
NEXTAUTH_URL=http://<STATIC_IP>
```

`prod-check-env` enforces the pairing both ways: `:80` requires `http://`, and a hostname
requires `https://`. You cannot mix them.

Understand the tradeoff: **no TLS means credentials cross the network in cleartext.** The app
also emits `Strict-Transport-Security` unconditionally, which is inert over plain HTTP but
becomes a trap if the same host is ever served over HTTPS with an invalid certificate. Use IP
mode for a throwaway internal demo, then cut over to a domain.

---

## Optional: Memorystore instead of the local Redis

Only worth it if you need queue state to survive VM loss. It costs money, requires the VM on
the same VPC, and — importantly — `docker-compose.aws.yml` disables the local `postgres`
service but **not** `redis`. Pointing `REDIS_URL` at Memorystore without further changes
leaves a redundant Redis container running that `web` and `worker` still `depends_on`. If you
go this route, also disable the `redis` service, or accept the idle container.

---

## Changes from the previous version of this runbook

The earlier revision could not be followed end to end. Recorded here so the same defects are
not reintroduced:

1. The `.env.production` template omitted `BACKUP_DATABASE_URL`, which `prod-check-env`
   requires — the env gate failed immediately. A checked-in `.env.production.example` now
   carries all 12 keys.
2. Phase 2 was titled "Install Docker, Docker Compose, & Node.js" but installed no Node, so
   the subsequent `npm ci` failed. Node is no longer needed at all.
3. Cloud SQL was created with a public IP but never had the VM authorized, so every DB
   connection was refused.
4. `npx prisma migrate deploy` ran on the host, where Prisma loads `.env` — not the
   `.env.production` that had just been written. It now runs inside the container.
5. Memorystore was provisioned while the compose-local Redis kept running and was still a
   `depends_on` target.
6. There was no seed step, so the deployment came up with an empty CRM and none of the six
   role personas.
7. `npm run worker:healthcheck` threw `MODULE_NOT_FOUND` — it calls `require('dotenv')`, which
   was not a declared dependency. `dotenv` is now in `dependencies`.
8. No static IP was reserved, so the external address changed on every VM stop and broke both
   DNS and the Cloud SQL allowlist.

Two more were found while running this runbook end to end against a live project, and are
fixed above:

9. `apt-get install docker.io docker-compose-plugin` installs **neither** — `docker-compose-plugin`
   is not in the Ubuntu archive, and apt aborts the whole transaction on an unknown package.
   Docker now comes from Docker's own apt repository.
10. The `prod:check-env` bind mount failed with `EACCES` because the image runs as uid 1000
    while the mode-600 env file is owned by uid 1001. The check now runs with `--user root`.

Also worth knowing: the repeated `WARN ... "POSTGRES_PASSWORD" variable is not set` lines are
expected noise. Compose interpolates the local `postgres` service block before deciding the
`aws` overlay profile disables it. They are harmless.
