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

## Measured on this host, 2026-09-13

Not a projection — a rehearsal against a throwaway Postgres on the Kuala Lumpur VPS itself, with
synthetic data rather than customer data (`sanitize.sql` was not on the box yet, and pulling real
PII onto a host with no backup to test a backup is the wrong order).

| | |
|---|---|
| Dataset | 1,500,000 rows, 716 MB |
| Full backup | **7 s** → 252 MB repository (zstd, −65 %) |
| Restore + recover to a chosen second | **6 s** |
| Correctness | the row written before the target is present, the row written after it is absent, `pg_is_in_recovery() = false` |

Two configuration errors that would have surfaced at 2 a.m. on cutover night surfaced here instead,
and both are fixed in `pgbackrest.conf.example`:

1. `pgbackrest` refuses to run as root — every invocation needs `-u postgres`.
2. `pg1-user` defaults to a `postgres` superuser that the image never creates: `postgres:16` only
   creates the role named by `POSTGRES_USER`. Without `pg1-user=crm`, `stanza-create` fails with
   "unable to find primary cluster", which reads like a broken cluster rather than a wrong user.

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

The full configuration is `pgbackrest.conf.example`; copy it to `/opt/crm/pgbackrest/pgbackrest.conf`
and fill in the repo2 credentials. Two repositories, and they are not alternatives:

* **repo1, on this host** (`/backups/pgbackrest`) — instant, no network, and what a routine "undo
  the last hour" reads. Retention: 2 fulls.
* **repo2, Cloudflare R2** — the only copy that survives losing the box. That is not hypothetical:
  changing this VPS's region on 2026-09-13 deleted the entire disk, which would have taken repo1
  with it. Retention: 4 weekly fulls ≈ a month of recoverable history, encrypted in the repository.

R2's free tier is 10 GB with no egress charge, and the measured repository above is 252 MB, so
repo2 costs nothing at this size. **`repo2-s3-uri-style=path` is required** — R2 does not serve
virtual-host-style buckets, and leaving the default produces a DNS error that reads like a bad
credential.

Until the R2 credentials exist, delete the `repo2-*` lines and pgBackRest runs on repo1 alone.
That is a working PITR setup with one failure mode: it does not survive the host.

## Schedule

```cron
# full backup, Sunday 02:00 UTC
0  2 * * 0   docker compose -p crm exec -T -u postgres crm-db pgbackrest --stanza=crm --type=full backup
# incremental the other six days
0  2 * * 1-6 docker compose -p crm exec -T -u postgres crm-db pgbackrest --stanza=crm --type=incr backup
# the portable logical dump, encrypted, off-host
30 2 * * *   cd /opt/crm && deploy/hostinger/backup.sh --tag nightly --offsite
# the backup nobody checks is the one that was broken for a month
0  8 * * *   cd /opt/crm && deploy/hostinger/backup-freshness-check.sh
```

WAL segments ship continuously between those runs; the schedule only governs the base backups.

## Bring-up

Every invocation runs as `postgres`; pgBackRest refuses to run as root.

```bash
PB() { docker compose -p crm exec -T -u postgres crm-db pgbackrest --stanza=crm "$@"; }
PB stanza-create
PB check                 # proves archive_command actually reaches the repository
PB --type=full backup
PB info                  # WAL min/max confirms segments are arriving
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
