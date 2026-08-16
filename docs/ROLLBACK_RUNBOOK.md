# Application Rollback Runbook (Gate P4)

> **Scope:** Fast, deterministic application rollback on GCE VM.  
> **Mechanism:** Digest-pinned immutable container swap with `deployments.ndjson` audit trail.  

---

## 1. Rollback Pre-Conditions

1. **Target Image Digest Known:** The target image digest (e.g. `sha256:47cae338...`) is stored in `deployments.ndjson` or GitHub Container Registry.
2. **Schema Backward Compatibility:** Database migrations must adhere to expand/contract guidelines. Forward-only migrations avoid destructive drops.

---

## 2. Standard Rollback Execution

To roll back to the previously certified release on the production VM:

```bash
# SSH into GCE VM
gcloud compute ssh telestar-crm-vm --zone=asia-southeast1-a --tunnel-through-iap

# Execute rollback script
cd /opt/crm-4-u

# Roll back to the previous deployment in deployments.ndjson
./scripts/rollback.sh

# Or roll back to an explicit image digest:
# ./scripts/rollback.sh ghcr.io/sonnynguyen170321-ctrl/crm-4-telestar-final@sha256:<PREVIOUS_DIGEST>
```

---

## 3. Post-Rollback Verification

Immediately run the post-deploy smoke test to confirm all 6 health checks are green:

```bash
./scripts/post-deploy-smoke.sh
```

Expected output:
```text
==> Running post-deploy smoke checks...
PASS: HTTP /api/health returned 200 with healthy status
PASS: Health database is ok
PASS: Health redis is ok
PASS: Migration status reports applied migrations
PASS: Worker health check job succeeded
PASS: Post-deploy smoke test fully passed!
```
