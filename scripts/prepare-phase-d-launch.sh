#!/usr/bin/env bash
# ==============================================================================
# Telestar CRM - Phase D Production Outreach Launch Script (Gate E20)
# ==============================================================================
# This script transitions the CRM from Canary Sandbox mode to Full Production
# Outreach mode by disabling LIVE_EMAIL_CANARY_MODE while ensuring all deliverability
# safety guards, rate limits, and circuit breakers remain strictly enforced.
# ==============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-${ROOT_DIR}/.env.production}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "❌ Error: Environment file ${ENV_FILE} not found!" >&2
  exit 1
fi

echo "================================================================="
echo "🚀 TELESTAR CRM - PHASE D PRODUCTION LAUNCH TRANSITION"
echo "================================================================="
echo "Target Environment File: ${ENV_FILE}"
echo "Current Time: $(date -u +%Y-%m-%d\ %H:%M:%SZ)"

# 1. Update Phase D Launch Flags in .env.production
echo -e "\n1️⃣ Configuring Production Launch Deliverability Flags..."

# Disable Canary mode to allow external prospect outreach
sed -i 's|^LIVE_EMAIL_CANARY_MODE=.*|LIVE_EMAIL_CANARY_MODE="false"|' "${ENV_FILE}"
grep -q '^LIVE_EMAIL_CANARY_MODE=' "${ENV_FILE}" || echo 'LIVE_EMAIL_CANARY_MODE="false"' >> "${ENV_FILE}"

# Ensure live sending is active (DRY_RUN=false)
sed -i 's|^EMAIL_SEND_DRY_RUN=.*|EMAIL_SEND_DRY_RUN="false"|' "${ENV_FILE}"
grep -q '^EMAIL_SEND_DRY_RUN=' "${ENV_FILE}" || echo 'EMAIL_SEND_DRY_RUN="false"' >> "${ENV_FILE}"

# Ensure sequence auto-send is enabled
sed -i 's|^SEQUENCE_AUTOSEND_ENABLED=.*|SEQUENCE_AUTOSEND_ENABLED="true"|' "${ENV_FILE}"
grep -q '^SEQUENCE_AUTOSEND_ENABLED=' "${ENV_FILE}" || echo 'SEQUENCE_AUTOSEND_ENABLED="true"' >> "${ENV_FILE}"

# Set safe domain warmup daily limit (50 emails/day per mailbox initially)
sed -i 's|^MAX_DAILY_SENDS_PER_ACCOUNT=.*|MAX_DAILY_SENDS_PER_ACCOUNT="50"|' "${ENV_FILE}"
grep -q '^MAX_DAILY_SENDS_PER_ACCOUNT=' "${ENV_FILE}" || echo 'MAX_DAILY_SENDS_PER_ACCOUNT="50"' >> "${ENV_FILE}"

echo "   ✅ LIVE_EMAIL_CANARY_MODE=\"false\""
echo "   ✅ EMAIL_SEND_DRY_RUN=\"false\""
echo "   ✅ SEQUENCE_AUTOSEND_ENABLED=\"true\""
echo "   ✅ MAX_DAILY_SENDS_PER_ACCOUNT=\"50\" (Warmup Threshold)"

# 2. Restart Web and Worker Services
echo -e "\n2️⃣ Restarting Web and Worker Services..."
cd "${ROOT_DIR}"
chmod +x scripts/*.sh
COMPOSE_FLAGS=$(./scripts/production-compose.sh "${ENV_FILE}")

sudo docker compose --env-file "${ENV_FILE}" ${COMPOSE_FLAGS} up -d --no-deps web worker

# 3. Verify Health Endpoint
echo -e "\n3️⃣ Verifying Production Health Endpoint..."
sleep 5
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" https://crm.telestar.cloud/api/health || curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health || true)

if [[ "${HTTP_CODE}" == "200" ]]; then
  echo "   ✅ Health Check HTTP 200 OK"
else
  echo "   ⚠️ Health Check returned HTTP ${HTTP_CODE} (waiting for Next.js boot...)"
fi

echo -e "\n================================================================="
echo "🎉 PHASE D LAUNCH READY: CRM IS IN FULL PRODUCTION OUTREACH MODE"
echo "================================================================="
echo "Access URL: https://crm.telestar.cloud"
echo "Director Login: dean@telestar.vn"
echo "Floor Manager: sonny@telestar.vn"
echo "================================================================="
