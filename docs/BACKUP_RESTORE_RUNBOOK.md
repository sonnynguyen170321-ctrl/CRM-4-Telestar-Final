# Cloud SQL Database Backup & Scratch Restore Runbook (Gate P3)

> **Scope:** Cloud SQL automated backup lifecycle, point-in-time recovery, and zero-downtime scratch drill.  
> **Database Host:** GCP Cloud SQL `telestar-crm-db` (PostgreSQL 15)  
> **Instance Connection Name:** `telestar-crm-final:asia-southeast1:telestar-crm-db`  

---

## 1. Automated Backup Posture

Cloud SQL automated daily backups with transaction logging are enabled:
- **Backup Window:** Daily between 02:00–06:00 UTC.
- **Point-in-Time Recovery (PITR):** 7-day WAL retention enabled.
- **Location:** Automated dual-region storage (`asia-southeast1`).

To list existing backups:
```bash
gcloud sql backups list --instance=telestar-crm-db --project=telestar-crm-final
```

---

## 2. Non-Disruptive Scratch Restore Drill Procedure

To verify backup integrity **without touching the live production database**, restore a backup into a temporary scratch instance:

### Step 1: Identify Target Backup ID
```bash
BACKUP_ID=$(gcloud sql backups list --instance=telestar-crm-db --project=telestar-crm-final --format="value(id)" --limit=1)
echo "Target Backup ID: ${BACKUP_ID}"
```

### Step 2: Create Temporary Scratch Instance & Restore
```bash
# Clone/restore into scratch instance
gcloud sql instances clone telestar-crm-db telestar-crm-db-scratch \
  --project=telestar-crm-final \
  --zone=asia-southeast1-a

# Alternatively, restore specific backup into scratch instance:
# gcloud sql backups restore ${BACKUP_ID} --restore-instance=telestar-crm-db-scratch --project=telestar-crm-final
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
gcloud sql instances delete telestar-crm-db-scratch --project=telestar-crm-final --quiet
```

---

## 3. RPO and RTO Targets
- **Recovery Point Objective (RPO):** < 5 minutes (via PITR WAL stream).
- **Recovery Time Objective (RTO):** < 30 minutes (via fast instance clone).
