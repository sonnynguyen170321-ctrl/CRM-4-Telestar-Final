# Telestar CRM — Evidence-Locked Certification Protocol

**Status**: in force
**Supersedes**: all prior hand-maintained certification practice
**Enforced by**: `npm run certify:validate` (exits non-zero when certification is invalid)

---

## 1. The core principle

Certification is **machine-checkable**. The system answers *"can this requirement legally
become VERIFIED?"* rather than allowing a document to write `VERIFIED`.

Five rules, all absolute:

1. No claim without evidence.
2. No `VERIFIED` without evidence.
3. No certificate without automated consistency validation.
4. No measured number without a raw measurement artifact.
5. No "full run" unless the full gate set actually executed.

A production claim may never rest on a mocked substitute.

---

## 2. The four truths

A requirement is `VERIFIED` only when all four agree:

| Truth | Question |
|---|---|
| **Code truth** | Does the implementation contain the required invariant? |
| **Test truth** | Does an appropriate test actually exercise that invariant? |
| **Runtime truth** | Does the real production-like system behave correctly? |
| **Evidence truth** | Can another engineer independently verify what happened? |

---

## 3. Where truth lives

| Concern | Authoritative source | Derived from it |
|---|---|---|
| Candidate SHA, release tag, gate list | `certification.config.json` | every other document |
| Requirements and their evidence claims | `requirements.json` | `REQUIREMENT_TRACEABILITY.md` |
| What actually ran and what it produced | `evidence/*.json` + `evidence/raw/` | `EVIDENCE.md`, `LOAD_TEST.md`, run manifests |
| Requirement status | **computed** by the validator | never stored anywhere |
| Certificate eligibility | **computed** by the validator | `FINAL_CERTIFICATE.md` |

Requirement status is deliberately absent from `requirements.json`. There is no field in which
a `VERIFIED` can be typed.

---

## 4. Evidence records

One JSON record per executed gate, in `docs/production-certification/evidence/`.

```json
{
  "evidenceId": "EV-VITEST-RUN3",
  "kind": "vitest",
  "candidateSha": "<40-char SHA>",
  "environment": "windows-10 / node 22 / postgres 16 / redis 7",
  "command": "node node_modules/vitest/vitest.mjs run --reporter=json",
  "startedAt": "2026-08-20T09:00:00+07:00",
  "finishedAt": "2026-08-20T09:12:31+07:00",
  "exitCode": 0,
  "status": "PASS",
  "metrics": { },
  "artifacts": [
    { "path": "docs/production-certification/evidence/raw/run3-vitest.log", "sizeBytes": 128394, "sha256": "<64 hex>" }
  ]
}
```

Mandatory fields: `evidenceId`, `kind`, `candidateSha`, `environment`, `command`, `startedAt`,
`finishedAt`, `exitCode`, `status`. `status` is one of `PASS`, `FAIL`, `BLOCKED_EXTERNAL`,
`NOT_EXECUTED`. Timestamps must carry an explicit offset. `candidateSha` must be the full
40 characters.

Every declared artifact is checked for existence, exact size, and exact SHA-256. A drifted or
fabricated artifact fails validation.

### Raw evidence rule

Raw outputs are captured **during** execution into `evidence/raw/` — never reconstructed
afterwards. A reconstructed log is a fabricated log.

---

## 5. How `VERIFIED` is computed

A requirement declares one or more **evidence claims**. It is `VERIFIED` only when *every*
claim resolves. A claim resolves only when a record exists that:

- is of the claimed `kind`, and
- carries the **current** candidate SHA, and
- has `status: PASS` with `exitCode: 0`, and
- satisfies the claim-specific invariant below.

| Claim kind | Additional invariant |
|---|---|
| `vitest` | the cited test file appears in the run, status `passed`, `tests > 0`, `skipped == 0` |
| `redis-integration` | `executed == true` and `skipped == 0` — a skipped suite never satisfies it |
| `role-browser` | the named role is `PASS` with zero console errors and zero network failures |
| `load-benchmark` | the named scale exists with `lostRows == 0` and `duplicateRows == 0` |
| `dr-backup` | `backupSizeBytes > 0`, SHA ≠ empty-file digest, `checksumVerified == true` |
| `dr-restore` | `integrityCheckPassed == true`; measured `rtoSeconds > 0` where claimed |
| `certification-run` | correct run number, zero missing gates, zero mandatory skips |
| `release-identity` | `imageDigest`, `webDigest`, `workerDigest`, `healthSha`, `ciRunId` all present |

---

## 6. Consistency checks

`validate-certification.mjs` fails on any of:

