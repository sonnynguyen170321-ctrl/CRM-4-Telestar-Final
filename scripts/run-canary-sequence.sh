#!/usr/bin/env bash
set -euo pipefail

cd /opt/crm-4-u

# 1. Update Phase C flags in .env.production
sed -i "s|^SEQUENCE_AUTOSEND_ENABLED=.*|SEQUENCE_AUTOSEND_ENABLED=\"true\"|" .env.production
sed -i "s|^EMAIL_SEND_DRY_RUN=.*|EMAIL_SEND_DRY_RUN=\"false\"|" .env.production

# 2. Restart web and worker
COMPOSE_FLAGS=$(./scripts/production-compose.sh .env.production)
sudo docker compose --env-file .env.production $COMPOSE_FLAGS up -d --no-deps web worker

# 3. Seed Canary Sequence & Lead
sudo docker compose --env-file .env.production $COMPOSE_FLAGS exec -T web node node_modules/tsx/dist/cli.mjs scripts/canary-sequence-drill.ts

# 4. Trigger Sequence Engine Cron
echo "==> Triggering Automated Sequence Engine Cron..."
/opt/crm-4-u/bin/cron-call.sh sequence-engine

# 5. Verify Progression in DB
echo "==> Sequence State Audit in DB..."
sudo docker compose --env-file .env.production $COMPOSE_FLAGS exec -T web node node_modules/tsx/dist/cli.mjs scripts/canary-verify-enrollment.ts
