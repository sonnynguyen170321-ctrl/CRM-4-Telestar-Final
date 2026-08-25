---
classification: CURRENT_CANONICAL
---

# Production certification — resume here

**Written**: 2026-08-25, at the end of the session that landed `a95fbd7`..`2d59a97`
**Supersedes**: nothing. Delete this file when the program reaches a final verdict.

This is the handoff for the autonomous production-excellence, certification-integrity
and real-data cutover directive. Read it before doing anything else, then re-measure —
nothing below is authoritative once the code moves.

---

## 1. Where things actually stand

| Fact | Value | How to re-check |
|---|---|---|
| main | `2d59a97` — protected, CI green | `git log --oneline -1 origin/main` |
| Verdict | **NO-GO**, 52 validator failures | `npm run certify:validate` |
| Requirements | **98 / 108** verified | same |
| Defects | 62 tracked, 51 unresolved (5×P0, 27×P1, 19×P2) | `docs/production-certification/defects.json` |
| Validator self-test | 44 injected faults, 44 detected, 0 missed | `npm run certify:selftest` |
| Last ladder run | 22/24 gates PASS on `949eefe`, status FAIL | `docs/production-certification/evidence/EV-RUN-1.json` |
| Production | **untouched**, serving `c7bf639` | `curl -s https://crm.telestar.cloud/api/health` |
| Production database | **never altered by this tooling** | `docs/production-cutover/README.md` |

### The ladder run of 2026-08-25

`EV-RUN-1` is the first run carrying its own execution identity: `executionId`
`3d66f67f-b49f-4711-95ff-7e7b7aca37a7`, and an `actualHeadSha` read back from gate 01 that
equals the candidate. 24 gates recorded, 0 missing, 0 mandatory skips, all 22 raw artifacts
re-hashing to their recorded digests.

Two gates did not pass, and both are **this workstation, not the product**:

```
19-docker-build      FAIL   buildkit could not write its metadata database:
                            "read-only file system" on
                            /var/lib/docker/buildkit/containerd-overlayfs
20-image-inspection  BLOCKED_EXTERNAL (127)   consequent: no image to inspect
```

**Fix Docker before the next ladder run.** Resetting Docker Desktop's disk image clears it.
Until then gates 19 and 20 cannot pass on this machine, the run status stays FAIL, and
REL-003/004/005 stay unverified. `BLOCKED_EXTERNAL` is not green.

### What the remaining 52 failures are

- DR evidence (`dr-backup`, `dr-restore`, `dr-rollback`, `dr-rpo`) still bound to `c7bf639`
- `release-identity` and `ci-run` records still naming `c7bf639`
- `EV-RUN-2` and `EV-RUN-3` predate the identity fields — re-run the ladder, never edit them
- the image and deployment chain unproven for this candidate

`NO-GO` is the correct answer, not a problem to fix. It is computed from evidence, and
the evidence does not support a release.

---

## 2. What landed in that session

All through the now-protected branch, each with its own negative controls.

