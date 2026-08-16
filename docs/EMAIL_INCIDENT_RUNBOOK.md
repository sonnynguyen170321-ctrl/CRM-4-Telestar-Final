# Outbound Email Incident & Deliverability Runbook

> **Scope:** Outbound email safety, emergency pause, deliverability triage, and provider error recovery.  
> **Target Environment:** GCP Production (`telestar-crm-vm` / `crm.telestar.cloud`)  
> **Authoritative Specification:** Full Production Readiness Specification  

---

## 1. Emergency Kill Switches (Immediate Action)

### A. Total Outbound Freeze (Zero Mail Out)
If unexpected messages, runaway loops, or unauthorized volume are detected:

```bash
# SSH into production VM
gcloud compute ssh telestar-crm-vm --zone=asia-southeast1-a --tunnel-through-iap

# Set EMAIL_GLOBAL_PAUSE=true immediately
cd /opt/crm-4-u
if grep -q "^EMAIL_GLOBAL_PAUSE=" .env.production; then
  sed -i 's/^EMAIL_GLOBAL_PAUSE=.*/EMAIL_GLOBAL_PAUSE=true/' .env.production
else
  echo "EMAIL_GLOBAL_PAUSE=true" >> .env.production
fi

# Reload worker container without downtime
COMPOSE_FLAGS=$(./scripts/production-compose.sh .env.production)
sudo docker compose --env-file .env.production $COMPOSE_FLAGS up -d --no-deps worker
```

**Verification:** All worker attempts will immediately abort at the pre-transmission gate with status `failed` and reason `global_email_paused`.

---

### B. Safe Dry-Run Posture (Simulated Provider Sends)
To keep the CRM UI, queues, and activity logging functional while preventing real SMTP/API transmissions:

```bash
# On production VM:
cd /opt/crm-4-u
sed -i 's/^EMAIL_SEND_DRY_RUN=.*/EMAIL_SEND_DRY_RUN=true/' .env.production

COMPOSE_FLAGS=$(./scripts/production-compose.sh .env.production)
sudo docker compose --env-file .env.production $COMPOSE_FLAGS up -d --no-deps web worker
```

---

### C. Sequence Autosend Kill Switch
To stop automated background sequence dispatch while allowing SDRs to manually send:

```bash
# On production VM:
cd /opt/crm-4-u
sed -i 's/^SEQUENCE_AUTOSEND_ENABLED=.*/SEQUENCE_AUTOSEND_ENABLED=false/' .env.production

COMPOSE_FLAGS=$(./scripts/production-compose.sh .env.production)
sudo docker compose --env-file .env.production $COMPOSE_FLAGS up -d --no-deps web
```

---

## 2. Deliverability Triage & DNS Verification

### Checking Domain Health (SPF, DKIM, DMARC, MX)
Run the automated DNS verifier inside the production container:

```bash
sudo docker compose --env-file .env.production exec web \
  node node_modules/tsx/dist/cli.mjs scripts/verify-domain-dns.ts telestar.cloud
```

| Record | Requirement | Expected Standard |
| :--- | :--- | :--- |
| **SPF** | Apex TXT record | `v=spf1 include:_spf.google.com ~all` (or provider equivalent) |
| **DKIM** | `[selector]._domainkey` | 2048-bit RSA key matching Google Workspace selector |
| **DMARC** | `_dmarc.<domain>` | `v=DMARC1; p=quarantine; rua=mailto:...` |
| **MX** | Apex MX records | Google Workspace or Microsoft 365 authoritative servers |

---

## 3. Mailbox Auto-Pause & Bounce Spikes (>3%)

If a mailbox exceeds 3% hard bounce rate over rolling 7 days:
1. `EmailHealth` engine automatically flags account `healthLevel="critical"`.
2. `EMAIL_HEALTH_AUTOPAUSE=true` automatically blocks new outbound sends from that `EmailAccount`.
3. SDR/Admin receives notification in CRM.

### To Investigate and Resume:
```bash
# 1. Audit bounced recipients
sudo docker compose --env-file .env.production exec web \
  node node_modules/tsx/dist/cli.mjs -e '
    const { prisma } = require("./lib/prisma");
    prisma.suppressionEntry.findMany({ where: { reason: "hard_bounce" }, take: 20 })
      .then(console.log);
  '

# 2. To unpause after rectifying list hygiene:
# Go to UI at https://crm.telestar.cloud/settings -> Email Accounts -> Click "Resume Sending"
```

---

## 4. Idempotency & Duplicate Send Prevention

The sending pipeline uses atomic Compare-And-Set (CAS) at the database layer:
1. Status transition: `pending` / `failed` ➔ `sending` (via `updateMany(count === 1)`).
2. If network timeout occurs during provider call:
   - Status set to `reconciliation_required`.
   - Worker never re-transmits without human or reconciliation engine resolution.
