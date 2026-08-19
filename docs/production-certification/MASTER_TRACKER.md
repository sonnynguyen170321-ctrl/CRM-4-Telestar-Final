# Telestar CRM — Master Certification Tracker

<!--
  GENERATED FILE. Do not edit by hand.
  Source: computed by npm run certify:validate
  Regenerate: node scripts/certification/render-tracker.mjs
-->

**Verdict**: **NO-GO**
**Candidate SHA**: `dfb172f53afaaae5f8304dd22b8f0dd37af69bcb`
**Requirements verified**: 101 / 108
**Evidence records**: 21
**Generated**: 2026-08-19T21:17:43.634Z

> This file and `progress.json` are rendered from the same computation. They used to be
> maintained by hand, and both said 108/108 VERIFIED and CERTIFIED_APPROVED — which proved
> only that the numbers had been copied from one to the other.

---

## 1. Requirements by domain

| Domain | Total | Verified | Not verified |
|---|---:|---:|---:|
| `IMP` | 13 | 13 | 0 |
| `MAIL` | 12 | 12 | 0 |
| `SEC` | 15 | 15 | 0 |
| `ROLE` | 12 | 12 | 0 |
| `AI` | 14 | 14 | 0 |
| `DR` | 10 | 8 | 2 |
| `REL` | 8 | 3 | 5 |
| `OPS` | 24 | 24 | 0 |
| **TOTAL** | **108** | **101** | **7** |

Detail, with the blocking reason on every unverified row:
[REQUIREMENT_TRACEABILITY.md](REQUIREMENT_TRACEABILITY.md).

## 2. Open defects

| Severity | Open |
|---|---:|
| P0 | 2 |
| P1 | 8 |
| P2 | 5 |
| P3 | 0 |
| **Total** | **15** |

- `TEL-P0-001` — FIXED_PENDING_VERIFICATION
- `TEL-P0-002` — BLOCKED_EXTERNAL
- `TEL-P1-014` — FIXED_PENDING_VERIFICATION
- `TEL-P1-015` — FIXED_PENDING_VERIFICATION
- `TEL-P1-016` — FIXED_PENDING_VERIFICATION
- `TEL-P1-017` — FIXED_PENDING_VERIFICATION
- `TEL-P1-018` — OPEN
- `TEL-P2-013` — FIXED_PENDING_VERIFICATION
- `TEL-P2-014` — FIXED_PENDING_VERIFICATION
- `TEL-P2-015` — FIXED_PENDING_VERIFICATION
- `TEL-P2-016` — FIXED_PENDING_VERIFICATION
- `TEL-P2-017` — FIXED_PENDING_VERIFICATION
- `TEL-P1-019` — FIXED_PENDING_VERIFICATION
- `TEL-P1-020` — FIXED_PENDING_VERIFICATION
- `TEL-P1-021` — FIXED_PENDING_VERIFICATION

## 3. What the validator is currently reporting

| Check | Failures |
|---|---:|
| `REQ` | 7 |
| `L` | 6 |
| `A` | 3 |
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