| Commit | Defect | What was wrong |
|---|---|---|
| `a95fbd7` | **TEL-P0-008** | The cutover classifier decided demo-vs-real from how an identifier *looked*. `endsWith('-tenant')` matched `default-tenant` — the **approved production tenant** — so every row it owns classified `PURGE_SEED`. The manifest queued **68,983 of 69,028** scanned rows for deletion and reported **zero** rows needing review. Loose prefixes (`ci`, `wo`, `test`, `load`) also matched real addresses; `cindy@itelestar.com` read as a fixture. Executing it would have deleted real business data. |
| `a95fbd7` | **TEL-P1-042** | `planMode` hashed the manifest *before* stamping `manifestSha256` on, then wrote the stamped object. Re-hashing the file could never reproduce the digest, so `verifyMode` never checked it — a hand-edited manifest passed every precondition. |
| `a317d15` | **TEL-P1-043** | Both renderers computed eligibility from `findings.filter(f => f.check !== 'VERDICT_MISMATCH')`. Directive §14 names that exact exclusion: a disagreement between generated documents would have stopped blocking release. |
| `df38f5b` | — | `tests/defect-ledger-consistency.test.ts` parsed `DEFECTS.md` prose as a database and asserted against sections the generator no longer emits. 14 CI failures, ledger fine. Now derives every count from `defects.json`. |
| `016e020` | **TEL-P1-045** | `EXECUTE` ran without the §30 preconditions — no backup, PITR, email-pause, autosend, queue or import checks. |
| `5f5b9ac` | — | **main was unprotected** (`404 Branch not protected`). Now enforced *and behaviourally proven*. |
| `b57769d` | **TEL-P1-044** | `REHEARSE` was `executeMode(dryRun=true)` against the **same database the manifest targets**. Proves neither the restore nor the post-cutover state, and holds long locks on production. |
| `7ead966` | — | `EV-RUN-1/2/3` carried **no `executionId`** — three run records were indistinguishable from one run copied three times. Also: the measured head is now mandatory (§60). |
| `949eefe` | — | Directive tests **R** and **S** added *before* the phases they guard. |

**Branch protection is proven, not just configured.** A disposable PR with a deliberately
failing test was refused: `HTTP 405 — Required status check "CI required checks" is failing`,
and a direct push was refused by the protected-branch hook. Transcript in
`docs/production-certification/evidence/raw/branch-protection-behavioral-proof.log`,
hashed into `EV-BRANCH-PROTECTION`.

**A false claim was withdrawn.** `certification.config.json` had claimed a *"live Cloud SQL
production cutover completed in 00661af"*. That commit changes two files; the manifest it
records names `localhost:5432/telestar_crm`; `prod:cutover:*` runs with `--env-file=.env.local`.
No production database has been altered.

---

## 3. THE BLOCKER — do this first

Production Cloud SQL is unreachable from the certification workstation:

```
$ gcloud sql instances list --project=telestar-crm-final
ERROR: [sonnynguyen170321@gmail.com] does not have permission to access projects
instance [telestar-crm-final] (or it may not exist)
```

This blocks **P11, P15, P16, P17, P18, P19, P23, P24, P25** — every phase that touches
production. All of them are `BLOCKED_EXTERNAL`, which is **not green**.

Project `telestar-crm-final` · instance `telestar-db` · database `telestar_crm` · region `asia-southeast1`.

### Minimum grant to unblock the read-only phases

```bash
gcloud projects add-iam-policy-binding telestar-crm-final \
  --member="user:sonnynguyen170321@gmail.com" \
  --role="roles/cloudsql.viewer"

gcloud projects add-iam-policy-binding telestar-crm-final \
  --member="user:sonnynguyen170321@gmail.com" \
  --role="roles/cloudsql.client"
```

### Read-only Postgres login for the inventory

Do not reuse the application role. The inventory must not be able to write.

```sql
CREATE ROLE cutover_readonly LOGIN PASSWORD '<generate>';
GRANT CONNECT ON DATABASE telestar_crm TO cutover_readonly;
GRANT USAGE ON SCHEMA public TO cutover_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO cutover_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO cutover_readonly;
```

Password goes into a local env file, never into this repository, and appears in reports
only as `SET` / `NOT SET`.

### What each role is for

| Phase | Command | Role |
|---|---|---|
| P15 backup / PITR posture | `gcloud sql instances describe telestar-db --format=json` (`scripts/certification/lib/rpoProbe.mjs:126`) | `cloudsql.viewer` |
| P15 backup verify | `gcloud sql backups describe` | `cloudsql.viewer` |
| P11 read-only inventory | `npm run prod:cutover:plan` connects to `telestar_crm` | `cloudsql.client` + the role above |
| P15 backup create | `gcloud sql backups create` | `cloudsql.editor` |
| P16 clone rehearsal | restore backup into a disposable instance | `cloudsql.admin` |

**Hold `cloudsql.editor` and `cloudsql.admin` back until the P17 authorization packet.**
Nothing before that needs to write.

