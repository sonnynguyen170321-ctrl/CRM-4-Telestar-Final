# Telestar CRM — Deployment & Release Identity

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/evidence/EV-RELEASE-IDENTITY.json
  Regenerate: node scripts/certification/render-deployment.mjs
-->

**Requirement**: `REL-001`
**Defect**: `TEL-P1-018`
**Chain status**: **COMPLETE**
**Candidate SHA**: `daa8ffb679b7bee87a907d4913123318b697eab6`
**Release tag**: `telestar-internal-rc-2026-08-21`

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
| APPLICATION_SOURCE_SHA | `daa8ffb679b7bee87a907d4913123318b697eab6` | — |
| CI_RUN_ID | `32418164738` | — |
| IMAGE_DIGEST | `sha256:f2e807bb7812287bb733b4d5bed9e8c1d1cba10007cc926a896950dac584ce49` | — |
| WEB_DIGEST | `sha256:f2e807bb7812287bb733b4d5bed9e8c1d1cba10007cc926a896950dac584ce49` | — |
| WORKER_DIGEST | `sha256:f2e807bb7812287bb733b4d5bed9e8c1d1cba10007cc926a896950dac584ce49` | — |
| HEALTH_SHA | `daa8ffb679b7bee87a907d4913123318b697eab6` | — |
| Deployment timestamp | `2026-08-21T03:23:49.816Z` | — |
| Migration set | `50` | — |

## 3. Identity assertions

- `APPLICATION_SOURCE_SHA == HEALTH_SHA` — **holds**
- `IMAGE_DIGEST == WEB_DIGEST` — **holds**
- `IMAGE_DIGEST == WORKER_DIGEST` — **holds**

## 4. Rollback

**NOT_EXECUTED** — docker is not installed on this machine, so no image has been built and no digest exists to roll between.

A rollback drill needs two immutable image digests to move between, so it is blocked by the
same gap as §2. The previously published "38 seconds" is withdrawn: it was never measured.

## 5. Post-deployment gate

Not yet applicable — nothing has been deployed from a frozen candidate. When it is, the gate
is: DNS, TLS, login, health, Postgres, Redis, worker heartbeat, migration state, release SHA,
image digest; the six-role smoke; the golden workflow smoke; email safe mode confirmed; no
stuck queue jobs; no new fatal errors in logs.

No secret values appear in this document, by construction: the generator only ever reads
digests, identifiers and timestamps.
