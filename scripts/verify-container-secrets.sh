#!/usr/bin/env bash
#
# Verifies that the running containers actually received the Telestar AI provider
# credentials — not that a file on the VM contains them.
#
# Those are different facts, and the difference is a whole class of outage: a key present in
# .env.production but shadowed by an `environment:` entry, or supplied to `web` and not to
# `worker`, produces a chatbox that looks healthy while every background AI job fails.
#
#   ./scripts/verify-container-secrets.sh
#   COMPOSE_FILES="-f docker-compose.yml -f docker-compose.gcp.yml" ./scripts/verify-container-secrets.sh
#
# Reports SET / NOT SET only. It never prints a key, a prefix, a suffix, or a length.
# Exits non-zero if any service is missing any provider credential.

set -uo pipefail

COMPOSE_FILES="${COMPOSE_FILES:--f docker-compose.yml}"
SERVICES="${SERVICES:-web worker}"
KEYS="OPENAI_API_KEY GEMINI_API_KEY GROQ_API_KEY"

missing=0

for service in $SERVICES; do
  echo "$service"
  for key in $KEYS; do
    # `printenv` in the container, reduced to a presence boolean before it ever crosses the
    # process boundary. The value is never carried back into this shell.
    if docker compose $COMPOSE_FILES exec -T "$service" \
        sh -c "test -n \"\${$key:-}\"" >/dev/null 2>&1; then
      echo "  $key: SET"
    else
      echo "  $key: NOT SET"
      missing=$((missing + 1))
    fi
  done
done

if [ "$missing" -gt 0 ]; then
  echo ""
  echo "RED: $missing provider credential(s) missing from the running containers."
  echo "Both web and worker inherit env_file from the x-app-base anchor in docker-compose.yml."
  echo "Check that .env.production defines all three and that no environment: entry shadows them."
  exit 1
fi

echo ""
echo "GREEN: every service received every provider credential."