| Check | Detects |
|---|---|
| `01` | no frozen candidate, HEAD ≠ candidate, or dirty working tree |
| `A` | candidate SHA mismatch across the SHA-declaring documents |
| `B` | conflicting authoritative test totals |
| `C` | a load figure published in the certificate that the load report does not contain |
| `D` | missing, malformed, or duplicated evidence records |
| `E` | a document marking a requirement `VERIFIED` that the manifest does not compute as `VERIFIED` |
| `F` | an `APPROVED` certificate while defects remain unclosed |
| `G`/`H` | a missing artifact, or an artifact whose size or hash does not match its declaration |
| `I` | a `file://` reference in certification documentation |
| `J` | documentation referencing a repository file that does not exist |
| `J2` | a requirement citing a test file that does not exist |
| `K` | a mandatory skip in a final run |
| `L` | a final run missing a mandatory gate, or a gate that is not `PASS` |
| `M` | a certificate dated before the third run completed |
| `N` | a behaviour-changing commit after the candidate freeze |
| `P` | a declared backup size of zero |
| `Q` | a backup SHA equal to the empty-file digest |
| `R` | a missing image/web/worker digest |
| `S` | a deployed health SHA differing from the candidate |
| `T` | web and worker on different images without `separateImagesIntentional` |

**The validator wins.** If documentation says `VERIFIED` and the validator says `FAIL`, the
status is not `VERIFIED`.

The validator is itself tested — `tests/certification-validator.test.ts` injects each
false-green state and asserts the validator turns red.

---

## 7. Defect closure rule

`OPEN → IN_PROGRESS → FIXED_PENDING_VERIFICATION → VERIFIED`, in that order only.

Closure requires: root cause, fix SHA, the specific test, the actual run result, and an
evidence ID. "Fix implemented" is not `VERIFIED`.

The defect total may increase at any time. Finding more defects is successful auditing;
readiness may legitimately fall.

---

## 8. Language rules

Use `measured`, `executed`, `verified`, `observed` **only** when the action happened and
evidence exists. Otherwise use `planned`, `configured`, `expected`, `not yet executed`, or
`blocked`. A runbook does not become an executed drill through wording.

Never write "zero vulnerabilities", "100% secure", or "production-proof". Scope every claim:

> No cross-tenant access was observed across the 47 tested object-authorization cases on
> candidate SHA X.

Never fabricate a hash, timestamp, run ID, image digest, backup size, test count, performance
number, CI ID, deployment result, screenshot, or restore duration. When something cannot be
obtained, record `BLOCKED_EXTERNAL`. An honest blocker is acceptable; fake evidence is a
certification failure.

---

## 9. Metric single-source rule

Performance and count metrics live in the evidence manifest and are **rendered** into
documents. They are never typed into two files. This is what produced two different 1,000-row
results (`TEL-P2-015`).

---

## 10. The run ladder

`npm run certify:full` executes the complete ladder defined in
`certification.config.json → fullCertificationGates`. Gates 01–22 cover source identity,
environment, typecheck, lint, test discipline, migrations, database integrity, Vitest, Redis
integration, AI certification, email safety, import fault matrix, queue load, security,
production build, six-role Playwright, golden browser journey, worker readiness, Docker build,
image inspection, compose validation, and health smoke.

Backup/restore and rollback are `frozenCandidateGates`: executed once against the frozen
candidate rather than three times, and named as such so no document calls the three runs
something they are not.

Run manifests are generated from raw run output. `RUN_1.md` … `RUN_3.md` are rendered, never
hand-written.

---

## 11. Pre-deployment GO gate

All must hold:

- `certify:validate` = PASS
- RUN 1, RUN 2, RUN 3 = PASS on the same SHA, no application code change between them
- open P0 = 0, open P1 = 0
- every mandatory requirement `VERIFIED`
- Redis skips = 0
- six-role Playwright acceptance = PASS
- real backup / restore evidence = PASS
- rollback evidence = PASS
- security suite = PASS on the **final** candidate
- candidate tree clean, image built from the candidate SHA

## 12. Post-deployment GO gate

DNS, TLS, login, health, Postgres, Redis, worker, migration state, release SHA, image digest;
six-role smoke; golden workflow smoke; email safe mode confirmed; no stuck queue jobs; no new
fatal errors in logs.

---

## 13. The verdict

Exactly two verdicts exist:

- `GO — READY FOR TELESTAR INTERNAL LAUNCH`
- `NO-GO — BLOCKERS REMAIN`

There is no "essentially ready", "nearly complete", "99%", "certified except", or "done
locally".

The generator determines eligibility. Nobody edits the status by hand.
