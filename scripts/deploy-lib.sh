#!/usr/bin/env bash
#
# Decisions deploy.sh makes that were wrong, extracted so they can be tested.
#
# Each function here corresponds to a defect found on 2026-08-21 against the live box:
#
#   DEPLOY-001  a failed deployments.ndjson append did not stop the deploy, so the release
#               that is serving traffic has no entry in the audit trail.
#   DEPLOY-002  the pre-deploy backup prompt accepted any string. `Telestar2026` — the demo
#               password — was accepted on three separate deploys. Nothing checked that a
#               backup existed.
#   DEPLOY-003  every `docker pull` failure was reported as "No image published for commit",
#               which pointed the operator at CI during a disk-full incident.
#
# Pure functions: they read arguments and write to stdout. They do not deploy anything.

# ── DEPLOY-002 ───────────────────────────────────────────────────────────────
# A Cloud SQL backup run id is an int64. A password is not. Anything with a non-digit in it
# was typed by a human answering the wrong question, and must never be recorded as a backup.
validate_backup_id() {
  local id="${1-}"

  if [ -z "$id" ]; then
    echo "Backup ID is empty."
    return 1
  fi
  case "$id" in
    *[!0-9]*)
      echo "Backup ID must be the numeric Cloud SQL backup run id, not free text. Got: ${id}"
      return 1
      ;;
  esac
  if [ "${#id}" -lt 6 ]; then
    echo "Backup ID '${id}' is too short to be a Cloud SQL backup run id."
    return 1
  fi

  echo "$id"
  return 0
}

# Ask the infrastructure whether the backup is real.
#
#   0  the backup exists — verified
#   1  gcloud answered, and the backup does not exist
#   2  gcloud could not answer (absent, unauthenticated, or the VM service account's
#      ACCESS_TOKEN_SCOPE_INSUFFICIENT). Not a pass. The caller must record it as unverified.
verify_backup_exists() {
  local id="${1-}" instance="${2-}" project="${3-}"
  local out status

  if ! command -v gcloud >/dev/null 2>&1; then
    echo "gcloud is not installed here, so the backup could not be verified."
    return 2
  fi

  out=$(gcloud sql backups describe "$id" --instance="$instance" --project="$project" 2>&1)
  status=$?

  if [ $status -eq 0 ]; then
    echo "Backup ${id} verified on ${instance}."
    return 0
  fi

  case "$out" in
    *ACCESS_TOKEN_SCOPE_INSUFFICIENT*|*"insufficient authentication scopes"*)
      echo "This machine's credentials cannot read Cloud SQL (scope insufficient); backup not verified."
      return 2
      ;;
    *"do not currently have active credentials"*|*"not currently have"*|*"Reauthentication"*|*"credentials"*)
      echo "gcloud has no usable credentials here; backup not verified."
      return 2
      ;;
    *"NOT_FOUND"*|*"not found"*|*"does not exist"*)
      echo "Cloud SQL reports no backup ${id} on ${instance}."
      return 1
      ;;
    *)
      echo "Could not verify backup ${id}: ${out%%$'\n'*}"
      return 2
      ;;
  esac
}

# ── DEPLOY-003 ───────────────────────────────────────────────────────────────
# Name the cause that the registry actually reported. A disk incident and a missing image
# need opposite responses from the operator, and telling them the wrong one costs an hour.
classify_pull_failure() {
  local out="${1-}" commit="${2-}"

  case "$out" in
    *"no space left on device"*|*"No space left on device"*)
      echo "Disk is full on this box, so the image could not be pulled. This is not a CI problem. Recover space with: docker image prune -a -f && docker builder prune -f"
      ;;
    *"manifest unknown"*|*"manifest for"*"not found"*|*"not found: manifest"*)
      echo "No image published for commit ${commit}. CI publishes only after it passes — check the run."
      ;;
    *unauthorized*|*"denied: denied"*|*"authentication required"*)
      echo "The registry rejected these credentials. Re-authenticate to ghcr.io; the image may well exist."
      ;;
    *"i/o timeout"*|*"TLS handshake timeout"*|*"connection refused"*|*"temporary failure in name resolution"*|*"Temporary failure in name resolution"*)
      echo "Could not reach the registry (network). The image may well exist; retry once connectivity is back."
      ;;
    *)
      echo "docker pull failed for commit ${commit}: ${out%%$'\n'*}"
      ;;
  esac
}

# ── DEPLOY-001 ───────────────────────────────────────────────────────────────
# Check the audit trail can be written BEFORE anything irreversible happens. Discovering
# that the file is root-owned after the containers have swapped is discovering it too late.
assert_record_writable() {
  local file="${1-}"
  local dir
  dir="$(dirname "$file")"

  if [ -e "$file" ]; then
    if [ ! -w "$file" ]; then
      echo "Deployment record ${file} exists but is not writable by $(whoami). The deploy would run and leave no audit trail. Fix ownership first: sudo chown \$(whoami) ${file}"
      return 1
    fi
  else
    if [ ! -w "$dir" ]; then
      echo "Deployment record ${file} does not exist and ${dir} is not writable by $(whoami). The deploy would run and leave no audit trail."
      return 1
    fi
  fi

  echo "Deployment record ${file} is writable."
  return 0
}

# The append is only real if the file grew by exactly one line.
assert_record_appended() {
  local file="${1-}" before="${2-}"
  local after

  if [ ! -f "$file" ]; then
    echo "Deployment record ${file} was not created."
    return 1
  fi
  after=$(wc -l < "$file" | tr -d ' ')

  if [ "$after" -le "$before" ]; then
    echo "Deployment record ${file} did not grow (${before} -> ${after}). The release is running and unrecorded."
    return 1
  fi

  echo "Recorded (${before} -> ${after})."
  return 0
}
