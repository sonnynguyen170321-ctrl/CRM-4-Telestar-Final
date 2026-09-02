# AWS Console setup — step by step (EC2 + RDS + ElastiCache)

Manual, click-by-click bring-up of the single-host deployment, with **no Terraform and no
CI**. The image is built **on the box**, so there is no ECR/S3/OIDC to configure. Once this
is running you can graduate to `terraform/` + `deploy-ec2.yml` (see the last section).

Field names below match the AWS Console exactly. Anything marked ⚠️ is a step that silently
breaks the deploy if you skip it.

**End state**

```
Internet ──80/443──> EC2 (Elastic IP, public subnet)
                       └─ docker compose: caddy → web:3000
                                          worker (BullMQ)   imap (poller)
                       │5432                     │6379
                       ▼                         ▼
                  RDS Postgres 16         ElastiCache Redis 7   (private subnets)
```

**Before you start**

- Set the Console **Region to `ap-southeast-1` (Singapore)** — top-right dropdown. Every
  resource below must live in the same region, or they cannot talk to each other.
- Rough cost: ~$70–90/month (t3.medium + db.t4g.small + cache.t4g.micro).
- Total time: ~40 min, most of it waiting for RDS to finish creating.

---

## 1. Network (VPC)

Use the wizard — it builds the subnets, internet gateway, and route tables in one shot.

**VPC → Create VPC**

| Field | Value |
| --- | --- |
| Resources to create | **VPC and more** |
| Name tag auto-generation | `telestar-prod` |
| IPv4 CIDR block | `10.20.0.0/16` |
| IPv6 CIDR block | No IPv6 CIDR block |
| Tenancy | Default |
| Number of Availability Zones (AZs) | **2** |
| Number of public subnets | **2** |
| Number of private subnets | **2** |
| NAT gateways | ⚠️ **None** |
| VPC endpoints | **None** |
| Enable DNS hostnames | ✅ |
| Enable DNS resolution | ✅ |

→ **Create VPC**.

> ⚠️ **NAT gateways = None** is deliberate and saves ~$32/month. The EC2 host sits in a
> *public* subnet and reaches the internet through the internet gateway. RDS and ElastiCache
> need no outbound internet at all.
>
> You need **2 AZs** because RDS and ElastiCache subnet groups both require at least two.

---

## 2. Security groups

**EC2 → Network & Security → Security Groups → Create security group.** Create the EC2 one
**first** — the other two reference it.

### 2a. `telestar-prod-ec2` (the app host)

- Description: `App host: web ingress`
- VPC: `telestar-prod-vpc`
- **Inbound rules:**

| Type | Port | Source |
| --- | --- | --- |
| HTTP | 80 | `0.0.0.0/0` (Anywhere-IPv4) |
| HTTPS | 443 | `0.0.0.0/0` (Anywhere-IPv4) |

- **Outbound rules:** leave the default *All traffic → 0.0.0.0/0*.

> Port 80 is required — Caddy uses it for the Let's Encrypt HTTP-01 challenge. Without it you
> get no certificate.
>
> There is **no SSH (22) rule on purpose**. You get a shell via SSM Session Manager (step 5+6),
> which needs no open port and no key pair. To restrict access to your office, replace
> `0.0.0.0/0` with your public IP as `x.x.x.x/32` on both rules.

### 2b. `telestar-prod-rds`

- VPC: `telestar-prod-vpc`
- **Inbound:** Type `PostgreSQL`, Port `5432`, Source → **Custom** → pick the security group
  **`telestar-prod-ec2`** (⚠️ the security group, *not* a CIDR).

### 2c. `telestar-prod-redis`

- VPC: `telestar-prod-vpc`
- **Inbound:** Type `Custom TCP`, Port `6379`, Source → **Custom** → `telestar-prod-ec2`.

> Sourcing from a security group (not an IP range) is what keeps the database and cache
> reachable *only* from the app host, even as its IP changes.

---

## 3. RDS PostgreSQL

### 3a. Subnet group (do this first)

**RDS → Subnet groups → Create DB subnet group**

