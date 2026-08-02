# Telestar CRM — Production Migration & Cutover Runbook

This document defines the production data migration, verification, and cutover procedures for the **Telestar SDR-as-a-Service Platform**.

---

## 1. Purpose & Objectives

1. Migrate existing client, campaign, lead, meeting, sequence, and pipeline data into the multi-tenant PostgreSQL schema.
2. Ensure full referential integrity and tenant scoping (`tenantId`) across all 23 database models.
3. Validate data deduplication, ownership assignments, and campaign requirement targets.
4. Execute cutover with **zero accidental outbound email transmission** during migration.

---

## 2. Migration Scope & Entity Inventory

The migration encompasses the following relational entities:

| Sequence | Entity Model | Target Prisma Model | Key Constraints & Dependencies |
| :--- | :--- | :--- | :--- |
| **01** | Tenants | `Tenant` | Root entity (`id = "default-tenant"` or unique slug) |
| **02** | Users & Roles | `User` | `role` (`director`, `floor_manager`, `team_lead`, `sdr`, `leadgen_manager`, `leadgen`) |
| **03** | Clients & Accounts | `Client`, `Account` | Master company records; deduplication on domain/name |
| **04** | Campaigns & Pods | `Campaign`, `CampaignSdr` | Linked to `clientId`, assigned SDRs |
| **05** | Internal Lead Database | `LeadPoolItem` | Unassigned raw lead inventory with deduplication keys |
| **06** | Campaign Requirements | `CampaignLeadRequirement` | Quotas, ICP titles, delivery target dates |
| **07** | Working Leads & Contacts | `Contact`, `Lead` | Deduplication on `(tenantId, campaignId, normalizedEmail)` |
| **08** | Booking Links & Meetings | `MeetingBookingLink`, `Meeting` | Waterfall resolution links & completed/scheduled meetings |
| **09** | Opportunities | `Opportunity`, `OpportunityActivity` | Sales stages (`discovery` -> `closed_won`/`closed_lost`) |
| **10** | Email Accounts & Inboxes | `EmailAccount` | Encrypted tokens (`encAccessToken`, `encRefreshToken`) |
| **11** | Templates & Sequences | `Sequence`, `SequenceStep`, `EmailTemplate` | Automated step cadences & instructions |
| **12** | Suppressions & History | `SuppressionEntry`, `LeadgenActivity`, `Activity` | Domain/email suppression rules & audit trails |

---

## 3. Pre-Migration Safety & Environment Lockdown

Before applying migrations or importing production records, enforce the following safety locks:

### 3.1. Disable Outbound Email Automation
In `.env` / production environment:
```env
# CRITICAL: Prevent workers from sending emails during data ingestion
SEQUENCE_AUTOSEND_ENABLED="false"
EMAIL_HEALTH_AUTOPAUSE="false"
```

### 3.2. Verify Encryption & Database Connections
```bash
# Verify encryption key is 64 hex characters (32 bytes)
node -e "if (process.env.ENCRYPTION_KEY?.length !== 64) console.error('INVALID ENCRYPTION_KEY');"

# Test TCP Direct connection for migrations
npx prisma migrate status
```

### 3.3. Create Full Database Backup
```bash
# PostgreSQL Backup snapshot
pg_dump -h <host> -U <user> -d <dbname> -F c -b -v -f "pre_migration_backup_$(date +%Y%m%d_%H%M%S).dump"
```

---

## 4. Deduplication & Data Normalization Rules

During ingestion, the migration scripts and worker ingestion pipelines enforce:

1. **Email Normalization**: Lowercase trimmed email strings; stripped subaddressing where appropriate.
2. **Phone Normalization**: E.164 international standard format (`+1...`, `+84...`).
3. **LinkedIn Normalization**: Normalized profile URLs (`https://linkedin.com/in/...`).
4. **Lead Deduplication Index**:
   - Unique partial index: `(tenantId, campaignId, normalizedEmail) WHERE normalizedEmail IS NOT NULL`.
   - Pool deduplication: Composite match on `(tenantId, duplicateKey)` where key = `hash(email | phone | company+name)`.
