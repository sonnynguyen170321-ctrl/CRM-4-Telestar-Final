# Telestar CRM — Master Certification Tracker

<!--
  GENERATED FILE. Do not edit by hand.
  Source: computed by npm run certify:validate
  Regenerate: node scripts/certification/render-tracker.mjs
-->

**Verdict**: **NO-GO**
**Candidate SHA**: `bafb9171ad81955f0c2dd9c44e9d1a517bcdba19`
**Requirements verified**: 0 / 108
**Evidence records**: 11
**Generated**: 2026-08-19T20:16:13.971Z

> This file and `progress.json` are rendered from the same computation. They used to be
> maintained by hand, and both said 108/108 VERIFIED and CERTIFIED_APPROVED — which proved
> only that the numbers had been copied from one to the other.

---

## 1. Requirements by domain

| Domain | Total | Verified | Not verified |
|---|---:|---:|---:|
| `IMP` | 13 | 0 | 13 |
| `MAIL` | 12 | 0 | 12 |
| `SEC` | 15 | 0 | 15 |
| `ROLE` | 12 | 0 | 12 |
| `AI` | 14 | 0 | 14 |
| `DR` | 10 | 0 | 10 |
| `REL` | 8 | 0 | 8 |
| `OPS` | 24 | 0 | 24 |
| **TOTAL** | **108** | **0** | **108** |

Detail, with the blocking reason on every unverified row:
[REQUIREMENT_TRACEABILITY.md](REQUIREMENT_TRACEABILITY.md).

## 2. Open defects

| Severity | Open |
|---|---:|
| P0 | 2 |
| P1 | 6 |
| P2 | 5 |
| P3 | 0 |
| **Total** | **13** |

- `TEL-P0-001` — FIXED_PENDING_VERIFICATION
- `TEL-P0-002` — BLOCKED_EXTERNAL
- `TEL-P1-014` — OPEN
- `TEL-P1-015` — FIXED_PENDING_VERIFICATION
- `TEL-P1-016` — FIXED_PENDING_VERIFICATION
- `TEL-P1-017` — FIXED_PENDING_VERIFICATION
- `TEL-P1-018` — OPEN
- `TEL-P2-013` — OPEN
- `TEL-P2-014` — OPEN
- `TEL-P2-015` — OPEN
- `TEL-P2-016` — OPEN
- `TEL-P2-017` — FIXED_PENDING_VERIFICATION
- `TEL-P1-019` — FIXED_PENDING_VERIFICATION

## 3. What the validator is currently reporting

| Check | Failures |
|---|---:|
| `REQ` | 108 |
| `A` | 7 |
| `L` | 3 |
| `01` | 1 |
| `G/H` | 1 |
| `D` | 1 |
| `R` | 1 |

Check meanings are in [PROTOCOL.md](PROTOCOL.md) §6.

## 4. Document map

| Document | Generated from |
|---|---|
| [FINAL_CERTIFICATE.md](FINAL_CERTIFICATE.md) | evidence manifest + validator |
| [REQUIREMENT_TRACEABILITY.md](REQUIREMENT_TRACEABILITY.md) | `requirements.json` + evidence |
| [EVIDENCE.md](EVIDENCE.md) | `evidence/*.json` |
| [LOAD_TEST.md](LOAD_TEST.md) | `EV-LOAD-HANDLER`, `EV-LOAD-QUEUE` |
| [ROLE_BROWSER_EVIDENCE.md](ROLE_BROWSER_EVIDENCE.md) | `EV-ROLE-BROWSER` |
| [DEPLOYMENT.md](DEPLOYMENT.md) | `EV-RELEASE-IDENTITY` |
| [runs/RUN_N.md](runs/) | `runs/manifests/run-N.json` |
| [DEFECTS.md](DEFECTS.md) | hand-maintained — the one narrative document |
| [PROTOCOL.md](PROTOCOL.md) | hand-maintained — the rules themselves |
