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
COMPOSE_FILES="${COMPOSE_FILES:--f docker-compose.yml -f docker-compose.aws.yml}"
DOCKER="${DOCKER:-sudo docker}"
DC="$DOCKER compose --env-file $ENV_FILE $COMPOSE_FILES"

failures=0
pass() { printf '  \033[32mPASS\033[0m  %s\n' "$*"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$*"; failures=$((failures + 1)); }

echo "Post-deploy smoke test against ${BASE_URL}"

# 1. The app is up and can reach the database.
health=$(curl -fsS --max-time 20 "${BASE_URL}/api/health" 2>/dev/null || echo '')
if [ -z "$health" ]; then
  fail "/api/health did not respond"
else
  ok=$(printf '%s' "$health" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).ok)}catch{console.log("parse-error")}})')
  [ "$ok" = "true" ] && pass "/api/health ok (database reachable)" || fail "/api/health reported ok=${ok}"
fi

# 2. The build serving traffic is the one that was deployed.
if [ -n "${DEPLOYED_COMMIT:-}" ] && [ -n "$health" ]; then
  served=$(printf '%s' "$health" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).commit||"")}catch{console.log("")}})')
  if [ "$served" = "$DEPLOYED_COMMIT" ]; then
    pass "web reports commit ${served:0:7}"
  else
    fail "web reports commit '${served:-<none>}', expected '${DEPLOYED_COMMIT}'"
  fi
fi

# 3. Auth still gates the admin console — a 404 here means the routes did not ship.
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "${BASE_URL}/admin" || echo 000)
case "$code" in
  30[0-9]) pass "/admin redirects unauthenticated callers (${code})" ;;
  *)       fail "/admin returned ${code}, expected a 3xx redirect" ;;
esac

# 4. The login page renders.
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "${BASE_URL}/login" || echo 000)
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
if $DC logs --tail 200 worker 2>/dev/null | grep -q '\[worker\] all workers registered\|\[worker\] registered:'; then
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