5. **Suppression Matching**:
   - Partial unique indexes with `COALESCE("campaignId", '')` across email, domain, and company.

---

## 5. Step-by-Step Migration Execution

### Step 1: Database Schema Deployment
```bash
# Apply all Prisma migrations
npx prisma migrate deploy

# Generate latest client bindings
npx prisma generate
```

### Step 2: Seed / Upsert Core Tenant & Administrator
```bash
node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  await prisma.tenant.upsert({
    where: { id: 'default-tenant' },
    update: {},
    create: { id: 'default-tenant', name: 'Telestar BPO' }
  });
}
main().finally(() => prisma.\$disconnect());
"
```

### Step 3: Create Core Role Accounts via CLI
```bash
npm run create-user -- --email admin@telestar.io --password 'SecureAdminPass2026!' --first-name 'Dean' --last-name 'Director' --role director --activate
npm run create-user -- --email leadgen.mgr@telestar.io --password 'SecureLeadgenPass2026!' --first-name 'Lina' --last-name 'Leadgen' --role leadgen_manager --activate
npm run create-user -- --email sdr.lead@telestar.io --password 'SecureSdrPass2026!' --first-name 'Sam' --last-name 'SDR' --role sdr --activate
```

### Step 4: Encrypt Legacy Plaintext Mailbox Tokens (If Upgrading)
```bash
npx tsx scripts/encrypt-existing-tokens.ts
```

### Step 5: Ingest Historical Records
1. **Import Accounts & Contacts** -> `Account`, `Contact`
2. **Import Campaigns** -> `Campaign`, `CampaignSdr`
3. **Import Pool Inventory** -> `LeadPoolItem` via `/api/leadgen-pool/import`
4. **Import Active Leads** -> `Lead` with stage mapping
5. **Import Meetings & Outcomes** -> `MeetingBookingLink`, `Meeting`
6. **Import Opportunities** -> `Opportunity`

---

## 6. Post-Migration Verification & Health Checklist

Run the following checks to confirm data integrity:

```sql
-- 1. Check for orphaned records lacking tenantId
SELECT count(*) FROM "User" WHERE "tenantId" IS NULL;
SELECT count(*) FROM "Lead" WHERE "tenantId" IS NULL;
SELECT count(*) FROM "LeadPoolItem" WHERE "tenantId" IS NULL;
SELECT count(*) FROM "Opportunity" WHERE "tenantId" IS NULL;

-- 2. Check Role distributions
SELECT role, count(*) FROM "User" GROUP BY role;

-- 3. Check Lead Stage breakdown
SELECT stage, count(*) FROM "Lead" GROUP BY stage;

-- 4. Check Opportunity Stages & Pipeline Totals
SELECT stage, count(*), sum("estimatedValue") FROM "Opportunity" GROUP BY stage;

-- 5. Confirm Outbound Messages are not in unmonitored sending loops
SELECT status, count(*) FROM "OutboundMessage" GROUP BY status;
```

---

## 7. Rollback Plan

If unrecoverable data inconsistencies occur during migration:

1. **Stop Worker Host**:
   ```bash
   pm2 stop telestar-worker || killall node
   ```
2. **Flush Redis Job Queue**:
   ```bash
   redis-cli -u $REDIS_URL FLUSHDB
   ```
3. **Restore PostgreSQL Database**:
   ```bash
   pg_restore -h <host> -U <user> -d <dbname> --clean --if-exists -v "pre_migration_backup_*.dump"
   ```
4. **Restart Services in Safe Mode** (`SEQUENCE_AUTOSEND_ENABLED="false"`).

---

## 8. Migration Sign-Off

| Milestone | Verified By | Date | Status |
| :--- | :--- | :--- | :--- |
| Database Migrations Applied | Lead Systems Architect | 2026-08-02 | ✅ PASS |
| Role & Schema Validations Passed | Full Test Suite (`npm test`) | 2026-08-02 | ✅ PASS (35/35 suites) |
| TypeScript & Static Analysis | `tsc --noEmit` | 2026-08-02 | ✅ PASS (0 errors) |
| Next.js Production Build | `next build` | 2026-08-02 | ✅ PASS (67 routes) |
