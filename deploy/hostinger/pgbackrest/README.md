# Point-in-time recovery on the VPS — pgBackRest

## Why this exists

Leaving Cloud SQL gives up its continuous archiving. Replacing it with a nightly `pg_dump` means
an RPO of up to 24 hours: a failure at 16:00 restores to 02:00 and loses a day of every tenant's
replies, sequence state and prospect edits — on a system that sends outreach on clients' behalf,
with no way to know which messages went out. That is not a backup policy, it is a bet.

PITR is not a managed-service feature. PostgreSQL writes a WAL record for every change; ship those
records off-host as they are produced and recovery lands on a chosen second, not on last night.

| | nightly `pg_dump` alone | pgBackRest WAL archiving | Cloud SQL |
|---|---|---|---|
| Worst-case data loss | 24 hours | **the last archived segment** (seconds to a few minutes) | seconds |
| Restore to an arbitrary time | no | **yes** | yes |
| Monthly cost | 0 | object storage only, a few dollars | $55–110 |

`deploy/hostinger/backup.sh` stays: it produces the portable logical dump that rebuilds the
database on a different host or a laptop. The two answer different questions — "restore to 14:32"
and "recreate this database elsewhere".

## Shape

pgBackRest runs inside the `crm-db` container, because it needs the data directory and must be
the process PostgreSQL's `archive_command` calls. That means a thin image on top of `postgres:16`:

```dockerfile
# deploy/hostinger/pgbackrest/Dockerfile
FROM postgres:16-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends pgbackrest \
 && rm -rf /var/lib/apt/lists/*
```

and in `docker-compose.hostinger.yml`, `crm-db` builds from it and runs with:

```
-c archive_mode=on
-c archive_command=pgbackrest --stanza=crm archive-push %p
-c archive_timeout=60          # a quiet database still closes a segment every minute,
                               # which is what bounds the RPO when write volume is low
-c wal_level=replica
-c max_wal_senders=3
```

`/etc/pgbackrest/pgbackrest.conf`, mounted read-only:

```ini
[global]
repo1-type=s3                  ; any S3-compatible object store: Backblaze B2, Cloudflare R2, Wasabi
repo1-s3-endpoint=<endpoint>
repo1-s3-bucket=telestar-crm-wal
repo1-s3-region=<region>
repo1-s3-key=<access key>      ; from an env file, not this file in git
repo1-s3-key-secret=<secret>
repo1-cipher-type=aes-256-cbc  ; encrypted in the repository, same reasoning as age on the dumps
repo1-cipher-pass=<passphrase>
repo1-retention-full=4         ; four weekly fulls ≈ one month of PITR
start-fast=y
compress-type=zst

[crm]
pg1-path=/var/lib/postgresql/data
```

Retention of four weekly fulls plus their WAL is roughly a month of recoverable history. For a
database of this size that is single-digit dollars a month.

## Schedule

```cron
# full backup, Sunday 02:00 UTC
0 2 * * 0  docker compose -p crm exec -T crm-db pgbackrest --stanza=crm --type=full backup
# incremental, every other day 02:00 UTC
0 2 * * 1-6 docker compose -p crm exec -T crm-db pgbackrest --stanza=crm --type=incr backup
# the logical dump — portable, encrypted, off-host
30 2 * * * cd /opt/crm && deploy/hostinger/backup.sh --tag nightly --offsite
```

WAL segments ship continuously between those runs; the schedule only governs the base backups.

## Bring-up

```bash
docker compose -p crm exec -T crm-db pgbackrest --stanza=crm stanza-create
docker compose -p crm exec -T crm-db pgbackrest --stanza=crm check      # must pass before P6b
docker compose -p crm exec -T crm-db pgbackrest --stanza=crm --type=full backup
docker compose -p crm exec -T crm-db pgbackrest --stanza=crm info       # confirms WAL is arriving
```

## Restoring to a point in time

```bash
docker compose -p crm stop web worker
docker compose -p crm stop crm-db
docker compose -p crm run --rm --entrypoint sh crm-db -c \
  'pgbackrest --stanza=crm --type=time --target="2026-09-13 14:32:00+00" --delta restore'
docker compose -p crm up -d crm-db     # recovers forward to the target, then promotes
docker compose -p crm up -d web worker
```

Afterwards: `prisma migrate status` must be clean, then re-derive RLS from `supabase/rls.sql` and
run `npm run verify:rls` — the same order `restore.sh` prints.

## The gate

This is not optional infrastructure once the database leaves Cloud SQL. Before Phase 6b moves
production data onto `crm-db`:

1. `pgbackrest check` passes and `info` shows WAL arriving.
2. A restore to a timestamp **five minutes in the past** is rehearsed on staging and the row that
   was written six minutes ago is present while the one written four minutes ago is not.
3. The wall-clock restore time is recorded. That number is the RTO, and it decides whether a
   Phase 6b window is 30 minutes or three hours.

Until all three hold, the database stays on Cloud SQL.
