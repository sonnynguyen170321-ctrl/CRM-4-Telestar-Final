# Telestar CRM — Six-Role Browser Acceptance

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/evidence/EV-ROLE-BROWSER.json
  Regenerate: node scripts/certification/collect-role-evidence.mjs --candidate <sha>
-->

**Requirement**: `ROLE-001`, `ROLE-003`, `ROLE-005`, `ROLE-007`, `ROLE-009`, `ROLE-011`
**Defect**: `TEL-P2-013`
**Candidate**: `dfb172f53afaaae5f8304dd22b8f0dd37af69bcb`
**Environment**: win32 / node 24.16.0 / next start / real Postgres / real Redis / Chromium 1440x900
**Status**: PASS

---

## 1. Why this document exists

The certification previously claimed six-role verification on the strength of
`tests/role-journeys.test.ts`, a database/service test. That test is valuable and is kept, but
it cannot answer what the requirement asks: can a person in this role sign in and operate the
product? A service call proves a function returns. It does not prove a page renders, a route
resolves, or that a forbidden surface is actually closed.

Each role below was driven in Chromium against a **production build** (`next start`), real
Postgres and real Redis, signed in as itself with its own browser context.

## 2. What each role had to show

1. it logs in and lands on an authenticated page;
2. every page it owns resolves, without being bounced to login;
3. its primary workflow completes;
4. a surface it must **not** reach refuses it;
5. an object belonging to **another tenant** is denied to it.

Console errors and network failures count against the role. A page that renders while throwing
is not a page that works.

## 3. Results

| Role | Landing | Pages | Allowed workflow | Forbidden workflow | Cross-tenant object | Console errors | Network failures | Verdict |
|---|---|---:|---|---|---:|---:|---:|---|
| `director` | / | 4 | read the admin overview (200) | read another tenant's lead (404) | 404 | 0 | 0 | **PASS** |
| `floor_manager` | / | 3 | read the lead book (200) | read another tenant's lead (404) | 404 | 0 | 0 | **PASS** |
| `leadgen` | / | 2 | read the leadgen pool (200) | read the admin user list (403) | 404 | 0 | 0 | **PASS** |
| `leadgen_manager` | / | 2 | read the leadgen pool (200) | read the admin user list (403) | 404 | 0 | 0 | **PASS** |
| `sdr` | / | 2 | read own assigned leads (200) | read the admin user list (403) | 404 | 0 | 0 | **PASS** |
| `team_lead` | / | 3 | read the pod lead book (200) | read the admin user list (403) | 404 | 0 | 0 | **PASS** |

**Roles observed**: 6 / 6



## 4. Artifacts

Full-page screenshots for every role are stored under
`evidence/raw/role-screenshots/`, and each is hash-verified by the validator.
Playwright traces are retained on failure by the shared config.

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `docs/production-certification/evidence/raw/role-screenshots/director.png` | 229983 | `8e19da616aa837b8…` |
| `docs/production-certification/evidence/raw/role-screenshots/floor_manager.png` | 221035 | `d50c90dadf66e3b3…` |
| `docs/production-certification/evidence/raw/role-screenshots/leadgen.png` | 165032 | `e4b2027f83310f75…` |
| `docs/production-certification/evidence/raw/role-screenshots/leadgen_manager.png` | 138118 | `9d14de6f8ce13a36…` |
| `docs/production-certification/evidence/raw/role-screenshots/sdr.png` | 121562 | `92213bb95b2542a5…` |
| `docs/production-certification/evidence/raw/role-screenshots/team_lead.png` | 218512 | `797c4020542b1503…` |

## 5. Scope

This proves the human operating experience for the six roles at the surfaces listed above. It
is not a substitute for `tests/role-journeys.test.ts`, `tests/podScoping.test.ts` or
`tests/object-auth-red-team.test.ts`, which cover far more object-level authorization cases
than a browser pass can. Both layers are required; neither replaces the other.
