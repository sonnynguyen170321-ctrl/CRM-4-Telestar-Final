---
classification: CURRENT_CANONICAL
---

# Production certification — resume here

**Written**: 2026-08-26, at the end of the session that landed `bea37a5`..`f0ddb4e`
**Supersedes**: the 2026-08-25 handoff, which described `2d59a97` and is now wrong in every number.

Read this, then re-measure. Nothing below is authoritative once the code moves.

---

## 1. The one thing that unblocks everything

**Deploy the current candidate.** Almost every remaining failure is downstream of it.

Production currently answers:

```json
{"ok":true,"commit":"unknown","version":"unknown","builtAt":"unknown","schema":"ready"}
```

It reported a real SHA at 08:31 on 2026-08-26 and `unknown` afterwards, so the deployment
changed during that session and lost its build arguments. Consequences, all of them
blocking:

- **`TEL-P0-013`** — a cross-tenant lead read, fixed in `927abc9` and `ab1496d` — cannot be
  confirmed present or absent in production. Not "unverified": *unanswerable*.
- Gate 22 compares the live health SHA to the frozen candidate, so it cannot pass.
- `REL-001` has no endpoint to satisfy.

Deploy **by published digest**, not through `docker-compose.build.yml`. Then:

```bash
node scripts/certification/record-deployed-state.mjs
```

It probes rather than being told, and refuses to record a pass it did not observe.

---

## 2. Do not freeze before deploying

This was worked out the hard way and is worth not repeating.

Freezing a new candidate and running the ladder are inseparable, because all **42 evidence
records name the candidate they belong to** — a new candidate makes check A fire on every
one of them. And the ladder cannot pass gate 22 while production reports `unknown`. So
freezing first produces 42 stale-evidence findings plus three FAIL runs, which is strictly
worse than the 34 bookkeeping findings it would clear.

The order that works:

```
1. deploy the candidate
2. node scripts/certification/freeze-candidate.mjs --reason "…"
3. npm run certify:full -- --candidate <sha> --run 1   (×3, requiredRunCount is 3)
```

The machine is ready for step 3. Docker was broken for the whole previous ladder run — the
host C: drive was at 1.9 GB, so the WSL vhdx could not grow and the guest filesystem
remounted read-only. Cleared to 7.4 GB; gates 19 and 20 both ran successfully for the first
time in this program.

**Watch the disk.** A full image build consumes about 5 GB and the vhdx does not shrink
afterwards. `docker builder prune --all --force` between runs.

---

## 3. Where the verdict stands

| Fact | Value |
|---|---|
| main | `f0ddb4e` |
| candidate | `9b2b44c`, frozen 2026-08-25 — **predates the cross-tenant fix** |
| verdict | **NO-GO**, 51 failures, 107/108 requirements |
| full Vitest | 3023 / 3023, 0 failed, 0 skipped |
| validator self-test | 61 detected, 0 missed |
| `npm audit --audit-level=high` | 0 vulnerabilities |

The 51 break down as: `N`/`N2`/`N3` 34 (post-freeze drift — see §2), `F` 10 (the defects
below), `U`/`U2`/`V` 4 and `R` 2 (evidence that needs the deployment host), `REQ` 1.

---

## 4. What was wrong with certification itself

The previous handoff reported a GO. It was not survivable.

- **`TEL-P0-011`** — the validator's *only* defect gate returned early unless the certificate
  said `ISSUED & APPROVED`, wording this program stopped emitting when it moved to GO/NO-GO.
  Dead code on every real run, and the self-test that "proved" it fed it that dead string.
  GO was published with two P1 defects OPEN.
- **`TEL-P1-051`** — the freeze exempted `scripts/certification/` from itself, so the engine
  could be edited after the freeze and re-run to certify itself under the new rules.
- **`TEL-P0-012`** — `EV-DR-ROLLBACK` claims this candidate while citing a drill run a day
  earlier for `c7bf639`. No rollback has been performed for this candidate.
- **`TEL-P1-053`** — a mandatory gate held a test granting its child 120 s under a 20 s runner
  limit.

Self-test controls went from 44 to 61, all mutation-proved.

---

## 5. The defects that remain, and who can close them

| ID | Sev | Needs |
|---|---|---|
| `TEL-P0-013` | P0 | **the deploy** — fixed in code, unconfirmed in production |
| `TEL-P0-012` | P0 | a rollback drill on the deployment host |
| `TEL-P0-009` | P0 | credential rotation — declined 2026-08-25; code paths are clean, only rotation closes it |
| `TEL-P1-055` | P1 | the deploy — build ran without `APP_COMMIT`; the overlay now refuses that |
| `TEL-P1-018` | P1 | the deployment host — 4 of 6 chain links observed, container digests are not |
| `TEL-P1-038` | P1 | GCP + operator — RLS is built and proven, never applied |
| `TEL-P1-028` | P1 | GCP — Cloud SQL public IP and TLS posture |
| `TEL-P1-049` | P1 | the deployment host, plus a disposable PR for the branch-protection probe |
| `TEL-P2-026` | P2 | GCP — the app role holds CREATEROLE and CREATEDB |
| `TEL-P2-030` | P2 | GCP — the backup check cannot run from the production VM |

**GCP access is still refused**: `sonnynguyen170321@gmail.com` has no `cloudsql.*` and no
`compute.instances.list` on `telestar-crm-final`. Minimum grant to unblock four of these:
`roles/cloudsql.viewer` + `roles/cloudsql.client`.

---

## 6. Traps, each of which cost something

1. **A rebase-merge orphans every fixSha recorded on the branch.** `main` requires linear
   history. `tests/defect-ledger-integrity.test.ts` now checks *reachability* rather than mere
   presence, so it fails on the author's machine instead of only in CI. Repair with
   `node scripts/certification/reconcile-rebased-fix-shas.mjs --apply`, which maps by commit
   subject. Do **not** use `reconcile-defects.mjs` for this: it picks the earliest commit
   naming the defect, which is sometimes the one that *filed* it.
2. **Certification tools overwrite evidence.** Running the queue benchmark ad hoc replaced
   `EV-LOAD-QUEUE.json` for the frozen candidate. Every writer now requires
   `CERT_CANDIDATE_SHA` and refuses a candidate that is not the frozen one.
3. **`agent doctor` said `ok docker` while the daemon answered 500 to everything.** It probed
   the client binary. It asks the daemon now — but a live daemon still does not prove buildkit
   can write, and that was this machine's exact condition for the whole previous ladder run.
4. **Do not restart Docker while a suite is running.** 140 tests failed with
   `FATAL: the database system is starting up`. Environmental, not the product — but it looks
   identical to a real failure until you read the message.
