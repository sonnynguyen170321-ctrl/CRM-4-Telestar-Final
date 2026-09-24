#!/usr/bin/env bash
#
# Delete all but the newest N backups, and their manifests.
#
#   deploy/hostinger/prune-backups.sh <dir> <keep>
#
# Extracted from backup.sh because it stopped three deploys.
#
# It used to be a `ls -1t "$DIR"/*.dump "$DIR"/*.dump.age` pipeline inside `set -euo pipefail`.
# Once every dump had been encrypted — `backup.sh` removes the plaintext after `age` — nothing
# matched `*.dump`, bash passed the pattern through literally, `ls` exited 2, and `pipefail`
# turned a housekeeping step into a failed backup. `2>/dev/null` hid the message but not the
# exit code, so what the operator saw was:
#
#     encrypted: /opt/crm/backups/20260924T173908Z-predeploy-e9284ad42c69.dump.age
#     ERROR: Pre-deploy backup failed. Nothing was deployed.
#
# The backup had in fact succeeded. Every deploy from 2026-09-23 onward was refused by the
# cleanup that runs after it, and three merged fixes sat undeployed for two days.
#
# `find` returns 0 when nothing matches, which is the property this needs. Kept as its own file
# so `tests/backup-retention.test.ts` can run it against a real directory.
set -euo pipefail

DIR="${1:?usage: prune-backups.sh <dir> <keep>}"
KEEP="${2:?usage: prune-backups.sh <dir> <keep>}"

[ -d "$DIR" ] || exit 0

# Newest first, by modification time. `-maxdepth 1` so a nested restore workspace is never
# swept, and the two names are the only two backup.sh produces.
find "$DIR" -maxdepth 1 -type f \( -name '*.dump' -o -name '*.dump.age' \) -printf '%T@\t%p\n' \
  | sort -rn \
  | cut -f2- \
  | tail -n +$((KEEP + 1)) \
  | while IFS= read -r old; do
      # The manifest is named after the plaintext dump whether or not the dump was encrypted,
      # so strip `.age` before deriving it.
      rm -f -- "$old" "${old%.age}.manifest.json"
    done
