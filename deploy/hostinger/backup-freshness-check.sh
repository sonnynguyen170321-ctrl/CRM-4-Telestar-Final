#!/usr/bin/env bash
#
# Alert when the newest off-host backup is older than it should be.
#
# A backup job that silently stopped working looks exactly like one that is working: no output,
# no error, no alert. This is the check that tells the difference. Run it from cron, daily.
#
#   deploy/hostinger/backup-freshness-check.sh [--max-age-hours 26]
#
# Exit 0 when fresh, 1 when stale or unreachable — so `|| notify` in cron does the right thing.

set -euo pipefail

ENV_FILE="${ENV_FILE:-.env.production}"
MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-26}"
[ "${1:-}" = "--max-age-hours" ] && MAX_AGE_HOURS="${2:?}"

read_env() {
  grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d '\r'
}
BACKUP_REMOTE="${BACKUP_REMOTE:-$(read_env BACKUP_REMOTE)}"
[ -n "$BACKUP_REMOTE" ] || { echo "BACKUP_REMOTE not configured — there is no off-host backup at all" >&2; exit 1; }

NEWEST=$(rclone lsjson "$BACKUP_REMOTE" --files-only 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const f=JSON.parse(s||"[]").filter(x=>/\.dump(\.age)?$/.test(x.Name));
      if(!f.length){process.exit(3)}
      f.sort((a,b)=>new Date(b.ModTime)-new Date(a.ModTime));
      process.stdout.write(f[0].Name+" "+f[0].ModTime);
    })') || { echo "could not list ${BACKUP_REMOTE}, or it holds no dump" >&2; exit 1; }

NAME=${NEWEST%% *}
MODTIME=${NEWEST#* }
AGE_HOURS=$(( ( $(date -u +%s) - $(date -u -d "$MODTIME" +%s) ) / 3600 ))

if [ "$AGE_HOURS" -gt "$MAX_AGE_HOURS" ]; then
  echo "STALE: newest off-host backup ${NAME} is ${AGE_HOURS}h old (limit ${MAX_AGE_HOURS}h)" >&2
  exit 1
fi
echo "ok: newest off-host backup ${NAME} is ${AGE_HOURS}h old"
