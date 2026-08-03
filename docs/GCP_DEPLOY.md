# GCP Docker Deployment Runbook — Telestar SDR CRM

This document guides step-by-step deployment of Telestar SDR CRM onto **Google Cloud Platform (GCP)** using **Compute Engine (GCE)**, **Cloud SQL (PostgreSQL 16)**, and **Memorystore for Redis**.

---

## Architecture Overview

| Component | GCP Service | Description |
| :--- | :--- | :--- |
| **Database** | Cloud SQL for PostgreSQL 16 | Production PostgreSQL database (`DATABASE_URL`, `DIRECT_URL`) |
| **Queue & Cache** | Memorystore for Redis | Shared Redis instance for BullMQ background workers (`REDIS_URL`) |
| **Application Host** | Compute Engine (GCE VM) | Runs Next.js Web App, BullMQ Worker, and Caddy reverse proxy via Docker |
| **TLS & Security** | Caddy / Cloud DNS | Automatic HTTPS certificate provisioning and security headers |

---

## Phase 1: Resource Provisioning via GCP CloudShell

Open [Google Cloud Shell](https://shell.cloud.google.com) in your GCP Console.

### Step 1.1: Set Project & Enable APIs
```bash
# Set your GCP Project ID
gcloud config set project YOUR_PROJECT_ID

# Set preferred deployment region (e.g., asia-southeast1, us-central1)
export REGION="asia-southeast1"

# Enable required Google Cloud APIs
gcloud services enable compute.googleapis.com sqladmin.googleapis.com redis.googleapis.com secretmanager.googleapis.com
```

### Step 1.2: Create Cloud SQL PostgreSQL Database
```bash
# Generate a strong password for DB user
export DB_PASSWORD=$(openssl rand -base64 18)
echo "DB Password: $DB_PASSWORD"

# Create PostgreSQL 16 Instance
gcloud sql instances create telestar-db \
    --database-version=POSTGRES_16 \
    --cpu=2 --memory=4GiB \
    --region=$REGION \
    --root-password="$DB_PASSWORD"

# Create database and user
gcloud sql databases create telestar_crm --instance=telestar-db
gcloud sql users create crm --instance=telestar-db --password="$DB_PASSWORD"

# Get Cloud SQL Public IP address
gcloud sql instances describe telestar-db --format="value(ipAddresses[0].ipAddress)"
```

### Step 1.3: Create Redis Instance
```bash
gcloud redis instances create telestar-redis \
    --size=1 --region=$REGION \
    --redis-version=redis_7_0

# Get Redis IP address
gcloud redis instances describe telestar-redis --region=$REGION --format="value(host)"
```

### Step 1.4: Create Compute Engine VM
```bash
gcloud compute instances create telestar-crm-vm \
    --zone=${REGION}-a \
    --machine-type=e2-standard-2 \
    --image-family=ubuntu-2204-lts \
    --image-project=ubuntu-os-cloud \
    --tags=http-server,https-server

# Get VM External IP
gcloud compute instances describe telestar-crm-vm --zone=${REGION}-a --format="value(networkInterfaces[0].accessConfigs[0].natIP)"
```

---

## Phase 2: Host Environment Setup (on GCE VM)

### Step 2.1: SSH into GCE VM
From GCP CloudShell, run:
```bash
gcloud compute ssh telestar-crm-vm --zone=${REGION}-a
```

### Step 2.2: Install Docker, Docker Compose, & Node.js
```bash
# Update packages & install Docker
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin git curl

# Add current user to docker group
sudo usermod -aG docker $USER
newgrp docker
```

---

## Phase 3: Application Setup & Secrets Configuration

### Step 3.1: Clone Codebase
```bash
cd /opt
sudo git clone https://github.com/YOUR_ORG/CRM-4-Telestar-Final.git crm-4-u
sudo chown -R $USER:$USER /opt/crm-4-u
cd /opt/crm-4-u
```

### Step 3.2: Generate Production Secrets
Generate 3 distinct secret keys:
```bash
# 1. AUTH_SECRET
openssl rand -base64 32

# 2. ENCRYPTION_KEY (64 hex characters)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. CRON_SECRET
openssl rand -hex 32
```

### Step 3.3: Create `.env.production`
Create `.env.production` on the VM (do not commit to Git):

```env
APP_ENV_FILE=.env.production
IMAGE_TAG=latest
CRM_DOMAIN=YOUR_VM_EXTERNAL_IP_OR_DOMAIN
CADDY_SITE_ADDRESS=:80
NEXTAUTH_URL=http://YOUR_VM_EXTERNAL_IP_OR_DOMAIN

DATABASE_URL="postgresql://crm:YOUR_DB_PASSWORD@YOUR_CLOUD_SQL_IP:5432/telestar_crm?schema=public&sslmode=require"
DIRECT_URL="postgresql://crm:YOUR_DB_PASSWORD@YOUR_CLOUD_SQL_IP:5432/telestar_crm?schema=public&sslmode=require"
REDIS_URL="redis://YOUR_REDIS_IP:6379"

AUTH_SECRET=YOUR_AUTH_SECRET
ENCRYPTION_KEY=YOUR_ENCRYPTION_KEY
CRON_SECRET=YOUR_CRON_SECRET

EMAIL_SEND_DRY_RUN=true
SEQUENCE_AUTOSEND_ENABLED=false
```

---

## Phase 4: Database Migration & Deployment

### Step 4.1: Run Database Migrations
```bash
npm ci
npx prisma migrate deploy
```

### Step 4.2: Create Director Admin User
```bash
npm run create-admin -- --email director@yourdomain.com --password 'YourStrongPassword123!' --name 'Director Name'
```

### Step 4.3: Build & Launch Docker Services
```bash
npm run prod:check-env
docker compose -f docker-compose.yml -f docker-compose.aws.yml -f docker-compose.build.yml --env-file .env.production build web worker
docker compose -f docker-compose.yml -f docker-compose.aws.yml -f docker-compose.build.yml --env-file .env.production up -d
```

### Step 4.4: Verify Deployment Status
```bash
docker compose -f docker-compose.yml -f docker-compose.aws.yml -f docker-compose.build.yml --env-file .env.production ps
npm run worker:healthcheck
npm run prod:audit
```

---

## Safety Guidelines

1. **Never run `npm run db:seed` in production** (it overwrites data with test defaults).
2. **Keep `EMAIL_SEND_DRY_RUN=true`** until production smoke tests pass.
3. Check container logs using `docker compose logs --tail=100 web worker caddy`.
