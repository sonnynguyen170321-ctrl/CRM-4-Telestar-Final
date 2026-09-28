# ⛔ HISTORICAL — Cloud SQL Backup & Scratch Restore Runbook (Gate P3)

> ## Do not follow this document.
>
> It describes a database this system no longer runs on, and it promises a recovery guarantee that
> does not exist.
>
> **Where the CRM actually runs:** one Hostinger VPS, Postgres 16 in the `crm-crm-db-1` container,
> deploy root `/opt/crm`. There is no Cloud SQL instance. Every `gcloud sql` command below will fail,
> or address something unrelated.
>
> **The real recovery posture, measured 2026-09-28:**
>
> | | this document claims | reality |
> |---|---|---|
> | mechanism | Cloud SQL automated backups | nightly `pg_dump`, plus an off-site copy to R2 |
> | PITR | enabled, 7-day WAL retention | **none.** WAL archiving is deliberately off |
> | RPO | 300s, "MEASURED" | **up to 24 hours** — everything since last night's dump |
>
> That RPO line is the dangerous part. Read under pressure at 09:00 it tells an operator they can
> recover to five minutes ago. They cannot: anything written since the last nightly dump is gone.
>
> **The procedure that works** is `deploy/hostinger/restore.sh`, whose own header is accurate about
> what a logical dump does *not* restore — roles, GRANTs, and the RLS policies in `supabase/rls.sql`.
> Read that and `deploy/hostinger/RUNBOOK.md` instead of this file.
>
> Kept rather than deleted because the GCP box still exists as a fallback proxy from the cutover, and
> because a reader who finds a stale runbook with no explanation tends to assume it is merely out of
> date rather than describing different infrastructure entirely.

> **Scope (historical):** Cloud SQL automated backup lifecycle, point-in-time recovery, and
> zero-downtime scratch drill.  
> **Database Host (historical):** GCP Cloud SQL `telestar-db` (PostgreSQL 16)  
> **Instance Connection Name (historical):** `telestar-crm-final:asia-southeast1:telestar-db`  

---

## 1. Automated Backup Posture

Cloud SQL automated daily backups with transaction logging are enabled:
- **Backup Window:** Daily between 02:00–06:00 UTC.
- **Point-in-Time Recovery (PITR):** 7-day WAL retention enabled.
- **Location:** Automated dual-region storage (`asia-southeast1`).

To list existing backups:
```bash
gcloud sql backups list --instance=telestar-db --project=telestar-crm-final
```

---

## 2. Non-Disruptive Scratch Restore Drill Procedure

To verify backup integrity **without touching the live production database**, restore a backup into a temporary scratch instance:

### Step 1: Identify Target Backup ID
```bash
BACKUP_ID=$(gcloud sql backups list --instance=telestar-db --project=telestar-crm-final --format="value(id)" --limit=1)
echo "Target Backup ID: ${BACKUP_ID}"
```

### Step 2: Create Temporary Scratch Instance & Restore
```bash
# Clone/restore into scratch instance
gcloud sql instances clone telestar-db telestar-db-scratch \
  --project=telestar-crm-final \
  --zone=asia-southeast1-a

# Alternatively, restore specific backup into scratch instance:
# gcloud sql backups restore ${BACKUP_ID} --restore-instance=telestar-db-scratch --project=telestar-crm-final
```

### Step 3: Run Verification Queries on Scratch Instance
Connect to scratch database and verify table counts, migration version, and tenant records:
```bash
# Verify schema migrations applied
psql "postgresql://crm:<DB_PASSWORD>@<SCRATCH_IP>:5432/telestar_crm?sslmode=require" \
  -c 'SELECT count(*) FROM "_prisma_migrations" WHERE rolled_back_at IS NULL;'

# Verify tenant integrity
psql "postgresql://crm:<DB_PASSWORD>@<SCRATCH_IP>:5432/telestar_crm?sslmode=require" \
  -c 'SELECT id, name, "createdAt" FROM "Tenant";'
```

### Step 4: Clean Up Scratch Instance
```bash
gcloud sql instances delete telestar-db-scratch --project=telestar-crm-final --quiet
```

---

## 3. RPO and RTO Targets

> **⛔ The RPO below was true of Cloud SQL and is false of the system that runs today.** On the
> Hostinger VPS there is no PITR and no transaction-log retention: `archive_command` defaults to
> `/bin/true` and WAL archiving is off by choice, so the nightly logical dump is the only backup and
> **the real RPO is up to 24 hours.** Do not quote the number below to anyone, and do not plan a
> recovery around it. The measurement was honest when it was taken; the infrastructure moved.

- **Recovery Point Objective (RPO) — HISTORICAL, Cloud SQL only:** 300s, MEASURED 2026-08-23 from the
  live `backupConfiguration` on `telestar-db` — point-in-time recovery enabled, 7 days of
  transaction-log retention, so recovery is bounded by transaction-log durability rather
  than by the backup interval. Evidence: `EV-DR-RPO`.
  Until 2026-08-23 this line asserted "< 5 minutes" with nothing behind it, while
  `docs/production-certification/BACKUP_RESTORE.md` published 15 minutes. Two numbers, no
  measurement, and the probe that could have settled it was reporting a hardcoded
  "gcloud is not installed".
- **Recovery Time Objective (RTO):** < 30 minutes (via fast instance clone).
