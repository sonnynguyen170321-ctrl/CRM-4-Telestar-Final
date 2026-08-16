# Production Smoke Test Runbook

> **Authority:** See [`docs/PRODUCTION_STATE.md`](./PRODUCTION_STATE.md) for live environment state.  
> **Deploy Target:** Google Cloud Platform (GCE VM `telestar-crm-vm` + Cloud SQL PostgreSQL 16 + Caddy TLS).

---

## 1. Pre-Deployment Verification

On the VM (`/opt/crm-4-u`):
- Verify `.env.production` contains `DEPLOY_TARGET=gcp` and valid credentials.
- Run topology validation:
  ```bash
  npm run check:production-compose
  ```
- Run environment check:
  ```bash
  npm run prod:check-env
  ```
- Confirm outbound email safety guards:
  - `EMAIL_SEND_DRY_RUN=true`
  - `SEQUENCE_AUTOSEND_ENABLED=false`

---

## 2. Canonical Deployment

Deploy using the immutable digest runner:

```bash
cd /opt/crm-4-u
# Deploy exact image build for current commit
./scripts/deploy.sh $(git rev-parse HEAD)
```

This automatically:
1. Pulls the exact image from GHCR and verifies its `@sha256:...` digest.
2. Applies pending Prisma migrations using the new image container.
3. Swaps `web` and `worker` containers on the new digest.
4. Executes `./scripts/post-deploy-smoke.sh`.
5. Records the deployment entry in `deployments.ndjson`.

---

## 3. Post-Deploy Verification & Healthcheck

1. **Automated Smoke Test:**
   ```bash
   ./scripts/post-deploy-smoke.sh
   ```
2. **Worker Queue Proof:**
   ```bash
   npm run worker:healthcheck
   ```
   *(Must return status: `completed`)*
3. **Cron Health Probes:**
   ```bash
   /opt/crm-4-u/bin/cron-call.sh sequence-engine
   /opt/crm-4-u/bin/cron-call.sh inbox-sync
   /opt/crm-4-u/bin/cron-call.sh email-health
   ```

---

## 4. Manual Role Login Checks (Live HTTPS)

Navigate to [https://crm.telestar.cloud/login](https://crm.telestar.cloud/login):

- [ ] **Director:** Log in, access `/director`, verify executive KPIs and worker queues.
- [ ] **Floor Manager:** Log in, access `/team` and `/client-reports`.
- [ ] **Team Lead:** Log in, verify pod leads and pipeline overview.
- [ ] **SDR:** Log in, access `/leads`, `/sequences`, and `/inbox`.
- [ ] **Leadgen:** Log in, access lead pool intake and import queue.

---

## 5. Rollback Procedure

If any blocker surfaces post-deployment:

```bash
# Instantly roll back to previous known-good digest
./scripts/rollback.sh
```
