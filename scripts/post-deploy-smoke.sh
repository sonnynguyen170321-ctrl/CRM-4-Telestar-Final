#!/usr/bin/env bash
#
# Prove a deployment actually took, without rebuilding anything.
#
#     DEPLOYED_COMMIT=<full-sha> ./scripts/post-deploy-smoke.sh
#
# Called by scripts/deploy.sh, and safe to run on its own at any time. Read-only.
#
# The check that matters most is the last one: web and worker must be running the *same*
# image digest. Two services sharing a mutable tag can drift apart silently — worker
# restarts on Tuesday's `:latest`, web keeps Monday's — and every symptom of that looks
# like an application bug.

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost}"
ENV_FILE="${ENV_FILE:-.env.production}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILES="${COMPOSE_FILES:-$("${SCRIPT_DIR}/production-compose.sh" "$ENV_FILE" 2>/dev/null || echo "-f docker-compose.yml -f docker-compose.gcp.yml")}"
DOCKER="${DOCKER:-sudo docker}"
DC="$DOCKER compose --env-file $ENV_FILE $COMPOSE_FILES"

failures=0
pass() { printf '  \033[32mPASS\033[0m  %s\n' "$*"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$*"; failures=$((failures + 1)); }

extract_json_field() {
  local json="$1"
  local field="$2"
  if command -v python3 >/dev/null 2>&1; then
    printf '%s' "$json" | python3 -c "import sys, json; data=json.load(sys.stdin); val=data.get('${field}'); print(str(val).lower() if isinstance(val, bool) else (val or ''))" 2>/dev/null || echo ''
  elif command -v node >/dev/null 2>&1; then
    printf '%s' "$json" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log(j.${field} ?? '')}catch{console.log('')}})"
  elif command -v jq >/dev/null 2>&1; then
    printf '%s' "$json" | jq -r ".${field} // empty" 2>/dev/null || echo ''
  else
    printf '%s' "$json" | grep -o "\"${field}\":[^,}]*" | cut -d: -f2- | tr -d '" ' || echo ''
  fi
}

echo "Post-deploy smoke test against ${BASE_URL}"

# 1. The app is up and can reach the database (with readiness retry loop).
health=""
for i in $(seq 1 20); do
  health=$(curl -fsSL -k --max-time 10 "${BASE_URL}/api/health" 2>/dev/null || echo '')
  if [ -n "$health" ]; then
    break
  fi
  sleep 1
done

if [ -z "$health" ]; then
  fail "/api/health did not respond after 20s"
else
  ok=$(extract_json_field "$health" "ok")
  [ "$ok" = "true" ] && pass "/api/health ok (database reachable)" || fail "/api/health reported ok=${ok}"
fi

# 2. The build serving traffic is the one that was deployed.
if [ -n "${DEPLOYED_COMMIT:-}" ] && [ -n "$health" ]; then
  served=$(extract_json_field "$health" "commit")
  if [ "$served" = "$DEPLOYED_COMMIT" ]; then
    pass "web reports commit ${served:0:7}"
  else
    fail "web reports commit '${served:-<none>}', expected '${DEPLOYED_COMMIT}'"
  fi
fi

# 3. Auth still gates the admin console — a 404 here means the routes did not ship.
code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 20 "${BASE_URL}/admin" || echo 000)
case "$code" in
  30[0-9]) pass "/admin redirects unauthenticated callers (${code})" ;;
  *)       fail "/admin returned ${code}, expected a 3xx redirect" ;;
esac

# 4. The login page renders.
code=$(curl -sLk -o /dev/null -w '%{http_code}' --max-time 20 "${BASE_URL}/login" || echo 000)
[ "$code" = "200" ] && pass "/login renders (200)" || fail "/login returned ${code}"

# 5. Web and worker are the same image. This is the whole point of pinning by digest.
web_image=$($DC ps -q web 2>/dev/null | head -1 | xargs -r $DOCKER inspect --format '{{.Image}}' 2>/dev/null || echo '')
worker_image=$($DC ps -q worker 2>/dev/null | head -1 | xargs -r $DOCKER inspect --format '{{.Image}}' 2>/dev/null || echo '')
if [ -z "$web_image" ] || [ -z "$worker_image" ]; then
  fail "could not inspect running containers (web='${web_image}', worker='${worker_image}')"
elif [ "$web_image" = "$worker_image" ]; then
  pass "web and worker share image ${web_image:7:19}"
else
  fail "web and worker are running DIFFERENT images — web=${web_image}, worker=${worker_image}"
fi

# 6. The worker is actually processing, not just running.
worker_ready=0
for i in $(seq 1 10); do
  if $DC logs --tail 200 worker 2>/dev/null | grep -q '\[worker\] all workers registered\|\[worker\] registered:'; then
    worker_ready=1
    break
  fi
  sleep 1
done

if [ "$worker_ready" -eq 1 ]; then
  pass "worker registered its queues"
else
  fail "worker did not log queue registration in its last 200 lines"
fi

echo
if [ "$failures" -gt 0 ]; then
  echo "Smoke test FAILED (${failures} check(s))."
  exit 1
fi
echo "Smoke test passed."