- Name: `telestar-prod-db`
- VPC: `telestar-prod-vpc`
- Availability Zones: pick **both** AZs
- Subnets: ⚠️ select **only the two _private_ subnets** (`10.20.128.0/20`, `10.20.144.0/20`
  — the wizard names them `telestar-prod-subnet-private1-*` / `private2-*`)

> If you let RDS auto-create a subnet group it will include the public subnets, which would
> allow the database to be exposed. Pre-creating it with private subnets only prevents that.

### 3b. The database

**RDS → Databases → Create database**

| Field | Value |
| --- | --- |
| Choose a database creation method | **Standard create** |
| Engine type | **PostgreSQL** |
| Engine version | **16.x** (latest 16) |
| Templates | **Dev/Test** |
| Availability and durability | **Single DB instance** |
| DB instance identifier | `telestar-prod-pg` |
| Master username | `telestar` |
| Credentials management | **Self managed** |
| Master password | ⚠️ generate a strong one and **save it** — you need it in step 8 |
| DB instance class | Burstable classes → **db.t4g.small** |
| Storage type | **gp3** |
| Allocated storage | `20` GiB |
| Enable storage autoscaling | ✅ (max 100 GiB) |
| Compute resource | **Don't connect to an EC2 compute resource** |
| VPC | `telestar-prod-vpc` |
| DB subnet group | `telestar-prod-db` |
| Public access | ⚠️ **No** |
| VPC security group | **Choose existing** → `telestar-prod-rds` (remove `default`) |
| Database authentication | Password authentication |
| **Additional configuration → Initial database name** | ⚠️ `telestar` |
| Backup retention | 7 days |
| Encryption | ✅ Enable |

→ **Create database**. Takes ~5–10 min.

> ⚠️ **Initial database name** is the classic trap: leave it blank and RDS creates a *server*
> with **no database in it**, and Prisma fails with `database "telestar" does not exist`. It
> is under the collapsed *Additional configuration* panel (not the *Additional configuration*
> at the very bottom).

When it shows **Available**, copy the **Endpoint** (e.g.
`telestar-prod-pg.abc123.ap-southeast-1.rds.amazonaws.com`).

---

## 4. ElastiCache Redis

**ElastiCache → Redis OSS caches → Create Redis OSS cache**

| Field | Value |
| --- | --- |
| Deployment option | **Design your own cache** |
| Creation method | **Cluster cache** |
| Cluster mode | **Disabled** |
| Cluster info → Name | `telestar-prod-redis` |
| Location | AWS Cloud |
| Multi-AZ | ☐ disabled |
| Auto-failover | ☐ disabled |
| Engine version | **7.x** |
| Node type | **cache.t4g.micro** |
| Number of replicas | **0** |
| Subnet groups | **Create a new subnet group** → VPC `telestar-prod-vpc` → ⚠️ select the **two private subnets** |
| Security → Encryption in transit | ⚠️ **disabled** |
| Selected security groups | **Manage** → `telestar-prod-redis` (remove `default`) |

→ **Create**. Takes ~5 min.

> ⚠️ Leave **encryption in transit disabled**. If you enable it, Redis only accepts TLS and
> your URL must be `rediss://` (two s) — plain `redis://` will hang. Traffic stays inside the
> private VPC either way.

When **Available**, copy the **Primary endpoint** — use the **host only**, without the
`:6379` suffix the console appends.

---

## 5. IAM role for the instance

**IAM → Roles → Create role**

- Trusted entity type: **AWS service**
- Use case: **EC2** → Next
- Permissions policies: search and tick **`AmazonSSMManagedInstanceCore`** → Next
- Role name: `telestar-prod-ec2` → **Create role**

> This is what gives you a browser shell via Session Manager. Without it the instance never
> registers with SSM and *Connect* stays greyed out.

---

## 6. EC2 instance

**EC2 → Instances → Launch instances**

| Field | Value |
| --- | --- |
| Name | `telestar-prod-app` |
| AMI | **Amazon Linux 2023** (x86_64) |
| Instance type | **t3.medium** |
| Key pair | **Proceed without a key pair** |

**Network settings → Edit:**

| Field | Value |
| --- | --- |
| VPC | `telestar-prod-vpc` |
| Subnet | ⚠️ one of the **public** subnets (`telestar-prod-subnet-public1-*`) |
| Auto-assign public IP | **Enable** |
| Firewall | **Select existing security group** → `telestar-prod-ec2` |

