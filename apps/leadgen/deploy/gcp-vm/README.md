# GCP single-VM deployment runbook (TeleStar SDR OS V2)

Migrate the V2 stack off AWS onto one Google Compute Engine VM in **asia-southeast1** (Singapore),
using the $300 trial credit (target spend ≤ $150). The app image is **built in CI and pushed to
GHCR** (`.github/workflows/docker-image.yml`); the VM only **pulls** it — no build on the box.
Postgres + Redis run as **containers on the VM** (no Cloud SQL / Memorystore). Real data is copied
from the old RDS. TLS is free via Caddy + a `sslip.io` hostname.

> Deploy/config only — no app, schema, or V1 changes. Postgres/Redis ports are **never** published
> to the host; the DB is not reachable from the internet.

## Cost sketch (90-day trial)
- e2-medium (4GB) the whole time ~$27/mo → ~$81
- 50GB pd-balanced ~$5/mo → ~$15 · static IP (in-use) ~$3/mo → ~$9 · egress ~$5
- **≈ $110 total — under $150.** GHCR (private) build+pull is free. Check anytime: Billing → Reports.

---

## 0. One-time prerequisites (local machine)
- `gcloud` CLI installed + `gcloud init` (log in, pick the trial project).
- Enable the API: `gcloud services enable compute.googleapis.com`
- Have the **old AWS `.env.production`** handy — you must reuse `V2_OUTREACH_CREDENTIAL_KEY`.
- A GitHub **classic PAT** scoped **`read:packages` only** (for the VM to pull the private image).

## 1. Reserve the static IP FIRST
The IP's dashed form becomes the public hostname, and `NEXT_PUBLIC_APP_URL` is baked into the image
at CI build time — so you need the IP before triggering the build.
```bash
gcloud compute addresses create telestar-v2-ip --region=asia-southeast1
gcloud compute addresses describe telestar-v2-ip --region=asia-southeast1 --format='value(address)'
# e.g. 34.124.1.2  ->  APP_DOMAIN=34-124-1-2.sslip.io  ->  origin https://34-124-1-2.sslip.io
```

## 2. Build the image in CI (GitHub → GHCR)
The image origin is baked in at build time, so set the variable, THEN build.
1. GitHub → repo **Settings → Secrets and variables → Actions → Variables** → set
   `NEXT_PUBLIC_APP_URL = https://<ip-dashes>.sslip.io`.
2. Run the build: **Actions → "Docker image" → Run workflow** (branch `feature/shared-types`), or
   just push to that branch.
3. In the run log / **Packages**, note the pushed tags:
   `ghcr.io/brandng/telestar-company-filter:<long-sha>` (+ `:feature-shared-types`, `:latest`).
   Use the `<long-sha>` as `APP_IMAGE_TAG` on the VM for a pinned deploy.

## 3. Create the VM + firewall
```bash
gcloud compute instances create telestar-v2 \
  --zone=asia-southeast1-a \
  --machine-type=e2-medium \
  --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=50GB --boot-disk-type=pd-balanced \
  --address=telestar-v2-ip \
  --tags=telestar-web

gcloud compute firewall-rules create telestar-web \
  --allow=tcp:80,tcp:443 --target-tags=telestar-web --source-ranges=0.0.0.0/0
# SSH is available via `gcloud compute ssh` (IAP/OS Login); no need to open 22 to the world.
```

## 4. Install Docker + log in to GHCR (on the VM)
```bash
gcloud compute ssh telestar-v2 --zone=asia-southeast1-a
# on the VM:
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"          # then log out / back in
echo <READ_PACKAGES_PAT> | docker login ghcr.io -u <github-username> --password-stdin
```

## 5. Get the compose files + env onto the VM
Only the `deploy/gcp-vm/` files are needed (no build context, no full source required to run):
```bash
# on the VM
git clone https://github.com/BrandNg/telestar-company-filter.git
cd telestar-company-filter/deploy/gcp-vm

cp .env.production.example .env.production
# Edit .env.production:
#   - APP_BASE_URL / APP_URL = https://<ip-dashes>.sslip.io  (NEXT_PUBLIC is already in the image)
#   - generate V2_AUTH_SECRET, V2_WORKER_SECRET
#   - V2_OUTREACH_CREDENTIAL_KEY  <-- COPY VERBATIM from the old AWS .env.production
#   - carry over any AI/search keys you use
```
Set the two shell vars the compose file reads (add to `~/.bashrc` to persist):
```bash
export APP_DOMAIN=34-124-1-2.sslip.io                 # Caddy cert hostname
export APP_IMAGE_TAG=<long-sha-from-step-2>            # or leave unset to use :latest
```

