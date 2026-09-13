# Runbook — identity backfill on production

One-way. Read the whole thing before starting.

## What it does and why it cannot wait

`Account` is keyed on `@@unique([tenantId, name])` — the raw name. So "Công ty TNHH ABC", "CTY TNHH
ABC" and "ABC Co.,Ltd" are three Accounts, each holding a third of that company's leads, contacts,
opportunities and research. `Contact.accountId` is null across all pre-existing data, so a contact has
no link to their employer beyond a free-text string.

Phase 1 (migration `20260902000000_identity_phase1`, already deployed) added the columns and taught
every writer to fill them. New rows are correct. **Everything older is not**, and the two ported
features — ICP filtering and research promotion — both resolve companies through those columns, so
until this runs a researched lead and an existing account will not recognise each other.

## Order of operations

Do not skip or reorder. Steps 1–4 change nothing.

### 1. Snapshot

Take a full database snapshot and **verify it restores**. A backup nobody has restored is a hope, not
a backup. `docs/BACKUP_RESTORE_RUNBOOK.md` has the procedure.

Record the snapshot id here before continuing: `________________`

### 2. See what it would do

```bash
npm run backfill:account-identity -- --dry-run --csv /tmp/merge-plan.csv
```

Writes nothing. Prints how many accounts would be stamped, how many merge groups exist, and the first
twenty by name. The CSV holds every group: survivor, reason, and each losing account with its lead and
contact counts.

### 3. Read the plan

This is the step that matters, and it is a human one. Scan the CSV for anything that is not the same
company written two ways:

- **Holding companies and subsidiaries.** Two real businesses on one corporate domain merge under this
  rule. If the customer sells to both separately, they must stay separate.
- **Franchises and branches.** "ABC Hà Nội" and "ABC HCM" normalise apart, so they are safe — but check.
- **Anything with a surprising lead count.** A merge that moves hundreds of leads deserves a look.

Rows that must not merge: fix the data first — give the ones that should stay separate distinct
websites, since a name group holding two different domains is deliberately left alone — then re-run
step 2.

### 4. Owner approval

Show the owner the CSV and the counts. Get an explicit yes. Note it: `________________`

### 5. Apply

```bash
npm run backfill:account-identity -- --apply
```

Or one tenant at a time with `--tenant <id>`, which is the safer shape if the plan is large.

What happens: identity columns stamped; duplicate accounts merged, with `Lead`, `LeadPoolItem`,
`Opportunity`, `Contact` and `ContactEmployment` repointed to the survivor and the losers deleted, all
inside one transaction per group; contacts linked to their account with a `ContactEmployment` row; and
`normalizedPhone` / `normalizedLinkedIn` / `normalizedCompany` recomputed, because the normalisers
changed in phase 1 and old rows still hold the pre-change forms.

Running it twice is safe. A second pass finds nothing to stamp, merge or re-normalise.

### 6. Verify

```bash
npm run backfill:account-identity -- --verify
```

Exits 0 when no two accounts in a tenant share a canonical domain, and 1 with the offending list when
any do.

### 7. Spot-check the app

Open a merged company in the CRM. Its leads, contacts and opportunities should all be there, and its
contacts should now show the account link. Then run one research promotion end to end and confirm it
lands on the existing Account rather than creating a new one.

### 8. Phase 3 — the unique constraint

Only after step 6 passes.

`prisma/manual/20260903_identity_phase3_unique.sql` holds the index. It is **deliberately not in
`prisma/migrations/`**: `scripts/deploy.sh` runs `prisma migrate deploy` before it swaps the
containers, so committing a unique index while production still holds duplicates would abort the
release rather than fail a review. The file carries its own guard and raises a named exception, with a
count, if duplicates remain.

Apply it, then move it into `prisma/migrations/` in a follow-up PR so the schema history and the
database agree. `prisma/schema.prisma` gets `@@unique([tenantId, canonicalDomain])` in that same PR.

`@@unique([tenantId, name])` stays. It is what the raw-name fallback in `resolveAccount` still uses,
and removing it is a separate decision.

## If it goes wrong

The merge deletes the losing accounts, so there is no undo inside the application. Restore the
snapshot from step 1. That is the entire recovery plan, which is why step 1 is not optional.

Signs something is wrong: a company's lead count dropped instead of growing, contacts pointing at an
account that is not their employer, or `--verify` reporting conflicts after an apply that claimed to
merge them.

## Not yet done

This has **not been run against production**. Nothing in this repository has touched the live
database; there are no production credentials in this working copy. Every command above is waiting on
the owner.