**Configure storage:** `30` GiB, **gp3**.

**Advanced details:**

- **IAM instance profile** → `telestar-prod-ec2`
- **User data** → paste:

```bash
#!/usr/bin/env bash
set -euxo pipefail
dnf update -y
dnf install -y docker git jq
systemctl enable --now docker
usermod -aG docker ec2-user || true
mkdir -p /usr/libexec/docker/cli-plugins
curl -fsSL https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-linux-x86_64 \
  -o /usr/libexec/docker/cli-plugins/docker-compose
chmod +x /usr/libexec/docker/cli-plugins/docker-compose
mkdir -p /opt/telestar
# 2 GiB swap: a t3.medium (4 GiB) can OOM during `next build`.
if [ ! -f /swapfile ]; then
  dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
echo "bootstrap done"
```

→ **Launch instance**.

> The swap file matters: building Next.js on a 4 GiB box is tight and an OOM kill mid-build is
> the most common failure here.

---

## 7. Elastic IP → your HTTPS hostname

**EC2 → Network & Security → Elastic IPs → Allocate Elastic IP address** → Allocate.

Select it → **Actions → Associate Elastic IP address** → Instance: `telestar-prod-app` → Associate.

Now derive your public hostname by **replacing the dots with dashes**:

```
Elastic IP : 13.250.1.2
APP_DOMAIN : 13-250-1-2.sslip.io
APP_URL    : https://13-250-1-2.sslip.io
```

> `sslip.io` is a public DNS service that resolves any `a-b-c-d.sslip.io` back to `a.b.c.d`.
> That gives Caddy a real hostname to obtain a genuine Let's Encrypt certificate for, so you
> get valid HTTPS with no domain purchase. Sessions are cookie-based, so real HTTPS matters.
> Swap in a real domain later by pointing an A record at this same IP.

---

## 8. Configure and deploy on the box

**EC2 → select `telestar-prod-app` → Connect → Session Manager → Connect.**

> If *Session Manager* is greyed out, wait ~2 min after launch (the agent must register), and
> re-check the IAM instance profile from step 6.

```bash
sudo su -
cd /opt/telestar
```

### 8a. Get the source

The repo is private, so use a GitHub **Personal Access Token** (github.com → Settings →
Developer settings → Tokens → *Fine-grained* → repo access → **Contents: Read-only**):

```bash
git clone https://<YOUR_TOKEN>@github.com/BrandNg/telestar-company-filter.git src
cd src
git checkout feature/shared-types
```

### 8b. Generate the three app secrets

```bash
echo "V2_AUTH_SECRET=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"
echo "V2_OUTREACH_CREDENTIAL_KEY=$(openssl rand -base64 32)"
echo "V2_WORKER_SECRET=$(openssl rand -hex 24)"
```

> The formats differ on purpose: `V2_AUTH_SECRET` is base64**url**, and
> `V2_OUTREACH_CREDENTIAL_KEY` must be **standard base64 of exactly 32 bytes** (it is the
> AES-256-GCM master key; a wrong length makes the credential loader fail closed and no email
> can ever send).

### 8c. Write the env file

⚠️ Set `APP_DOMAIN` / the three URLs to **your** sslip.io host, and paste **your** RDS
endpoint, RDS password, and ElastiCache endpoint.

```bash
cd /opt/telestar/src/deploy/aws-ec2
cat > .env.production <<'EOF'
NODE_ENV=production

DATABASE_URL=postgresql://telestar:<RDS_PASSWORD>@<RDS_ENDPOINT>:5432/telestar?schema=public
V2_DB_POOL_MAX=24

NEXT_PUBLIC_APP_URL=https://<APP_DOMAIN>
APP_BASE_URL=https://<APP_DOMAIN>
APP_URL=https://<APP_DOMAIN>

V2_AUTH_SECRET=<from 8b>
V2_AUTH_COOKIE_NAME=v2_session
V2_AUTH_SESSION_DAYS=14

V2_BULL_ENABLED=true
REDIS_URL=redis://<ELASTICACHE_ENDPOINT>:6379
V2_BULL_PREFIX=telestar:v2

V2_WORKER_SECRET=<from 8b>
V2_WORKER_APP_URL=http://web:3000
V2_WORKER_INTERVAL_MS=15000

V2_OUTREACH_CREDENTIAL_KEY=<from 8b>
V2_IMAP_POLL_INTERVAL_MS=60000

AI_ENABLED=false
COMPANY_INTEL_SEARCH_ENABLED=false
EOF
chmod 600 .env.production
```