## 6. Migrate the database (RDS → postgres container)
From a machine that can still reach RDS (the old AWS box is easiest):
```bash
pg_dump --format=custom --no-owner --no-acl "$RDS_DATABASE_URL" > telestar.dump
```
Copy it to the VM and restore:
```bash
gcloud compute scp telestar.dump telestar-v2:~/telestar-company-filter/deploy/gcp-vm/ --zone=asia-southeast1-a

# on the VM:
cd ~/telestar-company-filter/deploy/gcp-vm
docker compose up -d postgres
docker compose ps                          # wait until postgres is healthy
docker compose exec -T postgres pg_restore --no-owner --no-acl -U telestar -d telestar < telestar.dump

# confirm schema state travelled (should list 54 rows):
docker compose exec postgres psql -U telestar -d telestar -c 'select count(*) from "_prisma_migrations";'
```
Redis data is ephemeral queue state — nothing to migrate.

## 7. Pull + boot the full stack
```bash
cd ~/telestar-company-filter/deploy/gcp-vm
docker compose pull                # fetch the GHCR image for web/worker/imap/migrate
docker compose run --rm migrate    # no-op if the restore already applied all 54 migrations
docker compose up -d               # web -> healthy -> caddy gets LE cert -> worker + imap start
docker compose ps
docker compose logs -f caddy       # watch for successful certificate issuance
```

## 8. Verify
```bash
curl -I https://<ip-dashes>.sslip.io/v2/login          # 200/3xx, valid TLS
curl -s https://<ip-dashes>.sslip.io/api/health         # 200 => web + DB OK
```
- Log in in a browser; confirm migrated orgs / leads / companies render.
- Trigger one ingestion upload + one scoring run; confirm the worker processes it
  (`docker compose logs -f worker`).
- Spot-check research + CRM surfaces (from the 31/7 merge).

## 9. Backups + AWS decommission
```bash
# daily snapshot schedule on the VM disk, keep 7 days
gcloud compute resource-policies create snapshot-schedule telestar-daily \
  --region=asia-southeast1 --max-retention-days=7 \
  --daily-schedule --start-time=18:00
gcloud compute disks add-resource-policies telestar-v2 \
  --zone=asia-southeast1-a --resource-policies=telestar-daily
```
Optional belt-and-suspenders — nightly `pg_dump` to the disk via cron.

Once GCP has run clean for ~a day:
1. Take a FINAL RDS snapshot (keep it until fully confident).
2. Stop/delete AWS EC2, RDS, ElastiCache to halt billing.

## Redeploy (after any code change)
```bash
# 1. push to feature/shared-types  ->  docker-image.yml rebuilds + pushes a new :<sha>
# 2. on the VM:
cd ~/telestar-company-filter/deploy/gcp-vm
export APP_IMAGE_TAG=<new-sha>     # or keep :latest
docker compose pull && docker compose run --rm migrate && docker compose up -d
```

## Operations cheatsheet
```bash
cd ~/telestar-company-filter/deploy/gcp-vm
docker compose ps                 # status
docker compose logs -f web        # app logs
docker compose restart web        # restart a service
```

## Gotchas
- **`NEXT_PUBLIC_APP_URL` is baked into the image at CI build.** Set the Actions variable to the
  final sslip origin BEFORE running the workflow; changing the hostname later needs a rebuild.
- **Never map 5432/6379 to the host** — this compose intentionally omits those port mappings.
- **`V2_OUTREACH_CREDENTIAL_KEY` must match AWS** on a data migration, or stored sender credentials
  can't be decrypted and sending fails closed.
- **Private GHCR pull** needs `docker login ghcr.io` with a `read:packages` PAT on the VM (step 4).
- `docker-image.yml` also triggers on every push to `feature/shared-types`. Pin `APP_IMAGE_TAG=<sha>`
  on the VM if you want deploys decoupled from every push.