---

## 4. Execution queue — real status

**Done**
`P1` false GO evaluates NO-GO naturally · `P3` defects.json authoritative · `P4` one verdict
engine · `P6` branch protection configured · `P7` release-chain hardening preserved ·
`P10` `purge:demo` retired.

**Done this session, beyond the queue**
`P2` most negative controls (44 detected / 0 missed) · `P8` cutover tooling fail-closed ·
`P9` destructive behavioural tests (25 cases in `tests/safe-cutover-tool.test.ts`).

**Blocked on section 3**
`P11` real inventory · `P15` backup/PITR · `P16` clone rehearsal · `P17` authorization packet ·
`P18` cutover · `P19` zero-seed postcheck · `P23` DB hardening · `P24` email posture ·
`P25` live canary.

**Open, not blocked — the best next work while waiting**
- `P26` defect reconciliation. 51 unresolved. Most `FIXED_PENDING_VERIFICATION` entries carry
  an **empty `fixSha` and empty `verificationEvidence`**. Directive §48: each P0/P1 needs root
  cause, exact fix SHA, the specific test, and its actual result. Do not bulk-close because CI
  is green — a broad green suite does not prove a specific defect.
- Still `OPEN` and needing real work, not paperwork: `TEL-P1-038` (RLS does not exist),
  `TEL-P1-028` (instance has a public IP and permits unencrypted connections),
  `TEL-P2-032` (the production database can be deleted and nothing says so),
  `TEL-P2-026`, `TEL-P2-029`, `TEL-P2-030`.
- `P20` six-role empty-state QA and `P42` permanent empty-state CI coverage can be built now
  against a disposable database; they do not need production.

**Not started**: `P21`, `P22`, `P27`–`P41`.

---

## 5. Traps — each of these already cost something

1. **Check for a running certification ladder before the first commit.** One was in flight at
   the start of that session; commits moved `HEAD`, failed its `01-source-identity` gate and
   voided ~95 minutes. Directive §54 exists for this.
   ```bash
   powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*certification*' } | Select-Object ProcessId, CommandLine"
   ```
2. **Do not read test titles and call it measurement.** The P0 above was invisible in the test
   names and only appeared when the code was actually run.
3. **`main` is protected now.** Direct pushes are refused. Every change goes through a PR;
   `gh pr merge <n> --rebase --delete-branch` once `CI required checks` is green.
4. **The three run records are still invalid.** `EV-RUN-1/2/3` predate `executionId` and
   `actualHeadSha`. Fix them by *re-running the ladder on the final candidate*, never by
   editing the records.
5. **A run was in flight when this was written**, collecting evidence for `949eefe`
   (`collect-evidence.mjs --gate 08-vitest`). Its output was left uncommitted in the working
   tree deliberately — it belongs to that run. Re-measure `git status` on resume; if the run
   died mid-write, discard its partial output rather than committing it.

---

## 6. Resume checklist

```bash
git fetch origin && git checkout main && git pull --ff-only
git status --porcelain                 # expect a clean tree, or the run's leftovers
npm run agent -- doctor                # what this machine can actually run
npm run certify:validate               # expect NO-GO; read the failures
npm run certify:selftest               # expect 44 detected, 0 missed
gcloud sql instances list --project=telestar-crm-final   # blocked, or unblocked
```

Then: if the grant in section 3 has landed, start `P11`. If not, start `P26`.

---

## 7. The standard this is held to

From the directive, and worth re-reading before claiming anything:

> The project is complete only when a hostile independent auditor cannot produce a factual
> contradiction between GitHub → source → CI → candidate → test executions → immutable image
> → production deployment → production database → real business data → email → recovery →
> final certificate.

`BLOCKED_EXTERNAL` is not green. `NOT_TESTED` is not green. "Works locally" is not "verified
in production". Only two final verdicts are allowed: **GO — PRODUCTION EXCELLENCE VERIFIED**,
or **NO-GO — <specific remaining blockers>**.