### 8d. Build the image

⚠️ `NEXT_PUBLIC_APP_URL` is compiled **into** the bundle at build time, so it must be the
final URL *now*.

```bash
cd /opt/telestar/src
docker build --build-arg NEXT_PUBLIC_APP_URL=https://<APP_DOMAIN> -t telestar-v2:local .
```

Takes ~5–10 min.

### 8e. Point compose at the local image

```bash
cd /opt/telestar/src/deploy/aws-ec2
cat > .env <<EOF
APP_IMAGE=telestar-v2:local
APP_DOMAIN=<APP_DOMAIN>
EOF
```

> Two different files, on purpose: `.env` feeds compose's `${...}` substitution (which image,
> which hostname); `.env.production` is the app's runtime environment.

### 8f. Migrate, then start

```bash
docker compose run --rm migrate          # prisma migrate deploy — must succeed first
docker compose up -d web worker imap caddy
docker compose ps
```

---

## 9. Verify

```bash
curl -s https://<APP_DOMAIN>/api/health
# {"status":"ok","service":"telestar-company-filter","timestamp":"...","database":"ok"}
```

`"database":"ok"` proves web is up **and** RDS is reachable, over a real certificate.

```bash
# BullMQ worker registered its queues against ElastiCache:
docker compose logs worker | grep "workers listening"

# Ops health: db + redis + a live worker heartbeat
curl -s -H "x-v2-worker-secret: <V2_WORKER_SECRET>" https://<APP_DOMAIN>/v2/runtime/health
```

Then open `https://<APP_DOMAIN>` in a browser, sign in, and upload a small CSV — the worker
should drain the ingestion and leads should appear.

---

## 10. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Caddy never gets a cert; browser shows a TLS error | Port 80 not open to `0.0.0.0/0` (needed for ACME), or the Elastic IP isn't associated. `docker compose logs caddy`. |
| `database "telestar" does not exist` | Step 3b **Initial database name** was left blank. Create it: `docker compose run --rm migrate` won't fix this — connect and `CREATE DATABASE telestar;` or recreate the RDS instance. |
| Migrate/web hangs, then connection timeout to RDS | `telestar-prod-rds` inbound source isn't the `telestar-prod-ec2` **security group**, or RDS landed in the wrong VPC. |
| Worker logs Redis `ETIMEDOUT` / hangs | Redis SG rule missing, or **encryption in transit** got enabled → needs `rediss://`. |
| `docker build` killed / exit 137 | OOM. Confirm swap: `swapon --show`. Re-run the user-data swap block if empty. |
| Session Manager greyed out | IAM instance profile missing `AmazonSSMManagedInstanceCore`; attach it, then reboot. |
| Login redirects or session drops | The three URL vars must all be the **https** sslip.io origin, and `V2_AUTH_SECRET` must be set. |

**Redeploy after a code change:**

```bash
cd /opt/telestar/src && git pull
docker build --build-arg NEXT_PUBLIC_APP_URL=https://<APP_DOMAIN> -t telestar-v2:local .
cd deploy/aws-ec2
docker compose run --rm migrate
docker compose up -d
```

---

## 11. Graduating to Terraform + CI

This manual path intentionally skips ECR, S3, Secrets Manager, the GitHub OIDC role, and
SSM-driven deploys. When you want builds off the box and one-click deploys, `terraform/`
provisions all of the above and `.github/workflows/deploy-ec2.yml` drives it — see
[README.md](./README.md). The app, compose file, and Caddyfile are identical; only how the
image is built and how env is delivered change.

> Don't run `terraform apply` against the resources you created here — it would create a
> second, parallel stack. Either tear this down first, or `terraform import` it.
