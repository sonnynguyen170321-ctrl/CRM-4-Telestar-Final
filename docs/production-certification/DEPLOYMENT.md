# Telestar CRM — Deployment & Release Identity

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/evidence/EV-RELEASE-IDENTITY.json
  Regenerate: node scripts/certification/render-deployment.mjs
-->

**Requirement**: `REL-001`
**Defect**: `TEL-P1-018`
**Chain status**: **COMPLETE**
**Candidate SHA**: `d5d7cf83679faa1187ffd1ab095a37c28f5136f4`
**Release tag**: `telestar-internal-rc-2026-08-22`

---

## 1. Why this document exists

A release is only traceable if every link is recorded: the source commit, the image built
from it **by digest**, the digests actually running as web and worker, and the SHA the
deployed application reports about itself. Certifying `latest`, `main`, or any floating tag
certifies whatever that tag pointed at when someone looked.

The previous certification asserted the chain at source-SHA level and stopped there. Nothing
tied the tested source to a built artefact, and nothing tied that artefact to what was
running.

## 2. The chain

| Link | Value | How to establish it |
|---|---|---|
| APPLICATION_SOURCE_SHA | `d5d7cf83679faa1187ffd1ab095a37c28f5136f4` | — |
| CI_RUN_ID | `32658798987` | — |
| IMAGE_DIGEST | `sha256:4302cb64ea258a48543563e31fdf084abe64826eeb846c8a3e2d0ea5a577a9d6` | — |
| WEB_DIGEST | `sha256:4302cb64ea258a48543563e31fdf084abe64826eeb846c8a3e2d0ea5a577a9d6` | — |
| WORKER_DIGEST | `sha256:4302cb64ea258a48543563e31fdf084abe64826eeb846c8a3e2d0ea5a577a9d6` | — |
| HEALTH_SHA | `d5d7cf83679faa1187ffd1ab095a37c28f5136f4` | — |
| Deployment timestamp | `2026-08-24T03:23:15.457Z` | — |
| Migration set | `52` | — |

## 3. Identity assertions

- `APPLICATION_SOURCE_SHA == HEALTH_SHA` — **holds**
- `IMAGE_DIGEST == WEB_DIGEST` — **holds**
- `IMAGE_DIGEST == WORKER_DIGEST` — **holds**

## 4. Rollback

Executed. Rolled from `ghcr.io/sonnynguyen170321-ctrl/crm-4-telestar-final@sha256:f4b2b741d167a3cf865859025f5a056311fdc0f2daa7bac2118bf4f6ab2421b8` to `ghcr.io/sonnynguyen170321-ctrl/crm-4-telestar-final@sha256:f2e807bb7812287bb733b4d5bed9e8c1d1cba10007cc926a896950dac584ce49` in 35.39s.

## 5. Post-deployment gate

Not yet applicable — nothing has been deployed from a frozen candidate. When it is, the gate
is: DNS, TLS, login, health, Postgres, Redis, worker heartbeat, migration state, release SHA,
image digest; the six-role smoke; the golden workflow smoke; email safe mode confirmed; no
stuck queue jobs; no new fatal errors in logs.

No secret values appear in this document, by construction: the generator only ever reads
digests, identifiers and timestamps.
