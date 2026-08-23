# Cloud SQL Database Backup & Scratch Restore Runbook (Gate P3)

> **Scope:** Cloud SQL automated backup lifecycle, point-in-time recovery, and zero-downtime scratch drill.  
> **Database Host:** GCP Cloud SQL `telestar-db` (PostgreSQL 16)  
> **Instance Connection Name:** `telestar-crm-final:asia-southeast1:telestar-db`  

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
- **Recovery Point Objective (RPO):** 300s, MEASURED 2026-08-23 from the live
  `backupConfiguration` on `telestar-db` — point-in-time recovery enabled, 7 days of
  transaction-log retention, so recovery is bounded by transaction-log durability rather
  than by the backup interval. Evidence: `EV-DR-RPO`.
  Until 2026-08-23 this line asserted "< 5 minutes" with nothing behind it, while
  `docs/production-certification/BACKUP_RESTORE.md` published 15 minutes. Two numbers, no
  measurement, and the probe that could have settled it was reporting a hardcoded
  "gcloud is not installed".
- **Recovery Time Objective (RTO):** < 30 minutes (via fast instance clone).
